use soroban_sdk::{Address, Env};
use crate::DataKey;

/// Checks if a merchant is whitelisted.
pub fn is_whitelisted(env: &Env, merchant: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MerchantWhitelist(merchant.clone()))
}

/// Adds a merchant to the whitelist.
pub fn add_merchant(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::MerchantWhitelist(merchant.clone()), &true);
}

/// Removes a merchant from the whitelist.
pub fn remove_merchant(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantWhitelist(merchant.clone()));
}

/// Checks if the merchant whitelist is currently enabled.
pub fn is_whitelist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::WhitelistEnabled)
        .unwrap_or(false)
}

/// Enables or disables the merchant whitelist.
pub fn set_whitelist_enabled(env: &Env, enabled: bool) {
    env.storage().instance().set(&DataKey::WhitelistEnabled, &enabled);
}
