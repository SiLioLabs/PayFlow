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

/// Returns the count of stored charge timestamps for a subscriber.
pub fn get_charge_history_count(env: &Env, user: &Address) -> u32 {
    let opt_history: Option<Vec<u64>> = env
        .storage()
        .persistent()
        .get(&DataKey::ChargeHistory(user.clone()));
    match opt_history {
        Some(history) => history.len(),
        None => 0,
    }
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
pub fn get_charge_history_ttl(_env: &Env, _user: &Address) -> u32 {
    #[cfg(any(test, feature = "testutils"))]
    {
        use soroban_sdk::testutils::storage::Persistent;
        let key = DataKey::ChargeHistory(_user.clone());
        if _env.storage().persistent().has(&key) {
            _env.storage().persistent().get_ttl(&key)
        } else {
            0
        }
    }
    #[cfg(not(any(test, feature = "testutils")))]
    {
        0
    }
}

/// Clears the stored charge history for a subscriber.
pub fn clear_charge_history(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::ChargeHistory(user.clone()));
}

/// Returns a paginated slice of charge timestamps for a subscriber.
/// `limit` is capped at 12. If `ascending` is false, records are returned in descending order (newest first).
pub fn get_charge_history_page(
    env: &Env,
    user: &Address,
    offset: u32,
    limit: u32,
    ascending: bool,
) -> Vec<u64> {
    let history = get_charge_history(env, user);
    let mut ordered_history = Vec::new(env);

    let total = history.len();
    if !ascending && total > 0 {
        let mut i = total;
        while i > 0 {
            i -= 1;
            ordered_history.push_back(history.get(i).unwrap());
        }
    } else {
        ordered_history = history;
    }

    let mut page = Vec::new(env);

    let effective_limit = if limit > MAX_HISTORY {
        MAX_HISTORY
    } else {
        limit
    };

    let total_ordered = ordered_history.len();
    if offset >= total_ordered {
        return page;
    }

    let end = if offset + effective_limit > total_ordered {
        total_ordered
    } else {
        offset + effective_limit
    };

    for i in offset..end {
        page.push_back(ordered_history.get(i).unwrap());
    }

    page
}
