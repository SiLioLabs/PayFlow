use soroban_sdk::{Address, Env, Vec};

use crate::caps::{
    MAX_MERCHANT_SUB_COUNT_BATCH, MAX_PRUNE_REVENUE_DAYS, REVENUE_DAY_PAGE_SIZE,
    TOP_MERCHANTS_PAGE_SIZE,
};
use crate::DataKey;
use crate::MERCHANT_STATE_TTL_LEDGERS;
use crate::SUBSCRIPTION_TTL_LEDGERS;

/// Maximum number of day-index entries retained per merchant after a prune or reset.
/// Entries beyond this cap are dropped from the oldest end so the index stays bounded.
pub const MAX_RETAINED_REVENUE_DAYS: u32 = 90;

/// Maximum number of per-charge entries retained in `MerchantRevenueHistory`.
/// Appends beyond this cap drop the oldest entries first.
pub const MAX_REVENUE_HISTORY: u32 = 100;

/// Returns the total revenue accumulated for a merchant.
pub fn get_merchant_revenue(env: &Env, merchant: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantRevenue(merchant.clone()))
        .unwrap_or(0i128)
}

/// Returns the number of merchants with pending (unwithdrawn) revenue > 0.
pub fn get_pending_merchant_rev_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PendingMerchantRevCount)
        .unwrap_or(0u32)
}

fn increment_pending_merchant_rev_count(env: &Env) {
    let count = get_pending_merchant_rev_count(env);
    env.storage()
        .instance()
        .set(&DataKey::PendingMerchantRevCount, &(count + 1));
}

fn decrement_pending_merchant_rev_count(env: &Env) {
    let count = get_pending_merchant_rev_count(env);
    if count > 0 {
        env.storage()
            .instance()
            .set(&DataKey::PendingMerchantRevCount, &(count - 1));
    }
}

/// Adds `amount` to the merchant's running revenue total.
pub fn increment_revenue(env: &Env, merchant: &Address, amount: i128) {
    let current = get_merchant_revenue(env, merchant);
    if current == 0 && amount > 0 {
        increment_pending_merchant_rev_count(env);
    }
    let key = DataKey::MerchantRevenue(merchant.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage().persistent().extend_ttl(
        &key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );
}

/// Reverses up to `amount` of the merchant's booked revenue after a refund.
/// Floors at zero, and also decrements the per-day bucket for today when one
/// exists so the cumulative total and today's bucket stay consistent. History
/// is append-only and intentionally not rewritten.
pub fn decrement_revenue(env: &Env, merchant: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    let current = get_merchant_revenue(env, merchant);
    let new_total = current.saturating_sub(amount);
    let key = DataKey::MerchantRevenue(merchant.clone());
    env.storage().persistent().set(&key, &new_total);
    env.storage().persistent().extend_ttl(
        &key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );

    if current > 0 && new_total == 0 {
        decrement_pending_merchant_rev_count(env);
    }

    let today = env.ledger().timestamp() / 86400;
    let day_key = DataKey::MerchantRevenueDay(merchant.clone(), today);
    if let Some(day_total) = env.storage().persistent().get::<_, i128>(&day_key) {
        env.storage()
            .persistent()
            .set(&day_key, &day_total.saturating_sub(amount));
        env.storage().persistent().extend_ttl(
            &day_key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );
    }
}

/// Returns the merchant's revenue history as a Vec (oldest -> newest), limited to the
/// most recent `days` entries. Returns an empty Vec when unset or after clearing.
///
/// The stored entry is a single Vec of at most `MAX_REVENUE_HISTORY` entries, which
/// the host loads as a whole; the requested window is then taken with a host-side
/// `slice`, so no entry outside the window is decoded into the contract.
pub fn get_merchant_revenue_history(env: &Env, merchant: &Address, days: u32) -> Vec<i128> {
    if days == 0 {
        return Vec::new(env);
    }

    let history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&DataKey::MerchantRevenueHistory(merchant.clone()))
        .unwrap_or_else(|| Vec::new(env));

    let len = history.len();
    history.slice(len.saturating_sub(days)..len)
}

