use soroban_sdk::Env;

use crate::DataKey;

/// Current storage schema version.
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
/// v1 → v2: Introduces `SchemaVersion` tracking. No data shape changes;
/// this migration simply stamps the version so future upgrades have a
/// reliable baseline to branch from.
///
/// Safe to call multiple times — subsequent calls are no-ops.
pub fn migrate(env: &Env) {
    let version = get_schema_version(env);

    if version < 2 {
        // v1 → v2: stamp the schema version
        set_schema_version(env, 2);
    }

    // Future migrations: add `if version < 3 { ... }` blocks here.
}
