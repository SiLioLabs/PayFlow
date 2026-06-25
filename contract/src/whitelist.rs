use crate::DataKey;
use soroban_sdk::{Address, Env};
use crate::events;

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
    events::publish_merchant_added(env, merchant);
}

/// Removes a merchant from the whitelist.
pub fn remove_merchant(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantWhitelist(merchant.clone()));
    events::publish_merchant_removed(env, merchant);
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
    env.storage()
        .instance()
        .set(&DataKey::WhitelistEnabled, &enabled);
}

/// Checks if a merchant is frozen. Independent of whitelist status.
pub fn is_frozen(env: &Env, merchant: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MerchantFrozen(merchant.clone()))
}

/// Freezes a merchant, blocking new subscriptions. Idempotent.
pub fn freeze(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::MerchantFrozen(merchant.clone()), &true);
    events::publish_merchant_frozen(env, merchant);
}

/// Unfreezes a merchant, allowing new subscriptions again. Idempotent.
pub fn unfreeze(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantFrozen(merchant.clone()));
    events::publish_merchant_unfrozen(env, merchant);
}
