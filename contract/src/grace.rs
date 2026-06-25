use crate::{DataKey, SUBSCRIPTION_TTL_LEDGERS};
use soroban_sdk::Env;

/// Retrieves the contract-wide grace period from instance storage.
/// Returns 0 if not set. When present, refresh the instance entry's TTL
/// to make sure the configuration is not accidentally evicted.
pub fn get_grace_period(env: &Env) -> u64 {
    if let Some(seconds) = env.storage().instance().get(&DataKey::GracePeriod) {
        // Refresh TTL to keep this important config alive.
        let lower = SUBSCRIPTION_TTL_LEDGERS / 2;
        let upper = SUBSCRIPTION_TTL_LEDGERS;
        env.storage().instance().extend_ttl(lower, upper);
        seconds
    } else {
        0
    }
}

/// Sets the contract-wide grace period in instance storage and extends
/// the storage TTL thresholds to ensure the parameter is preserved.
pub fn set_grace_period(env: &Env, seconds: u64) {
    // Basic sanity check to avoid absurdly large values that could cause
    // downstream arithmetic issues.
    assert!(seconds <= u64::MAX / 2, "grace period too large");

    env.storage().instance().set(&DataKey::GracePeriod, &seconds);

    // Ensure the instance entry receives a long-lived TTL so it won't be
    // evicted while still in active use. Use a threshold between half and
    // the full subscription TTL ledgers.
    let lower = SUBSCRIPTION_TTL_LEDGERS / 2;
    let upper = SUBSCRIPTION_TTL_LEDGERS;
    env.storage().instance().extend_ttl(lower, upper);
}
