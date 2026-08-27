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

    let slot_key = DataKey::SubscriberIndexSlot(user.clone());
    env.storage().persistent().set(&slot_key, &slot);
    env.storage().persistent().extend_ttl(
        &slot_key,
        SUBSCRIPTION_TTL_LEDGERS,
        SUBSCRIPTION_TTL_LEDGERS,
    );

    env.storage()
        .persistent()
        .set(&DataKey::SubscriberIndexSize, &(slot + 1));
}

/// Marks `user`'s slot in the subscriber index as removed (tombstoned) so
/// keepers can skip it on future cycles. Safe to call for entries that
/// predate this feature and have no recorded slot (no-op in that case).
pub fn remove_subscriber_index(env: &Env, user: &Address) {
    let slot_key = DataKey::SubscriberIndexSlot(user.clone());
    if let Some(slot) = env.storage().persistent().get::<DataKey, u64>(&slot_key) {
        env.storage()
            .persistent()
            .set(&DataKey::SubscriberIndexRemoved(slot), &true);
        env.storage().persistent().remove(&slot_key);
    }
}

/// Moves an active subscriber's index membership to `new_user`.
///
/// Transfers preserve the active and merchant counts, but the append-only
/// index must still stop pointing at the old owner.
pub fn transfer_subscriber_index(env: &Env, user: &Address, new_user: &Address) {
    remove_subscriber_index(env, user);

    let new_slot_key = DataKey::SubscriberIndexSlot(new_user.clone());
    if let Some(slot) = env.storage().persistent().get::<DataKey, u64>(&new_slot_key) {
        if !is_subscriber_index_removed(env, slot) {
            return;
        }
        env.storage().persistent().remove(&new_slot_key);
    }

    append_subscriber_index(env, new_user);
}

/// Returns whether the subscriber index slot at `index` has been pruned.
pub fn is_subscriber_index_removed(env: &Env, index: u64) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriberIndexRemoved(index))
        .unwrap_or(false)
}
