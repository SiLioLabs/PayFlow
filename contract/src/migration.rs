use soroban_sdk::{Address, Env, Vec};

use crate::{admin, events, DataKey, Subscription};

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
pub const CURRENT_VERSION: u32 = 2;

/// Returns the stored schema version, defaulting to 1 (pre-versioning).
pub fn get_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SchemaVersion)
        .unwrap_or(1u32)
}

/// Writes the current schema version to instance storage.
fn set_schema_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::SchemaVersion, &version);
}

/// Migrates contract storage from v1 to v2.
///
/// v1 → v2: Introduces `SchemaVersion` tracking and transforms v1 Subscriptions to v2
/// (adding `paused: false`).
///
/// Safe to call multiple times — subsequent calls are no-ops.
/// Only the contract admin can call this.
pub fn migrate(env: &Env, users: Vec<Address>) {
    admin::require_admin(env);

    let version = get_schema_version(env);

    if version < 2 {
        // v1 → v2: stamp the schema version
        set_schema_version(env, 2);
    }

    let user_count = users.len();

    // Transform provided users' data from v1 to v2
    for user in users.into_iter() {
        let key = DataKey::Subscription(user.clone());

        // Attempt to read the entry as a V1 subscription
        if let Some(v1_sub) = env.storage().persistent().get::<_, SubscriptionV1>(&key) {
            let v2_sub = Subscription {
                merchant: v1_sub.merchant,
                amount: v1_sub.amount,
                interval: v1_sub.interval,
                last_charged: v1_sub.last_charged,
                active: v1_sub.active,
                paused: false, // new field in v2
                token: v1_sub.token,
                referrer: v1_sub.referrer,
                label: v1_sub.label,
                trial_duration: v1_sub.trial_duration,
            };

            env.storage().persistent().set(&key, &v2_sub);
        }
    }

    events::publish_migration_completed(env, get_schema_version(env), user_count);
}
