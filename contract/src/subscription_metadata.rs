use crate::errors::ContractError;
use crate::events;
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
    events::publish_metadata_set(env, user, &label);
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
    events::publish_metadata_cleared(env, user);
}

/// Transfers the metadata label from one subscriber to another.
/// Moves the label from `old_user` to `new_user`, clears the old entry, and extends TTL.
pub fn transfer_metadata(env: &Env, old_user: &Address, new_user: &Address) {
    let old_key = DataKey::SubscriptionMeta(old_user.clone());
    let new_key = DataKey::SubscriptionMeta(new_user.clone());

    // Get the metadata from the old address
    if let Some(label) = env.storage().persistent().get::<DataKey, String>(&old_key) {
        // Move it to the new address
        env.storage().persistent().set(&new_key, &label);
        env.storage().persistent().extend_ttl(
            &new_key,
            crate::SUBSCRIPTION_TTL_LEDGERS,
            crate::SUBSCRIPTION_TTL_LEDGERS,
        );
    }

    // Clear the old address's metadata
    env.storage().persistent().remove(&old_key);
}
