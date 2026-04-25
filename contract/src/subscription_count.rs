use soroban_sdk::Env;

use crate::DataKey;

/// Returns the current number of active subscriptions.
pub fn get_active_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ActiveCount)
        .unwrap_or(0u64)
}

/// Increments the active subscription counter by 1.
pub fn increment(env: &Env) {
    let count = get_active_count(env);
    env.storage()
        .instance()
        .set(&DataKey::ActiveCount, &(count + 1));
}

/// Decrements the active subscription counter by 1 (floor 0).
pub fn decrement(env: &Env) {
    let count = get_active_count(env);
    if count > 0 {
        env.storage()
            .instance()
            .set(&DataKey::ActiveCount, &(count - 1));
    }
}
