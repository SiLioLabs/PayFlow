use soroban_sdk::{Address, Env, String};

use crate::DataKey;

/// Stores a short metadata label for a subscriber (e.g. plan name).
/// Overwrites any previously stored value.
pub fn set_metadata(env: &Env, user: &Address, label: String) {
    env.storage()
        .persistent()
        .set(&DataKey::SubscriptionMeta(user.clone()), &label);
}

/// Returns the metadata label for a subscriber, or `None` if not set.
pub fn get_metadata(env: &Env, user: &Address) -> Option<String> {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriptionMeta(user.clone()))
}
