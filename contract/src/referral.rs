use soroban_sdk::{Address, Env};

use crate::{errors::ContractError, events, DataKey, SUBSCRIPTION_TTL_LEDGERS};

/// Removes the referrer for a given subscriber.
///
/// Called during cancel/unsubscribe to keep the index accurate —
/// no orphaned `Referral` entries remain after a clean removal.
pub fn remove_referral(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Referral(user.clone()));
}

/// Returns the referrer for a given subscriber, if one was recorded.
///
/// Bumps the TTL on every successful read so that active referral
/// relations remain live as long as the subscription is in use.
pub fn get_referrer(env: &Env, user: &Address) -> Option<Address> {
    let key = DataKey::Referral(user.clone());
    let result: Option<Address> = env.storage().persistent().get(&key);
    if result.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    }
    result
}

/// Stores the referrer for a subscriber. Clears any prior referrer when `None`.
///
/// Extends the TTL of the `Referral(user)` key to match subscription
/// lifetime so that attribution is never silently lost to archival.
pub fn store_referral(env: &Env, user: &Address, referrer: &Option<Address>) {
    let key = DataKey::Referral(user.clone());
    if let Some(ref r) = referrer {
        if r == user {
            env.panic_with_error(ContractError::SelfReferral);
        }
        env.storage().persistent().set(&key, r);
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );

        events::publish_referred(env, user, r);
    } else if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}
