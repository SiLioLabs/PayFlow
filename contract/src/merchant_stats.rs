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
    env.storage().persistent().set(
        &key,
        &(current + amount),
    );
    env.storage().persistent().extend_ttl(&key, 1555200, 1555200);
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
    let start = if len > days { len - days } else { 0 };
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
    let current_day: i128 = env.storage().persistent().get(&day_key).unwrap_or(0i128);
    env.storage()
        .persistent()
        .set(&day_key, &(current_day + amount));
    // extend TTL: 1,555,200 ledgers (~90 days)
    env.storage().persistent().extend_ttl(&day_key, 1555200, 1555200);

    // append to consolidated history Vec
    let hist_key = DataKey::MerchantRevenueHistory(merchant.clone());
    let mut history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&hist_key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(amount);
    env.storage().persistent().set(&hist_key, &history);
    env.storage().persistent().extend_ttl(&hist_key, 1555200, 1555200);
}

/// Returns the number of active subscribers for a merchant.
pub fn get_merchant_subscriber_count(env: &Env, merchant: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantSubCount(merchant.clone()))
        .unwrap_or(0u64)
}

/// Increments the per-merchant subscriber count by 1.
pub fn increment_subscriber_count(env: &Env, merchant: &Address) {
    let count = get_merchant_subscriber_count(env, merchant);
    let key = DataKey::MerchantSubCount(merchant.clone());
    env.storage()
        .persistent()
        .set(&key, &(count + 1));
    env.storage().persistent().extend_ttl(&key, 1555200, 1555200);
}

/// Decrements the per-merchant subscriber count by 1 (floor 0).
pub fn decrement_subscriber_count(env: &Env, merchant: &Address) {
    let count = get_merchant_subscriber_count(env, merchant);
    if count > 0 {
        let key = DataKey::MerchantSubCount(merchant.clone());
        env.storage()
            .persistent()
            .set(&key, &(count - 1));
        env.storage().persistent().extend_ttl(&key, 1555200, 1555200);
    }
}

/// Resets a merchant's cumulative revenue counter to zero.
pub fn reset_merchant_revenue(env: &Env, merchant: &Address) {
    let key = DataKey::MerchantRevenue(merchant.clone());
    env.storage()
        .persistent()
        .set(&key, &0i128);
    env.storage().persistent().extend_ttl(&key, 1555200, 1555200);
}

/// Extends the TTL of a specific merchant daily revenue bucket.
pub fn bump_merchant_revenue_day(env: &Env, merchant: &Address, day: u64) {
    let key = DataKey::MerchantRevenueDay(merchant.clone(), day);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().extend_ttl(&key, 1555200, 1555200);
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
