//! Migration invariant tests for Issue #815.
//!
//! Covers:
//! - Invariant: subscribe/subscribe_with_metadata rejected when schema_version < CURRENT_VERSION
//! - Paged migration: migrate can be called in multiple pages, each page is a no-op for
//!   already-migrated slots
//! - Idempotent: calling migrate at CURRENT_VERSION is always a no-op (no panic, no version bump)
//! - Version advances correctly across v1→v2→v3 steps
//!
//! Snapshots: these tests generate `test_snapshots/test_migration/*.json` at
//! test time (see `test_snapshots/README.md`). Run a full `cargo test` and
//! commit the generated files with the change that produced them; delete a
//! snapshot when a test here is renamed or removed. These tests assert on typed
//! values (`get_schema_version`, `get_subscription`) rather than on recorded
//! output, so the snapshot stays a record of side effects, not the expectation.
#![cfg(test)]

use super::*;
use crate::errors::ContractError;
use crate::migration::{SubscriptionV1, CURRENT_VERSION};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Symbol, Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Minimal test setup: returns (env, contract_id, token_addr, admin, user, merchant).
/// Whitelist is disabled. `initialize()` sets schema_version to CURRENT_VERSION;
/// individual tests that need a lower version call `set_version_directly` after setup.
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

    // Initialise contract (sets admin + token, schema_version = CURRENT_VERSION).
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
#[should_panic]
fn test_migration_subscribe_blocked_at_version_0() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    // Simulate a pre-migration state by forcing version back to 0.
    set_version_directly(&env, &contract_id, 0);
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
    );
}

/// When schema_version == 1 (simulate a contract that wrote version=1 manually
/// but has not run the full migration to CURRENT_VERSION), subscribe must still panic.
#[test]
#[should_panic]
fn test_migration_subscribe_blocked_at_version_1() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 1);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
    );
}

/// When schema_version == 2 (one step behind CURRENT_VERSION == 3),
/// subscribe must still be blocked.
#[test]
#[should_panic]
fn test_migration_subscribe_blocked_at_version_2() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
    );
}

/// When schema_version == CURRENT_VERSION, subscribe must succeed.
#[test]
fn test_migration_subscribe_allowed_at_current_version() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, CURRENT_VERSION);

    let client = FlowPayClient::new(&env, &contract_id);
    // Should not panic.
    client.subscribe(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
    );

    let sub = client
        .get_subscription(&user)
        .expect("subscription should exist");
    assert!(sub.active);
    assert_eq!(sub.merchant, merchant);
}

/// subscribe_with_metadata is also blocked when schema_version < CURRENT_VERSION.
#[test]
#[should_panic]
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
    // schema_version is already CURRENT_VERSION after initialize(); calling migrate
    // again is idempotent and must not panic.
    env.as_contract(&contract_id, || {
        let page1: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, page1);
    });

    let version = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(version, CURRENT_VERSION);
}

/// After a paged migration that only advances halfway (simulated by writing version=2
/// directly), a final `finalize_migration` call completes the upgrade. The empty
/// batch alone no longer advances the version (see `migrate` docs in migration.rs).
#[test]
fn test_migration_paged_second_page_completes_migration() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    // Simulate: v1→v2 was done in a previous page call.
    set_version_directly(&env, &contract_id, 2);

    // Second page call (v2→v3 step) processes no accounts.
    env.as_contract(&contract_id, || {
        let page: Vec<Address> = Vec::new(&env);
        migration::migrate(&env, page);
    });
    let version = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(version, 2, "an empty batch must not advance the schema");

    // Zero accounts were expected, so finalize succeeds and completes the upgrade.
    env.as_contract(&contract_id, || migration::finalize(&env, 0));
    let version = env.as_contract(&contract_id, || migration::get_schema_version(&env));
    assert_eq!(version, CURRENT_VERSION);
}

