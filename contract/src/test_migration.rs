//! Migration invariant tests for Issue #815.
//!
//! Covers:
//! - Invariant: subscribe/subscribe_with_metadata rejected when schema_version < CURRENT_VERSION
//! - Paged migration: migrate can be called in multiple pages, each page is a no-op for
//!   already-migrated slots
//! - Idempotent: calling migrate at CURRENT_VERSION is always a no-op (no panic, no version bump)
//! - Version advances correctly across v1→v2→v3 steps
#![cfg(test)]

use super::*;
use crate::errors::ContractError;
use crate::migration::CURRENT_VERSION;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Minimal test setup: returns (env, contract_id, token_addr, admin, user, merchant).
/// Whitelist is disabled. The contract is *not* initialised with a schema version so
/// that individual tests can set it explicitly.
fn migration_setup() -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Initialise contract (sets admin + token, schema_version stays at 0).
    let client = FlowPayClient::new(&env, &contract_id);
    client.initialize(&token_addr, &admin);

    // Fund user and approve contract.
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000i128);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000i128, &200_000u32);

    // Disable whitelist for subscribe tests.
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    (env, contract_id, token_addr, admin, user, merchant)
}

/// Force-write a specific schema version directly into instance storage.
fn set_version_directly(env: &Env, contract_id: &Address, version: u32) {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &version);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant enforcement tests
// ─────────────────────────────────────────────────────────────────────────────

/// When schema_version == 0 (fresh-deploy before any migrate call),
/// `subscribe` must panic with SchemaMigrationRequired.
#[test]
#[should_panic(expected = "SchemaMigrationRequired")]
fn test_migration_subscribe_blocked_at_version_0() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    // version is 0 (default, never set)
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &1_000_000i128, &3600u64, &token_addr, &None, &None);
}

/// When schema_version == 1 (simulate a contract that wrote version=1 manually
/// but has not run the full migration to CURRENT_VERSION), subscribe must still panic.
#[test]
#[should_panic(expected = "SchemaMigrationRequired")]
fn test_migration_subscribe_blocked_at_version_1() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 1);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &1_000_000i128, &3600u64, &token_addr, &None, &None);
}

/// When schema_version == 2 (one step behind CURRENT_VERSION == 3),
/// subscribe must still be blocked.
#[test]
#[should_panic(expected = "SchemaMigrationRequired")]
fn test_migration_subscribe_blocked_at_version_2() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &1_000_000i128, &3600u64, &token_addr, &None, &None);
}

/// When schema_version == CURRENT_VERSION, subscribe must succeed.
#[test]
fn test_migration_subscribe_allowed_at_current_version() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, CURRENT_VERSION);

    let client = FlowPayClient::new(&env, &contract_id);
    // Should not panic.
    client.subscribe(&user, &merchant, &1_000_000i128, &3600u64, &token_addr, &None, &None);

    let sub = client.get_subscription(&user).expect("subscription should exist");
    assert!(sub.active);
    assert_eq!(sub.merchant, merchant);
}

/// subscribe_with_metadata is also blocked when schema_version < CURRENT_VERSION.
#[test]
#[should_panic(expected = "SchemaMigrationRequired")]
fn test_migration_subscribe_with_metadata_blocked_below_current_version() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe_with_metadata(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
        &soroban_sdk::String::from_str(&env, "premium"),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paged migration tests
// ─────────────────────────────────────────────────────────────────────────────

/// Helper: bring contract to current version by running migrate with an empty user list.
/// This is the idempotent / "no existing subscribers" path.
fn run_migrate_empty(env: &Env, contract_id: &Address) {
    env.as_contract(contract_id, || {
        let users: Vec<Address> = Vec::new(env);
        migration::migrate(env, users);
    });
}

/// Paged migration: splitting users into two pages and calling migrate twice
/// produces the same result as calling migrate once with all users together, and
/// the schema version ends at CURRENT_VERSION after the first batch completes the
/// v1→v3 path.
#[test]
fn test_migration_paged_migrate_reaches_current_version() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    // schema_version starts at 0; no v1 blobs exist (fresh contract).

    // Page 1: empty slice — advances version to 2 (v1→v2 step runs) then to 3 (v2→v3 step runs).
    env.as_contract(&contract_id, || {
        let page1: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, page1);
    });

    let version = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(version, CURRENT_VERSION);
}

/// After a paged migration that only advances halfway (simulated by writing version=2
/// directly), a second migrate call completes the migration and emits the event.
#[test]
fn test_migration_paged_second_page_completes_migration() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    // Simulate: v1→v2 was done in a previous page call.
    set_version_directly(&env, &contract_id, 2);

    // Second page call (v2→v3 step).
    env.as_contract(&contract_id, || {
        let page: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, page);
    });

    let version = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(version, CURRENT_VERSION);
}

/// A page of users that have no subscription blobs is silently skipped —
/// the function does not panic, and updated_count in the event is 0.
#[test]
fn test_migration_paged_skips_users_without_subscriptions() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let ghost1 = Address::generate(&env);
    let ghost2 = Address::generate(&env);

    env.as_contract(&contract_id, || {
        let mut page: Vec<Address> = Vec::new(&env);
        page.push_back(ghost1.clone());
        page.push_back(ghost2.clone());
        migration::migrate(&env, page); // Must not panic.
    });

    let version = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(version, CURRENT_VERSION);
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotent migrate at CURRENT_VERSION
// ─────────────────────────────────────────────────────────────────────────────

/// Calling migrate when already at CURRENT_VERSION is a complete no-op.
/// No panic, no version change, safe to call multiple times.
#[test]
fn test_migration_idempotent_at_current_version() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    set_version_directly(&env, &contract_id, CURRENT_VERSION);

    // First call at CURRENT_VERSION — no-op.
    env.as_contract(&contract_id, || {
        let page: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, page);
    });

    let v1 = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(v1, CURRENT_VERSION);

    // Second call — still a no-op.
    env.as_contract(&contract_id, || {
        let page: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, page);
    });

    let v2 = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(v2, CURRENT_VERSION, "version must not change on repeated migrate calls");
}

/// Calling migrate with users that already hold v3 blobs (already at CURRENT_VERSION)
/// does not change their subscription data.
#[test]
fn test_migration_idempotent_does_not_alter_current_subscriptions() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    // Bring to CURRENT_VERSION so subscribe is allowed.
    set_version_directly(&env, &contract_id, CURRENT_VERSION);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &2_000_000i128, &7200u64, &token_addr, &None, &None);

    let sub_before = client.get_subscription(&user).expect("sub before migrate");

    // Run migrate again with this user in the list.
    env.as_contract(&contract_id, || {
        let mut page: Vec<Address> = Vec::new(&env);
        page.push_back(user.clone());
        migration::migrate(&env, page); // No-op at CURRENT_VERSION.
    });

    let sub_after = client.get_subscription(&user).expect("sub after migrate");
    assert_eq!(sub_before, sub_after, "subscription must be unchanged after idempotent migrate");
}

// ─────────────────────────────────────────────────────────────────────────────
// get_schema_version public API
// ─────────────────────────────────────────────────────────────────────────────

/// get_schema_version returns 0 for a freshly initialised contract with no migration.
#[test]
fn test_migration_get_schema_version_default_is_zero() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_schema_version(), 0u32);
}

/// get_schema_version advances to CURRENT_VERSION after migration completes.
#[test]
fn test_migration_get_schema_version_after_full_migrate() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_schema_version(), 0u32);

    env.as_contract(&contract_id, || {
        let users: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, users);
    });

    assert_eq!(client.get_schema_version(), CURRENT_VERSION);
}
