use soroban_sdk::{Address, Env, Vec};

use crate::{admin, events, referral, DataKey, Subscription};

/// v1 Subscription format (missing `paused` field)
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionV1 {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub token: Address,
    pub referrer: Option<Address>,
    pub label: soroban_sdk::Symbol,
    pub trial_duration: u64,
}

/// Current storage schema version.
#[allow(dead_code)]
pub const CURRENT_VERSION: u32 = 3;

/// Returns the stored schema version, defaulting to 0 (unmigrated).
pub fn get_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SchemaVersion)
        .unwrap_or(0u32)
}

/// Writes the current schema version to instance storage.
fn set_schema_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::SchemaVersion, &version);
}

/// Migrates contract storage to the latest schema version.
///
/// v1 → v2: Introduces `SchemaVersion` tracking and transforms v1 Subscriptions to v2 (adding `paused: false`).
/// v2 → v3: Reads DataKey::Referral(user) and populates the `referrer` field on each Subscription.
///
/// Safe to call multiple times — subsequent calls are no-ops when already at CURRENT_VERSION.
/// Only the contract admin can call this.
pub fn migrate(env: &Env, users: Vec<Address>) {
    admin::require_admin(env);

    let mut version = get_schema_version(env);

    if version < 2 {
        set_schema_version(env, 2);
        for user in users.iter() {
            let key = DataKey::Subscription(user.clone());
            if let Some(v1_sub) = env.storage().persistent().get::<_, SubscriptionV1>(&key) {
                let v2_sub = Subscription {
                    merchant: v1_sub.merchant,
                    amount: v1_sub.amount,
                    interval: v1_sub.interval,
                    last_charged: v1_sub.last_charged,
                    active: v1_sub.active,
                    paused: false,
                    token: v1_sub.token,
                    referrer: v1_sub.referrer,
                    label: v1_sub.label,
                    trial_duration: v1_sub.trial_duration,
                    created_at: 0,
                };
                env.storage().persistent().set(&key, &v2_sub);
            }
        }
        version = 2;
    }
    if version < 3 {
        let mut updated_count: u32 = 0;
        for user in users.into_iter() {
            let key = DataKey::Subscription(user.clone());
            if let Some(mut sub) = env.storage().persistent().get::<_, Subscription>(&key) {
                let referrer = referral::get_referrer(env, &user);
                sub.referrer = referrer;
                env.storage().persistent().set(&key, &sub);
                updated_count += 1;
            }
        }
        set_schema_version(env, 3);
        events::publish_migration_completed(env, 3, updated_count);
    }
}
