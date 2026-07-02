use soroban_sdk::{Address, Env};

use crate::{DataKey, SUBSCRIPTION_TTL_LEDGERS};

/// Returns the current number of active subscriptions.
pub fn get_active_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ActiveCount)
        .unwrap_or(0u64)
}

/// Increments the active subscription counter by 1.
pub fn increment(env: &Env) {
    let count = get_active_count(env);
    env.storage()
        .instance()
        .set(&DataKey::ActiveCount, &(count + 1));
}

/// Decrements the active subscription counter by 1 (floor 0).
pub fn decrement(env: &Env) {
    let count = get_active_count(env);
    if count > 0 {
        env.storage()
            .instance()
            .set(&DataKey::ActiveCount, &(count - 1));
    }
}

/// Returns the total number of entries in the append-only subscriber index.
pub fn get_subscriber_index_size(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriberIndexSize)
        .unwrap_or(0u64)
}

/// Returns the number of active subscribers for a given merchant.
pub fn get_merchant_sub_count(env: &Env, merchant: &Address) -> u32 {
    let count: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::MerchantSubCount(merchant.clone()))
        .unwrap_or(0u64);
    count as u32
}

/// Appends `user` to the next available slot in the subscriber index and increments the size.
pub fn append_subscriber_index(env: &Env, user: &Address) {
    let slot = get_subscriber_index_size(env);
    let key = DataKey::SubscriberIndex(slot);
    env.storage().persistent().set(&key, user);
    env.storage()
        .persistent()
        .extend_ttl(&key, SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
    env.storage()
        .persistent()
        .set(&DataKey::SubscriberIndexSize, &(slot + 1));
}
