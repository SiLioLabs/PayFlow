use soroban_sdk::{Address, Env};
use crate::storage;

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