/// Removes the merchant's consolidated revenue history from persistent storage.
/// Idempotent — safe to call when no history exists.
pub fn clear_revenue_history(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantRevenueHistory(merchant.clone()));
}

/// Adds `amount` to the cumulative total, the per-day bucket, and the consolidated history Vec.
pub fn increment_revenue_with_daily(env: &Env, merchant: &Address, amount: i128) {
    // update cumulative
    increment_revenue(env, merchant, amount);

    // update per-day bucket (kept for potential direct key lookups)
    let now = env.ledger().timestamp();
    let today = now / 86400;
    let day_key = DataKey::MerchantRevenueDay(merchant.clone(), today);
    let mut is_new_day = false;
    let current_day: i128 = env.storage().persistent().get(&day_key).unwrap_or_else(|| {
        is_new_day = true;
        0i128
    });
    env.storage()
        .persistent()
        .set(&day_key, &(current_day + amount));
    // extend TTL: 1,555,200 ledgers (~90 days)
    env.storage().persistent().extend_ttl(
        &day_key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );

    if is_new_day {
        let index_key = DataKey::MerchantRevenueDayIndex(merchant.clone());
        let mut index: Vec<u64> = env
            .storage()
            .persistent()
            .get(&index_key)
            .unwrap_or_else(|| Vec::new(env));
        index.push_back(today);
        env.storage().persistent().set(&index_key, &index);
        env.storage().persistent().extend_ttl(
            &index_key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );
    }

    // append to consolidated history Vec, keeping only the newest
    // MAX_REVENUE_HISTORY entries (oldest dropped first)
    let hist_key = DataKey::MerchantRevenueHistory(merchant.clone());
    let mut history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&hist_key)
        .unwrap_or_else(|| Vec::new(env));
    let len = history.len();
    if len >= MAX_REVENUE_HISTORY {
        history = history.slice(len - (MAX_REVENUE_HISTORY - 1)..len);
    }
    history.push_back(amount);
    env.storage().persistent().set(&hist_key, &history);
    env.storage().persistent().extend_ttl(
        &hist_key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );
}

/// Returns the number of active subscribers for a merchant.
pub fn get_merchant_subscriber_count(env: &Env, merchant: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantSubCount(merchant.clone()))
        .unwrap_or(0u64)
}

/// Returns the total number of entries in the merchant index.
pub fn get_merchant_index_size(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantIndexSize)
        .unwrap_or(0u32)
}

/// Returns a bounded page of merchants in index order. Missing slots are
/// skipped, and `offset` is an index slot rather than a result count.
pub fn get_merchant_page(env: &Env, offset: u32, limit: u32) -> Vec<Address> {
    let size = get_merchant_index_size(env) as u64;
    let cap = crate::caps::effective_page_size(Some(limit), crate::caps::MERCHANT_PAGE_SIZE);
    let mut result = Vec::new(env);
    let start = offset as u64;
    if start >= size || cap == 0 {
        return result;
    }

    let end = (start + cap as u64).min(size);
    let mut slot = start;
    while slot < end {
        if let Some(merchant) = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::MerchantIndex(slot as u32))
        {
            result.push_back(merchant);
        }
        slot += 1;
    }
    result
}

/// Indexes a merchant if not already indexed.
pub fn index_merchant(env: &Env, merchant: &Address) {
    let known_key = DataKey::MerchantKnown(merchant.clone());
    if !env.storage().persistent().has(&known_key) {
        let slot = get_merchant_index_size(env);
        let index_key = DataKey::MerchantIndex(slot);
        env.storage().persistent().set(&index_key, merchant);
        env.storage().persistent().extend_ttl(
            &index_key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );

        env.storage().persistent().set(&known_key, &true);
        env.storage().persistent().extend_ttl(
            &known_key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );

        let size_key = DataKey::MerchantIndexSize;
        env.storage().persistent().set(&size_key, &(slot + 1));
        env.storage().persistent().extend_ttl(
            &size_key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );
    }
}

