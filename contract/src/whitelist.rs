use crate::events;
use crate::merchant_stats;
use crate::DataKey;
use soroban_sdk::{Address, Env, Vec};

/// Checks if a merchant is whitelisted.
pub fn is_whitelisted(env: &Env, merchant: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MerchantWhitelist(merchant.clone()))
}

/// Returns the total count of whitelisted merchants in the index.
pub fn get_whitelist_size(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::WhitelistIndexSize)
        .unwrap_or(0u32)
}

/// Adds a merchant to the whitelist. Idempotent.
pub fn add_merchant(env: &Env, merchant: &Address) {
    if is_whitelisted(env, merchant) {
        return;
    }
    let key = DataKey::MerchantWhitelist(merchant.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, 1555200, 1555200);

    let size = get_whitelist_size(env);
    let index_key = DataKey::WhitelistIndex(size);
    env.storage().persistent().set(&index_key, merchant);
    env.storage()
        .persistent()
        .extend_ttl(&index_key, 1555200, 1555200);

    let size_key = DataKey::WhitelistIndexSize;
    env.storage().persistent().set(&size_key, &(size + 1));
    env.storage()
        .persistent()
        .extend_ttl(&size_key, 1555200, 1555200);

        env.storage()
        .persistent()
        .set(&DataKey::MerchantWhitelist(merchant.clone()), &true);
    merchant_stats::index_merchant(env, merchant);
    events::publish_merchant_added(env, merchant);
}

/// Removes a merchant from the whitelist. Idempotent.
pub fn remove_merchant(env: &Env, merchant: &Address) {
    if !is_whitelisted(env, merchant) {
        return;
    }
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantWhitelist(merchant.clone()));

    let size = get_whitelist_size(env);
    if size > 0 {
        for i in 0..size {
            let key = DataKey::WhitelistIndex(i);
            if let Some(addr) = env.storage().persistent().get::<_, Address>(&key) {
                if addr == *merchant {
                    let last_idx = size - 1;
                    if i != last_idx {
                        let last_key = DataKey::WhitelistIndex(last_idx);
                        if let Some(last_addr) =
                            env.storage().persistent().get::<_, Address>(&last_key)
                        {
                            env.storage().persistent().set(&key, &last_addr);
                            env.storage()
                                .persistent()
                                .extend_ttl(&key, 1555200, 1555200);
                        }
                    }
                    env.storage()
                        .persistent()
                        .remove(&DataKey::WhitelistIndex(last_idx));
                    let size_key = DataKey::WhitelistIndexSize;
                    env.storage().persistent().set(&size_key, &(size - 1));
                    env.storage()
                        .persistent()
                        .extend_ttl(&size_key, 1555200, 1555200);
                    break;
                }
            }
        }
    }

    events::publish_merchant_removed(env, merchant);
}

/// Returns a paginated vector of whitelisted merchants.
pub fn get_whitelist_page(env: &Env, offset: u32, limit: u32) -> Vec<Address> {
    let size = get_whitelist_size(env);
    if offset >= size || limit == 0 {
        return Vec::new(env);
    }
    let end = (offset + limit).min(size);
    let mut out = Vec::new(env);
    for i in offset..end {
        let key = DataKey::WhitelistIndex(i);
        if let Some(addr) = env.storage().persistent().get::<_, Address>(&key) {
            out.push_back(addr);
        }
    }
    out
}

/// Checks if the merchant whitelist is currently enabled. Defaults to true.
pub fn is_whitelist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::WhitelistEnabled)
        .unwrap_or(true)
}

/// Returns whether the merchant whitelist is currently enabled. Defaults to true.
pub fn get_whitelist_enabled(env: &Env) -> bool {
    is_whitelist_enabled(env)
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
pub fn freeze(env: &Env, merchant: &Address, reason: Option<soroban_sdk::String>) {
    if let Some(r) = &reason {
        if r.len() > 128 {
            env.panic_with_error(crate::errors::ContractError::MetadataLabelTooLong);
        }
        env.storage()
            .persistent()
            .set(&DataKey::MerchantFreezeReason(merchant.clone()), r);
    }

    env.storage()
        .persistent()
        .set(&DataKey::MerchantFrozen(merchant.clone()), &true);
    merchant_stats::index_merchant(env, merchant);
    events::publish_merchant_frozen(env, merchant);
}

/// Unfreezes a merchant, allowing new subscriptions again. Idempotent.
pub fn unfreeze(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantFrozen(merchant.clone()));
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantFreezeReason(merchant.clone()));
    events::publish_merchant_unfrozen(env, merchant);
}

pub fn get_freeze_reason(env: &Env, merchant: &Address) -> Option<soroban_sdk::String> {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantFreezeReason(merchant.clone()))
}
