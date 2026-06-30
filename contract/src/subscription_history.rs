use soroban_sdk::{Address, Env, Vec};

use crate::{DataKey, SUBSCRIPTION_TTL_LEDGERS};

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

    let key = DataKey::ChargeHistory(user.clone());
    env.storage().persistent().set(&key, &history);
    env.storage().persistent().extend_ttl(
        &key,
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}

/// Removes the ChargeHistory entry for a subscriber entirely.
pub fn prune_charge_history(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::ChargeHistory(user.clone()));
}

/// Returns the current TTL (in ledgers) of the ChargeHistory entry, or 0 if absent.
pub fn get_charge_history_ttl(env: &Env, user: &Address) -> u32 {
    let key = DataKey::ChargeHistory(user.clone());
    if env.storage().persistent().has(&key) {
        env.storage().persistent().get_ttl(&key)
    } else {
        0
    }
        .set(&DataKey::ChargeHistory(user.clone()), &history);

    env.storage().persistent().extend_ttl(
        &DataKey::ChargeHistory(user.clone()),
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}

/// Clears the stored charge history for a subscriber.
pub fn clear_charge_history(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::ChargeHistory(user.clone()));
}

/// Returns a paginated slice of charge timestamps for a subscriber.
/// `limit` is capped at 12.
pub fn get_charge_history_page(env: &Env, user: &Address, offset: u32, limit: u32) -> Vec<u64> {
    let history = get_charge_history(env, user);
    let mut page = Vec::new(env);

    let effective_limit = if limit > MAX_HISTORY {
        MAX_HISTORY
    } else {
        limit
    };

    let total = history.len();
    if offset >= total {
        return page;
    }

    let end = if offset + effective_limit > total {
        total
    } else {
        offset + effective_limit
    };

    for i in offset..end {
        page.push_back(history.get(i).unwrap());
    }

    page
}