/// Removes a merchant from the merchant index using swap-remove.
///
/// The last occupied slot is moved into the vacated position and the index size
/// is decremented, mirroring the `WhitelistIndex` compaction in
/// `whitelist::remove_merchant`. This keeps the index dense (no tombstoned
/// holes) so `get_top_merchants_by_subs` stops ranking a removed merchant and
/// its scan cost shrinks by one slot.
///
/// The `MerchantKnown` marker is cleared so a later `index_merchant` (on re-add
/// or a new subscription) appends a fresh slot instead of treating the removed
/// merchant as already indexed.
///
/// Idempotent: removing a merchant that is not indexed is a no-op.
pub fn unindex_merchant(env: &Env, merchant: &Address) {
    let size = get_merchant_index_size(env);
    if size > 0 {
        for i in 0..size {
            let key = DataKey::MerchantIndex(i);
            if let Some(addr) = env.storage().persistent().get::<_, Address>(&key) {
                if addr == *merchant {
                    let last_idx = size - 1;
                    if i != last_idx {
                        let last_key = DataKey::MerchantIndex(last_idx);
                        if let Some(last_addr) =
                            env.storage().persistent().get::<_, Address>(&last_key)
                        {
                            env.storage().persistent().set(&key, &last_addr);
                            env.storage().persistent().extend_ttl(
                                &key,
                                MERCHANT_STATE_TTL_LEDGERS,
                                MERCHANT_STATE_TTL_LEDGERS,
                            );
                        }
                    }
                    env.storage()
                        .persistent()
                        .remove(&DataKey::MerchantIndex(last_idx));

                    let size_key = DataKey::MerchantIndexSize;
                    env.storage().persistent().set(&size_key, &(size - 1));
                    env.storage().persistent().extend_ttl(
                        &size_key,
                        MERCHANT_STATE_TTL_LEDGERS,
                        MERCHANT_STATE_TTL_LEDGERS,
                    );
                    break;
                }
            }
        }
    }

    env.storage()
        .persistent()
        .remove(&DataKey::MerchantKnown(merchant.clone()));
}

/// Returns top N merchants ranked by active subscriber count in descending order.
/// `limit` is capped at 20; panics with `BatchTooLarge` if exceeded.
pub fn get_top_merchants_by_subs(env: &Env, limit: u32) -> Vec<(Address, u32)> {
    if limit > TOP_MERCHANTS_PAGE_SIZE {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }
    if limit == 0 {
        return Vec::new(env);
    }

    let total = get_merchant_index_size(env);
    let mut sorted: Vec<(Address, u32)> = Vec::new(env);

    for i in 0..total {
        if let Some(merchant) = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::MerchantIndex(i))
        {
            let count = get_merchant_subscriber_count(env, &merchant) as u32;
            let item = (merchant, count);

            let s_len = sorted.len();
            if s_len < limit || (s_len > 0 && count > sorted.get(s_len - 1).unwrap().1) {
                let mut new_sorted: Vec<(Address, u32)> = Vec::new(env);
                let mut inserted = false;

                for j in 0..s_len {
                    let existing: (Address, u32) = sorted.get(j).unwrap();
                    if !inserted && count > existing.1 {
                        new_sorted.push_back(item.clone());
                        inserted = true;
                    }
                    new_sorted.push_back(existing);
                }
                if !inserted {
                    new_sorted.push_back(item);
                }

                if new_sorted.len() > limit {
                    new_sorted.pop_back();
                }
                sorted = new_sorted;
            }
        }
    }

    sorted
}

