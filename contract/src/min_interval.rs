use soroban_sdk::Env;

use crate::DataKey;

pub const DEFAULT_MIN_INTERVAL: u64 = 3600; // 1 hour

/// Returns the minimum allowed subscription interval in seconds.
/// Defaults to 3600 (1 hour) when unset.
pub fn get_min_interval(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MinInterval)
        .unwrap_or(DEFAULT_MIN_INTERVAL)
}

/// Persists the minimum interval floor to instance storage.
pub fn set_min_interval(env: &Env, seconds: u64) {
    env.storage()
        .instance()
        .set(&DataKey::MinInterval, &seconds);
}
