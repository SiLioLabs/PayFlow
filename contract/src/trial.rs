use crate::storage;
use crate::{DataKey, SUBSCRIPTION_TTL_LEDGERS};
use soroban_sdk::{Address, Env};

/// Maximum seconds that a single `extend_trial` call may add.
pub const MAX_TRIAL_EXTENSION: u64 = 90 * 24 * 60 * 60; // 90 days

/// Maximum trial end distance from the current ledger time. Extensions that
/// would push `last_charged` past `now + MAX_TOTAL_TRIAL` are rejected, so
/// repeated calls cannot grant an effectively unlimited free subscription.
pub const MAX_TOTAL_TRIAL: u64 = 365 * 24 * 60 * 60; // 365 days

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

/// Panics with `TrialAlreadyUsed` if `(user, merchant)` has already consumed
/// its one trial. Matches the contract's existing convention of rejecting an
/// already-done action with a typed error (see `SubscriptionAlreadyActive`)
/// rather than silently downgrading the requested behavior.
pub fn require_trial_unused(env: &Env, user: &Address, merchant: &Address) {
    let key = DataKey::TrialUsed(user.clone(), merchant.clone());
    let used: bool = env.storage().persistent().get(&key).unwrap_or(false);
    if used {
        env.panic_with_error(crate::errors::ContractError::TrialAlreadyUsed);
    }
}

/// Records that `(user, merchant)` has consumed its one trial. Persistent
/// and TTL-bumped like a subscription entry, so it outlives a cancel.
pub fn mark_trial_used(env: &Env, user: &Address, merchant: &Address) {
    let key = DataKey::TrialUsed(user.clone(), merchant.clone());
    env.storage().persistent().set(&key, &true);
    env.storage().persistent().extend_ttl(
        &key,
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}

pub fn extend_trial(env: &Env, user: &Address, additional_seconds: u64) {
    if additional_seconds == 0 {
        env.panic_with_error(crate::errors::ContractError::IntervalMustBePositive);
    }
    if additional_seconds > MAX_TRIAL_EXTENSION {
        env.panic_with_error(crate::errors::ContractError::TrialExtensionExceedsMaximum);
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

    // Total-trial cap: the trial end may never sit more than one year ahead of
    // the current ledger time, no matter how many capped extensions are chained.
    let max_trial_end = env
        .ledger()
        .timestamp()
        .checked_add(MAX_TOTAL_TRIAL)
        .unwrap_or(u64::MAX);
    if sub.last_charged > max_trial_end {
        env.panic_with_error(crate::errors::ContractError::TrialExtensionExceedsMaximum);
    }

    storage::set_subscription(env, user, &sub);

    crate::events::publish_trial_extended(env, user, additional_seconds, sub.last_charged);
}
