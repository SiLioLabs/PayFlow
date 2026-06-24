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
    env.storage().persistent().set(
        &DataKey::MerchantRevenue(merchant.clone()),
        &(current + amount),
    );
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

    // append to consolidated history Vec
    let hist_key = DataKey::MerchantRevenueHistory(merchant.clone());
    let mut history: Vec<i128> = env
        .storage()
        .persistent()
        .get(&hist_key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(amount);
    env.storage().persistent().set(&hist_key, &history);
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
    env.storage()
        .persistent()
        .set(&DataKey::MerchantSubCount(merchant.clone()), &(count + 1));
}

/// Decrements the per-merchant subscriber count by 1 (floor 0).
pub fn decrement_subscriber_count(env: &Env, merchant: &Address) {
    let count = get_merchant_subscriber_count(env, merchant);
    if count > 0 {
        env.storage()
            .persistent()
            .set(&DataKey::MerchantSubCount(merchant.clone()), &(count - 1));
    }
}

/// Resets a merchant's cumulative revenue counter to zero.
pub fn reset_merchant_revenue(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::MerchantRevenue(merchant.clone()), &0i128);
}