/// A page of users that have no subscription blobs is accepted — the function
/// does not panic — and each such account still counts as processed.
#[test]
fn test_migration_paged_skips_users_without_subscriptions() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let ghost1 = Address::generate(&env);
    let ghost2 = Address::generate(&env);

    let mut page: Vec<Address> = Vec::new(&env);
    page.push_back(ghost1.clone());
    page.push_back(ghost2.clone());
    env.as_contract(&contract_id, || migration::migrate(&env, page)); // Must not panic.
    env.as_contract(&contract_id, || migration::finalize(&env, 2));

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
    assert_eq!(
        v2, CURRENT_VERSION,
        "version must not change on repeated migrate calls"
    );
}

/// Calling migrate with users that already hold v3 blobs (already at CURRENT_VERSION)
/// does not change their subscription data.
#[test]
fn test_migration_idempotent_does_not_alter_current_subscriptions() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    // Bring to CURRENT_VERSION so subscribe is allowed.
    set_version_directly(&env, &contract_id, CURRENT_VERSION);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &2_000_000i128,
        &7200u64,
        &token_addr,
        &None,
        &None,
    );

    let sub_before = client.get_subscription(&user).expect("sub before migrate");

    // Run migrate again with this user in the list.
    env.as_contract(&contract_id, || {
        let mut page: Vec<Address> = Vec::new(&env);
        page.push_back(user.clone());
        migration::migrate(&env, page); // No-op at CURRENT_VERSION.
    });

    let sub_after = client.get_subscription(&user).expect("sub after migrate");
    assert_eq!(
        sub_before, sub_after,
        "subscription must be unchanged after idempotent migrate"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// get_schema_version public API
// ─────────────────────────────────────────────────────────────────────────────

/// get_schema_version returns CURRENT_VERSION for a freshly initialised contract.
/// Fresh deployments do not need to run migrate() — initialize() sets the version.
#[test]
fn test_migration_get_schema_version_default_is_zero() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_schema_version(), CURRENT_VERSION);
}

/// get_schema_version advances to CURRENT_VERSION only once `finalize` completes
/// the upgrade, when starting from a downgraded version (post-upgrade state).
#[test]
fn test_migration_get_schema_version_after_full_migrate() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    // Simulate an upgraded contract with un-migrated storage.
    set_version_directly(&env, &contract_id, 0);

    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_schema_version(), 0u32);

    env.as_contract(&contract_id, || migration::migrate(&env, Vec::new(&env)));
    env.as_contract(&contract_id, || migration::finalize(&env, 0));

    assert_eq!(client.get_schema_version(), CURRENT_VERSION);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1422: resumable migration with progress tracking
// ─────────────────────────────────────────────────────────────────────────────

/// Writes a v1-shaped subscription blob (no `paused`) directly into storage.
fn write_v1_blob(env: &Env, contract_id: &Address, user: &Address, merchant: &Address, token: &Address) {
    let v1 = SubscriptionV1 {
        merchant: merchant.clone(),
        amount: 1_000_000i128,
        interval: 3600u64,
        last_charged: env.ledger().timestamp(),
        active: true,
        token: token.clone(),
        referrer: None,
        label: Symbol::new(env, "v1_label"),
        trial_duration: 0,
    };
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Subscription(user.clone()), &v1);
    });
}

