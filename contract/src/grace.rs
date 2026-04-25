use soroban_sdk::Env;
use crate::DataKey;

/// Retrieves the contract-wide grace period from instance storage.
/// Returns 0 if not set.
pub fn get_grace_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::GracePeriod)
        .unwrap_or(0)
}

/// Sets the contract-wide grace period in instance storage.
pub fn set_grace_period(env: &Env, seconds: u64) {
    env.storage().instance().set(&DataKey::GracePeriod, &seconds);
}
