use soroban_sdk::{Address, Env, Vec};

use crate::DataKey;

/// Returns the total revenue accumulated for a merchant.
pub fn get_merchant_revenue(env: &Env, merchant: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantRevenue(merchant.clone()))
        .unwrap_or(0i128)
}

/// Adds `amount` to the merchant's running revenue total.
pub fn increment_revenue(env: &Env, merchant: &Address, amount: i128) {
    let current = get_merchant_revenue(env, merchant);
    let key = DataKey::MerchantRevenue(merchant.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage()
        .persistent()
        .extend_ttl(&key, 1555200, 1555200);
}

/// Returns the merchant's revenue history as a Vec (oldest -> newest), limited to the
/// most recent `days` entries. Returns an empty Vec when unset or after clearing.
pub fn get_merchant_revenue_history(env: &Env, merchant: &Address, days: u32) -> Vec<i128> {
    let history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&DataKey::MerchantRevenueHistory(merchant.clone()))
        .unwrap_or_else(|| Vec::new(env));

    if days == 0 || history.is_empty() {
        return Vec::new(env);
    }

    let len = history.len();
    let start = len.saturating_sub(days);
    let mut out = Vec::new(env);
    for i in start..len {
        out.push_back(history.get(i).unwrap());
    }
    out
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
    env.storage()
        .persistent()
        .extend_ttl(&day_key, 1555200, 1555200);

    if is_new_day {
        let index_key = DataKey::MerchantRevenueDayIndex(merchant.clone());
        let mut index: Vec<u64> = env
            .storage()
            .persistent()
            .get(&index_key)
            .unwrap_or_else(|| Vec::new(env));
        index.push_back(today);
        env.storage().persistent().set(&index_key, &index);
        env.storage()
            .persistent()
            .extend_ttl(&index_key, 1555200, 1555200);
    }

    // append to consolidated history Vec
    let hist_key = DataKey::MerchantRevenueHistory(merchant.clone());
    let mut history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&hist_key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(amount);
    env.storage().persistent().set(&hist_key, &history);
    env.storage()
        .persistent()
        .extend_ttl(&hist_key, 1555200, 1555200);
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

/// Indexes a merchant if not already indexed.
pub fn index_merchant(env: &Env, merchant: &Address) {
    let known_key = DataKey::MerchantKnown(merchant.clone());
    if !env.storage().persistent().has(&known_key) {
        let slot = get_merchant_index_size(env);
        let index_key = DataKey::MerchantIndex(slot);
        env.storage().persistent().set(&index_key, merchant);
        env.storage()
            .persistent()
            .extend_ttl(&index_key, 1555200, 1555200);

        env.storage().persistent().set(&known_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&known_key, 1555200, 1555200);

        let size_key = DataKey::MerchantIndexSize;
        env.storage().persistent().set(&size_key, &(slot + 1));
        env.storage()
            .persistent()
            .extend_ttl(&size_key, 1555200, 1555200);
    }
}

/// Returns top N merchants ranked by active subscriber count in descending order.
/// `limit` is capped at 20; panics with `BatchTooLarge` if exceeded.
pub fn get_top_merchants_by_subs(env: &Env, limit: u32) -> Vec<(Address, u32)> {
    if limit > 20 {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let total = get_merchant_index_size(env);
    let mut list: Vec<(Address, u32)> = Vec::new(env);

    for i in 0..total {
        if let Some(merchant) = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::MerchantIndex(i))
        {
            let count = get_merchant_subscriber_count(env, &merchant) as u32;
            list.push_back((merchant, count));
        }
    }

    let len = list.len();
    let mut sorted: Vec<(Address, u32)> = Vec::new(env);
    if len > 0 {
        for i in 0..len {
            let item = list.get(i).unwrap();
            let mut inserted = false;
            let mut new_sorted: Vec<(Address, u32)> = Vec::new(env);
            let s_len = sorted.len();

            for j in 0..s_len {
                let existing: (Address, u32) = sorted.get(j).unwrap();
                if !inserted && item.1 > existing.1 {
                    new_sorted.push_back(item.clone());
                    inserted = true;
                }
                new_sorted.push_back(existing);
            }
            if !inserted {
                new_sorted.push_back(item);
            }
            sorted = new_sorted;
        }
    }

    let effective_limit = if limit < sorted.len() {
        limit
    } else {
        sorted.len()
    };

    let mut result = Vec::new(env);
    for i in 0..effective_limit {
        result.push_back(sorted.get(i).unwrap());
    }

    result
}

/// Increments the per-merchant subscriber count by 1.
pub fn increment_subscriber_count(env: &Env, merchant: &Address) {
    index_merchant(env, merchant);
    let count = get_merchant_subscriber_count(env, merchant);
    let key = DataKey::MerchantSubCount(merchant.clone());
    env.storage().persistent().set(&key, &(count + 1));
    env.storage()
        .persistent()
        .extend_ttl(&key, 1555200, 1555200);
}

/// Decrements the per-merchant subscriber count by 1 (floor 0).
pub fn decrement_subscriber_count(env: &Env, merchant: &Address) {
    let count = get_merchant_subscriber_count(env, merchant);
    if count > 0 {
        let key = DataKey::MerchantSubCount(merchant.clone());
        env.storage().persistent().set(&key, &(count - 1));
        env.storage()
            .persistent()
            .extend_ttl(&key, 1555200, 1555200);
    }
}

/// Resets a merchant's cumulative revenue counter to zero.
pub fn reset_merchant_revenue(env: &Env, merchant: &Address) {
    let key = DataKey::MerchantRevenue(merchant.clone());
    env.storage().persistent().set(&key, &0i128);
    env.storage()
        .persistent()
        .extend_ttl(&key, 1555200, 1555200);
}

/// Extends the TTL of a specific merchant daily revenue bucket.
pub fn bump_merchant_revenue_day(env: &Env, merchant: &Address, day: u64) {
    let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
    if env.storage().persistent().has(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, 1555200, 1555200);
    }
}

/// Prunes missing or expired daily revenue buckets safely.
pub fn prune_merchant_revenue_days(env: &Env, merchant: &Address, days: Vec<u64>) {
    crate::admin::require_admin(env);
    for day in days.into_iter() {
        let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
        env.storage().persistent().remove(&key);
    }
}

/// Retrieves a specific daily revenue bucket.
pub fn get_merchant_revenue_day(env: &Env, merchant: &Address, day: u64) -> i128 {
    let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
    env.storage().persistent().get(&key).unwrap_or(0i128)
}

const MAX_MERCHANT_SUB_COUNT_BATCH: u32 = 50;

/// Returns active subscriber counts for multiple merchants in a single call.
/// Capped at 50 merchants; panics with `BatchTooLarge` above that.
/// Returns `(addr, 0)` for merchants with no recorded count.
pub fn get_merchant_sub_counts(env: &Env, merchants: &Vec<Address>) -> Vec<(Address, u32)> {
    if merchants.len() > MAX_MERCHANT_SUB_COUNT_BATCH {
        env.panic_with_error(crate::errors::ContractError::BatchTooLarge);
    }

    let mut result = Vec::new(env);
    for merchant in merchants.iter() {
        let count = crate::subscription_count::get_merchant_sub_count(env, &merchant);
        result.push_back((merchant, count));
    }
    result
}

/// Returns aggregate revenue statistics for a merchant: (total, count, min_charge, max_charge).
/// Returns (0, 0, 0, 0) if no revenue history exists.
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
    if limit > 30 {
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
