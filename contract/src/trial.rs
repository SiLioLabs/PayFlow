use crate::storage;
use soroban_sdk::{Address, Env};

/// Returns the timestamp when the trial period ends, or None if no active trial.
/// A trial is active if the last_charged timestamp is set in the future.
pub fn get_trial_end(env: Env, user: Address) -> Option<u64> {
    let sub = storage::get_subscription(&env, &user)?;
    let now = env.ledger().timestamp();

    if sub.last_charged > now {
        Some(sub.last_charged)
    } else {
        None
    }
}

pub fn extend_trial(env: &Env, user: &Address, additional_seconds: u64) {
    if additional_seconds == 0 {
        env.panic_with_error(crate::errors::ContractError::IntervalMustBePositive);
    }

    let mut sub = storage::get_subscription(env, user)
        .unwrap_or_else(|| env.panic_with_error(crate::errors::ContractError::NoSubscriptionFound));

    if !sub.active {
        env.panic_with_error(crate::errors::ContractError::SubscriptionInactive);
    }
    if sub.paused {
        env.panic_with_error(crate::errors::ContractError::SubscriptionPaused);
    }

    // Fail closed with a typed error rather than a string panic when the trial
    // end would run past u64::MAX.
    sub.last_charged = sub
        .last_charged
        .checked_add(additional_seconds)
        .unwrap_or_else(|| env.panic_with_error(crate::errors::ContractError::ArithmeticOverflow));

    storage::set_subscription(env, user, &sub);

    crate::events::publish_trial_extended(env, user, additional_seconds, sub.last_charged);
}
