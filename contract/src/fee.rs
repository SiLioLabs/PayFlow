use soroban_sdk::{Address, Env};
use crate::DataKey;

/// Retrieves the fee collector address from instance storage.
pub fn get_fee_collector(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::FeeCollector)
}

/// Retrieves the fee in basis points (bps) from instance storage.
/// 1 bps = 0.01%
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

/// Sets the fee collector and basis points.
pub fn set_fee(env: &Env, collector: Address, bps: u32) {
    env.storage().instance().set(&DataKey::FeeCollector, &collector);
    env.storage().instance().set(&DataKey::FeeBps, &bps);
}
