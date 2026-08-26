use soroban_sdk::{Address, Env};

use crate::{errors::ContractError, events, DataKey};

/// Removes the referrer for a given subscriber.
pub fn remove_referral(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Referral(user.clone()));
}

/// Returns the referrer for a given subscriber, if one was recorded.
pub fn get_referrer(env: &Env, user: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Referral(user.clone()))
}

/// Stores the referrer for a subscriber. Clears any prior referrer when `None`.
pub fn store_referral(env: &Env, user: &Address, referrer: &Option<Address>) {
    let key = DataKey::Referral(user.clone());
    if let Some(ref r) = referrer {
        if r == user {
            env.panic_with_error(ContractError::SelfReferral);
        }
        env.storage().persistent().set(&key, r);

        events::publish_referred(env, user, r);
    } else {
        env.storage().persistent().remove(&key);
    }
}
