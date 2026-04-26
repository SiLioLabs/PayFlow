use soroban_sdk::{Address, Env, Vec};

use crate::DataKey;

/// Maximum number of charge timestamps retained per subscriber.
const MAX_HISTORY: u32 = 12;

/// Returns the stored charge timestamps for a subscriber (oldest → newest).
pub fn get_charge_history(env: &Env, user: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ChargeHistory(user.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Appends `timestamp` to the subscriber's charge history.
/// Drops the oldest entry when the buffer exceeds `MAX_HISTORY`.
pub fn record_charge(env: &Env, user: &Address, timestamp: u64) {
    let mut history = get_charge_history(env, user);

    if history.len() >= MAX_HISTORY {
        // Remove the oldest entry (index 0)
        let mut trimmed: Vec<u64> = Vec::new(env);
        for i in 1..history.len() {
            trimmed.push_back(history.get(i).unwrap());
        }
        history = trimmed;
    }

    history.push_back(timestamp);

    env.storage()
        .persistent()
        .set(&DataKey::ChargeHistory(user.clone()), &history);
}