/// Increments the per-merchant subscriber count by 1.
pub fn increment_subscriber_count(env: &Env, merchant: &Address) {
    index_merchant(env, merchant);
    let count = get_merchant_subscriber_count(env, merchant);
    let key = DataKey::MerchantSubCount(merchant.clone());
    env.storage().persistent().set(&key, &(count + 1));
    env.storage().persistent().extend_ttl(
        &key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );
}

/// Increments the per-merchant subscriber count and adds `user` to the
/// per-merchant subscriber index (issue #1399).
pub fn increment_subscriber_count_with_user(env: &Env, merchant: &Address, user: &Address) {
    increment_subscriber_count(env, merchant);
    merchant_sub_index_add(env, merchant, user);
}

/// Decrements the per-merchant subscriber count by 1 (floor 0).
pub fn decrement_subscriber_count(env: &Env, merchant: &Address) {
    let count = get_merchant_subscriber_count(env, merchant);
    if count > 0 {
        let key = DataKey::MerchantSubCount(merchant.clone());
        env.storage().persistent().set(&key, &(count - 1));
        env.storage().persistent().extend_ttl(
            &key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );
    }
}

/// Decrements the per-merchant subscriber count and removes `user` from the
/// per-merchant subscriber index (issue #1399).
pub fn decrement_subscriber_count_with_user(env: &Env, merchant: &Address, user: &Address) {
    decrement_subscriber_count(env, merchant);
    merchant_sub_index_remove(env, merchant, user);
}

/// Resets a merchant's revenue accounting to a fully cleared state.
///
/// # Reset semantics (Issue #1215)
///
/// `reset_merchant_revenue` is a *full* clear. It zeroes the cumulative total,
/// removes every per-day bucket referenced by the day-index, empties the
/// day-index, and drops the consolidated `MerchantRevenueHistory`. This is the
/// same "removed" notion `prune_merchant_revenue_days` applies per day (index
/// entry and bucket go together), extended to the whole merchant, so no revenue
/// reader can observe pre-reset data afterwards:
///
/// - `get_merchant_revenue` -> 0
/// - `get_merchant_revenue_summary` -> `(0, 0, 0, 0)`
/// - `get_merchant_revenue_day` -> 0 for every day
/// - `get_merchant_revenue_day_page` -> empty
/// - `get_merchant_revenue_history` -> empty
///
/// `prune_merchant_revenue_days` stays intentionally partial: it removes only
/// the requested day buckets and their index slots while retaining the
/// per-charge history timeline, which carries no day association to prune.
/// Documenting the two together is the point of the choice here — a reset is
/// all-or-nothing, a prune is surgical.
///
/// The `PendingMerchantRevCount` counter is decremented when the merchant had a
/// non-zero total, matching the increment done in `increment_revenue`.
pub fn reset_merchant_revenue(env: &Env, merchant: &Address) {
    let current = get_merchant_revenue(env, merchant);
    if current > 0 {
        decrement_pending_merchant_rev_count(env);
    }
    let key = DataKey::MerchantRevenue(merchant.clone());
    env.storage().persistent().set(&key, &0i128);
    env.storage().persistent().extend_ttl(
        &key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );

    // Drop every per-day bucket referenced by the day-index before emptying it,
    // so a single-day read cannot return pre-reset data.
    let index_key = DataKey::MerchantRevenueDayIndex(merchant.clone());
    let index: Vec<u64> = env
        .storage()
        .persistent()
        .get(&index_key)
        .unwrap_or_else(|| Vec::new(env));
    for day in index.iter() {
        env.storage()
            .persistent()
            .remove(&DataKey::MerchantRevenueDay(merchant.clone(), day));
    }

    // Empty the day-index so repeated reset cycles don't grow it unboundedly.
    let empty: Vec<u64> = Vec::new(env);
    env.storage().persistent().set(&index_key, &empty);
    env.storage().persistent().extend_ttl(
        &index_key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );

    // Clear the consolidated history so summary readers (count/min/max) report
    // the same cleared state as the cumulative total.
    clear_revenue_history(env, merchant);
}