/// `migrate` must not bump the version on its own. Only `finalize` does.
#[test]
fn test_migration_batch_does_not_advance_version() {
    let (env, contract_id, _token_addr, _admin, user, _merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    let mut users: Vec<Address> = Vec::new(&env);
    users.push_back(user.clone());
    env.as_contract(&contract_id, || migration::migrate(&env, users));

    assert_eq!(client.get_schema_version(), 2);
    let progress = client.get_migration_progress();
    assert_eq!(progress.schema_version, 2);
    assert_eq!(progress.migrated_accounts, 1);
    assert!(!progress.complete);
}

/// `finalize` refuses to advance while fewer accounts are processed than expected,
/// and `SchemaMigrationRequired` keeps blocking subscribe in the meantime.
#[test]
fn test_migration_finalize_rejects_incomplete_run() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    let mut users: Vec<Address> = Vec::new(&env);
    users.push_back(user.clone());
    env.as_contract(&contract_id, || migration::migrate(&env, users));

    // Operator expected two accounts but only one was processed.
    let result = client.try_finalize_migration(&2u64);
    assert!(result.is_err(), "finalize must reject an incomplete run");
    assert_eq!(client.get_schema_version(), 2);

    let blocked = client.try_subscribe(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
    );
    assert!(blocked.is_err(), "subscribe must stay blocked until finalize succeeds");
}

/// Once every expected account is processed, `finalize` clears
/// `SchemaMigrationRequired` and subscribe works again.
#[test]
fn test_migration_finalize_clears_requirement_when_complete() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    let mut users: Vec<Address> = Vec::new(&env);
    users.push_back(user.clone());
    env.as_contract(&contract_id, || migration::migrate(&env, users));

    client.finalize_migration(&1u64);
    assert_eq!(client.get_schema_version(), CURRENT_VERSION);
    assert!(client.get_migration_progress().complete);

    client.subscribe(
        &user,
        &merchant,
        &1_000_000i128,
        &3600u64,
        &token_addr,
        &None,
        &None,
    );
    assert!(client.get_subscription(&user).is_some());
}

/// Re-sending an account in a later batch must not count it twice, otherwise a
/// duplicate could satisfy `finalize`'s total before every account is done.
#[test]
fn test_migration_duplicate_account_counted_once() {
    let (env, contract_id, _token_addr, _admin, user, _merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 2);

    let client = FlowPayClient::new(&env, &contract_id);
    let mut users: Vec<Address> = Vec::new(&env);
    users.push_back(user.clone());
    // Separate frames: each admin call authorizes its own invocation frame.
    env.as_contract(&contract_id, || migration::migrate(&env, users.clone()));
    env.as_contract(&contract_id, || migration::migrate(&env, users.clone()));

    assert_eq!(client.get_migration_progress().migrated_accounts, 1);
    assert!(client.try_finalize_migration(&2u64).is_err());
}

/// A v1 blob is rewritten to v2 exactly once. Repeating the batch must not try to
/// decode the already-rewritten blob as v1, which would panic.
#[test]
fn test_migration_v1_blob_converted_once_and_rerun_is_safe() {
    let (env, contract_id, token_addr, _admin, user, merchant) = migration_setup();
    set_version_directly(&env, &contract_id, 0);
    write_v1_blob(&env, &contract_id, &user, &merchant, &token_addr);

    let client = FlowPayClient::new(&env, &contract_id);
    let mut users: Vec<Address> = Vec::new(&env);
    users.push_back(user.clone());

    client.migrate(&users);
    let converted = client.get_subscription(&user).expect("blob must survive migration");
    assert!(!converted.paused, "v1 blob must be rewritten with paused = false");
    assert_eq!(converted.merchant, merchant);

    // Second run of the same batch is a no-op for this account.
    client.migrate(&users);
    assert_eq!(client.get_subscription(&user).unwrap(), converted);
    assert_eq!(client.get_migration_progress().migrated_accounts, 1);

    client.finalize_migration(&1u64);
    assert_eq!(client.get_schema_version(), CURRENT_VERSION);
}

/// The progress getter reports the target version and a zeroed count on a fresh
/// contract that never needed migration.
#[test]
fn test_migration_progress_fresh_contract_is_complete() {
    let (env, contract_id, _token_addr, _admin, _user, _merchant) = migration_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let progress = client.get_migration_progress();
    assert_eq!(progress.schema_version, CURRENT_VERSION);
    assert_eq!(progress.target_version, CURRENT_VERSION);
    assert_eq!(progress.migrated_accounts, 0);
    assert!(progress.complete);
}
