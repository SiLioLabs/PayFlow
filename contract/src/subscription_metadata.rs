use crate::errors::ContractError;
use crate::DataKey;
use crate::SUBSCRIPTION_TTL_LEDGERS;
use soroban_sdk::{Address, Env, String};

/// Stores a short metadata label for a subscriber (e.g. plan name).
/// Overwrites any previously stored value. Enforces a 64-byte max length limit.
pub fn set_metadata(env: &Env, user: &Address, label: String) -> Result<(), ContractError> {
    // Enforce max label length of 64 bytes
    if label.len() > 64 {
        return Err(ContractError::MetadataLabelTooLong);
    }
    env.storage()
        .persistent()
        .set(&DataKey::SubscriptionMeta(user.clone()), &label);
    env.storage().persistent().extend_ttl(
        &DataKey::SubscriptionMeta(user.clone()),
        SUBSCRIPTION_TTL_LEDGERS,
        SUBSCRIPTION_TTL_LEDGERS,
    );
    Ok(())
}

/// Returns the metadata label for a subscriber, or `None` if not set.
pub fn get_metadata(env: &Env, user: &Address) -> Option<String> {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriptionMeta(user.clone()))
}

/// Removes the metadata label for a subscriber, if one is set.
pub fn clear_metadata(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::SubscriptionMeta(user.clone()));
}
