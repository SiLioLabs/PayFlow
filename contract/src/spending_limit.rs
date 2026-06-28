use soroban_sdk::{Address, Env};

use crate::DataKey;

/// Approximate number of ledgers in one day.
/// Stellar closes ~1 ledger every 5 seconds → 17,280 ledgers/day.
const LEDGERS_PER_DAY: u32 = 17_280;

/// Returns the daily spending limit for a user, or `None` if not set.
pub fn get_daily_limit(env: &Env, user: &Address) -> Option<i128> {
    env.storage()
        .temporary()
        .get(&DataKey::DailyLimit(user.clone()))
}

/// Sets (or overwrites) the daily spending limit for a user.
/// The entry lives in temporary storage with a TTL of ~1 day.
pub fn set_daily_limit(env: &Env, user: &Address, limit: i128) {
    let key = DataKey::DailyLimit(user.clone());
    env.storage().temporary().set(&key, &limit);
    env.storage()
        .temporary()
        .extend_ttl(&key, LEDGERS_PER_DAY, LEDGERS_PER_DAY);
}

/// Removes the daily spending limit for a user.
pub fn remove_daily_limit(env: &Env, user: &Address) {
    env.storage()
        .temporary()
        .remove(&DataKey::DailyLimit(user.clone()));
    env.storage()
        .temporary()
        .remove(&DataKey::DailySpent(user.clone()));
    env.storage()
        .temporary()
        .remove(&DataKey::DayStart(user.clone()));
}

/// Returns how much the user has spent today, defaulting to 0.
pub fn get_daily_spent(env: &Env, user: &Address) -> i128 {
    let day_start_key = DataKey::DayStart(user.clone());
    if !env.storage().temporary().has(&day_start_key) {
        return 0;
    }
    
    env.storage()
        .temporary()
        .get(&DataKey::DailySpent(user.clone()))
        .unwrap_or(0i128)
}

/// Records `amount` as spent today for the user.
/// Anchors TTL to the first spend of the day using DayStart.
pub fn record_spend(env: &Env, user: &Address, amount: i128) {
    let day_start_key = DataKey::DayStart(user.clone());
    let spent_key = DataKey::DailySpent(user.clone());
    let spent = get_daily_spent(env, user);
    
    if !env.storage().temporary().has(&day_start_key) {
        env.storage().temporary().set(&day_start_key, &());
        env.storage().temporary().extend_ttl(&day_start_key, LEDGERS_PER_DAY, LEDGERS_PER_DAY);
    }
    
    env.storage().temporary().set(&spent_key, &(spent + amount));
    env.storage()
        .temporary()
        .extend_ttl(&spent_key, LEDGERS_PER_DAY, LEDGERS_PER_DAY);
}

/// Checks whether `amount` would exceed the user's daily limit.
/// Panics with ContractError::DailyLimitExceeded if the limit would be exceeded.
pub fn enforce_limit(env: &Env, user: &Address, amount: i128) {
    if let Some(limit) = get_daily_limit(env, user) {
        let spent = get_daily_spent(env, user);
        if spent + amount > limit {
            env.panic_with_error(crate::errors::ContractError::DailyLimitExceeded);
        }
    }
}