/// Extends the TTL of a specific merchant daily revenue bucket.
pub fn bump_merchant_revenue_day(env: &Env, merchant: &Address, day: u64) {
    let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().extend_ttl(
            &key,
            MERCHANT_STATE_TTL_LEDGERS,
            MERCHANT_STATE_TTL_LEDGERS,
        );
    }
}

/// Prunes missing or expired daily revenue buckets safely.
/// Removes each requested day's storage entry and compacts the day-index so
/// stale slots are never returned by readers. Retains at most
/// `MAX_RETAINED_REVENUE_DAYS` entries (newest) after compaction.
///
/// Panics with `BatchTooLarge` when `days` holds more than
/// `MAX_PRUNE_REVENUE_DAYS` entries.
pub fn prune_merchant_revenue_days(env: &Env, merchant: &Address, days: Vec<u64>) {
    crate::admin::require_admin(env);

    let n = days.len();
    if n > MAX_PRUNE_REVENUE_DAYS {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    // Copy the removed days into a bounded, sorted buffer so each index entry
    // is tested with a binary search: O(|index| * log |days|).
    let mut buf = [0u64; MAX_PRUNE_REVENUE_DAYS as usize];
    for (i, day) in days.iter().enumerate() {
        let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
        env.storage().persistent().remove(&key);
        buf[i] = day;
    }
    let removed_set = &mut buf[..n as usize];
    removed_set.sort_unstable();

    // Compact the day-index: keep entries whose day is not in removed_set.
    let index_key = DataKey::MerchantRevenueDayIndex(merchant.clone());
    let index: Vec<u64> = env
        .storage()
        .persistent()
        .get(&index_key)
        .unwrap_or_else(|| Vec::new(env));

    let mut compacted: Vec<u64> = Vec::new(env);
    for day in index.iter() {
        if removed_set.binary_search(&day).is_err() {
            compacted.push_back(day);
        }
    }

    // Enforce the retention cap: keep only the newest MAX_RETAINED_REVENUE_DAYS entries.
    let cap = MAX_RETAINED_REVENUE_DAYS;
    let final_index = if compacted.len() > cap {
        let start = compacted.len() - cap;
        let mut capped: Vec<u64> = Vec::new(env);
        for i in start..compacted.len() {
            capped.push_back(compacted.get(i).unwrap());
        }
        capped
    } else {
        compacted
    };

    env.storage().persistent().set(&index_key, &final_index);
    env.storage().persistent().extend_ttl(
        &index_key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );
}

/// Retrieves a specific daily revenue bucket.
pub fn get_merchant_revenue_day(env: &Env, merchant: &Address, day: u64) -> i128 {
    let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
    env.storage().persistent().get(&key).unwrap_or(0i128)
}

/// Returns active subscriber counts for multiple merchants in a single call.
/// Capped at 50 merchants; panics with `BatchTooLarge` above that.
/// Returns `(addr, 0)` for merchants with no recorded count.
pub fn get_merchant_sub_counts(env: &Env, merchants: &Vec<Address>) -> Vec<(Address, u64)> {
    if merchants.len() > MAX_MERCHANT_SUB_COUNT_BATCH {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let mut result = Vec::new(env);
    for merchant in merchants.iter() {
        let count = get_merchant_subscriber_count(env, &merchant);
        result.push_back((merchant, count));
    }
    result
}

/// Returns aggregate revenue statistics for a merchant: (total, count, min_charge, max_charge).
/// Returns (0, 0, 0, 0) if no revenue history exists.
///
/// `total` is the all-time cumulative revenue. `count`, `min_charge` and `max_charge`
/// cover only the retained history window (at most `MAX_REVENUE_HISTORY` most recent
/// charges), which is the bound on what this reader decodes.
pub fn get_merchant_revenue_summary(env: &Env, merchant: &Address) -> (i128, i128, i128, i128) {
    let total = get_merchant_revenue(env, merchant);
    let history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&DataKey::MerchantRevenueHistory(merchant.clone()))
        .unwrap_or_else(|| Vec::new(env));

    if history.is_empty() {
        return (total, 0, 0, 0);
    }

    let count = history.len() as i128;
    let mut min_charge = history.get(0).unwrap();
    let mut max_charge = history.get(0).unwrap();

    for i in 1..history.len() {
        let val = history.get(i).unwrap();
        if val < min_charge {
            min_charge = val;
        }
        if val > max_charge {
            max_charge = val;
        }
    }

    (total, count, min_charge, max_charge)
}

/// Returns paginated per-day revenue pairs for a merchant.
/// Limit is capped at 30. Returns an empty Vec if no history or out of bounds.
pub fn get_merchant_revenue_day_page(
    env: &Env,
    merchant: &Address,
    offset: u32,
    limit: u32,
) -> Vec<(u64, i128)> {
    if limit > REVENUE_DAY_PAGE_SIZE {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let index_key = DataKey::MerchantRevenueDayIndex(merchant.clone());
    let index: Vec<u64> = env
        .storage()
        .persistent()
        .get(&index_key)
        .unwrap_or_else(|| Vec::new(env));

    let len = index.len();
    if offset >= len {
        return Vec::new(env);
    }

    let mut out: Vec<(u64, i128)> = Vec::new(env);
    let end = (offset + limit).min(len);
    for i in offset..end {
        let day = index.get(i).unwrap();
        let day_key = DataKey::MerchantRevenueDay(merchant.clone(), day);
        let amount: i128 = env.storage().persistent().get(&day_key).unwrap_or(0);
        out.push_back((day, amount));
    }
    out
}

// ─────────────────────────────────────────────────────────────
// Per-merchant subscriber index (issue #1399)
// ─────────────────────────────────────────────────────────────
//
// Design mirrors the global `SubscriberIndex` / `SubscriberIndexSlot` pattern
// (see `subscription_count.rs`): each merchant owns a compact, slot-indexed Vec
// of subscriber addresses backed by three storage keys:
//
//   MerchantSubIndex(merchant, slot)  — the subscriber address at that slot
//   MerchantSubIndexSlot(merchant, user) — the slot occupied by `user`, for O(1) removal
//   MerchantSubIndexSize(merchant)   — total filled slots
//
// On removal the last-slot entry is swapped into the vacated slot (compact
// swap-remove), keeping the index dense. This matches the `WhitelistIndex`
// compaction pattern used elsewhere.

/// Returns the number of slots in the per-merchant subscriber index.
pub fn get_merchant_sub_index_size(env: &Env, merchant: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantSubIndexSize(merchant.clone()))
        .unwrap_or(0u64)
}

/// Adds `user` to `merchant`'s per-merchant subscriber index.
/// Idempotent: if `user` is already in the index (slot key exists) this is a no-op.
pub fn merchant_sub_index_add(env: &Env, merchant: &Address, user: &Address) {
    let slot_key = DataKey::MerchantSubIndexSlot(merchant.clone(), user.clone());
    if env.storage().persistent().has(&slot_key) {
        return; // already indexed
    }
    let size = get_merchant_sub_index_size(env, merchant);
    let entry_key = DataKey::MerchantSubIndex(merchant.clone(), size);
    env.storage().persistent().set(&entry_key, user);
    // Per-subscriber slot and entry keys must outlive the subscription itself so
    // that cancel and transfer can remove the index entries even after the
    // subscription has not been charged for a long time. Use SUBSCRIPTION_TTL_LEDGERS
    // rather than MERCHANT_STATE_TTL_LEDGERS for the per-subscriber keys.
    env.storage().persistent().extend_ttl(
        &entry_key,
        SUBSCRIPTION_TTL_LEDGERS,
        SUBSCRIPTION_TTL_LEDGERS,
    );
    env.storage().persistent().set(&slot_key, &size);
    env.storage().persistent().extend_ttl(
        &slot_key,
        SUBSCRIPTION_TTL_LEDGERS,
        SUBSCRIPTION_TTL_LEDGERS,
    );
    let size_key = DataKey::MerchantSubIndexSize(merchant.clone());
    env.storage().persistent().set(&size_key, &(size + 1));
    env.storage().persistent().extend_ttl(
        &size_key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );
}

/// Removes `user` from `merchant`'s per-merchant subscriber index using
/// compact swap-remove (O(1) removal, keeps index dense).
/// Idempotent: if `user` is not in the index this is a no-op.
pub fn merchant_sub_index_remove(env: &Env, merchant: &Address, user: &Address) {
    let slot_key = DataKey::MerchantSubIndexSlot(merchant.clone(), user.clone());
    let slot: u64 = match env.storage().persistent().get(&slot_key) {
        Some(s) => s,
        None => return, // not indexed
    };

    let size = get_merchant_sub_index_size(env, merchant);
    let last = size.saturating_sub(1);

    if slot != last {
        // Swap the last entry into the vacated slot.
        let last_key = DataKey::MerchantSubIndex(merchant.clone(), last);
        if let Some(last_user) = env
            .storage()
            .persistent()
            .get::<_, soroban_sdk::Address>(&last_key)
        {
            let vacated_key = DataKey::MerchantSubIndex(merchant.clone(), slot);
            env.storage().persistent().set(&vacated_key, &last_user);
            env.storage().persistent().extend_ttl(
                &vacated_key,
                SUBSCRIPTION_TTL_LEDGERS,
                SUBSCRIPTION_TTL_LEDGERS,
            );
            // Update the swapped user's slot pointer.
            let moved_slot_key = DataKey::MerchantSubIndexSlot(merchant.clone(), last_user);
            env.storage().persistent().set(&moved_slot_key, &slot);
            env.storage().persistent().extend_ttl(
                &moved_slot_key,
                SUBSCRIPTION_TTL_LEDGERS,
                SUBSCRIPTION_TTL_LEDGERS,
            );
        }
    }

    // Remove the last slot entry and the removed user's slot key.
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantSubIndex(merchant.clone(), last));
    env.storage().persistent().remove(&slot_key);

    // Decrement size.
    let size_key = DataKey::MerchantSubIndexSize(merchant.clone());
    env.storage().persistent().set(&size_key, &last);
    env.storage().persistent().extend_ttl(
        &size_key,
        MERCHANT_STATE_TTL_LEDGERS,
        MERCHANT_STATE_TTL_LEDGERS,
    );
}

/// Returns a paginated list of subscriber addresses for `merchant`.
///
/// `offset` is a slot index (not a result count). `limit` is capped at
/// `SUBSCRIBER_PAGE_SIZE` (50). Missing or tombstoned slots are skipped
/// so the caller never sees gaps in the result.
///
/// The returned count matches `get_merchant_subscriber_count` when no
/// re-subscribes or transfers happened between calls; callers should not
/// rely on exact counts matching across calls.
pub fn get_merchant_subscribers(
    env: &Env,
    merchant: &Address,
    offset: u64,
    limit: u32,
) -> Vec<soroban_sdk::Address> {
    let cap = crate::caps::effective_page_size(Some(limit), crate::caps::SUBSCRIBER_PAGE_SIZE);
    let size = get_merchant_sub_index_size(env, merchant);
    let mut result = Vec::new(env);

    if offset >= size || cap == 0 {
        return result;
    }

    let end = (offset + cap as u64).min(size);
    for slot in offset..end {
        let key = DataKey::MerchantSubIndex(merchant.clone(), slot);
        if let Some(user) = env
            .storage()
            .persistent()
            .get::<_, soroban_sdk::Address>(&key)
        {
            result.push_back(user);
        }
    }
    result
}
