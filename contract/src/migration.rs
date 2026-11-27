use soroban_sdk::{Address, Env, Vec};

use crate::{
    admin, errors::ContractError, events, referral, DataKey, Subscription, SUBSCRIPTION_TTL_LEDGERS,
};

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
pub const CURRENT_VERSION: u32 = 3;

/// Snapshot of the paged migration, returned by `get_migration_progress`.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MigrationProgress {
    /// Schema version the stored data is at. It only moves when `finalize` succeeds.
    pub schema_version: u32,
    /// The version this contract migrates to (`CURRENT_VERSION`).
    pub target_version: u32,
    /// Accounts `migrate` has processed in this upgrade. Each account counts once,
    /// however many batches it appears in.
    pub migrated_accounts: u64,
    /// `true` once `schema_version >= target_version`.
    pub complete: bool,
}

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

/// Returns the number of accounts `migrate` has processed in this upgrade.
pub fn get_migrated_account_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MigratedAccountCount)
        .unwrap_or(0u64)
}

/// Returns the current migration progress. Reads only; no auth required.
pub fn get_migration_progress(env: &Env) -> MigrationProgress {
    let schema_version = get_schema_version(env);
    MigrationProgress {
        schema_version,
        target_version: CURRENT_VERSION,
        migrated_accounts: get_migrated_account_count(env),
        complete: schema_version >= CURRENT_VERSION,
    }
}

/// Invariant guard: panics with `ContractError::SchemaMigrationRequired` when
/// `schema_version < CURRENT_VERSION`. Call this at the top of any entrypoint
/// that writes new subscription blobs (e.g. `subscribe_inner`) so that
/// mixed-version storage can never be created after a WASM upgrade.
///
/// **Why this matters:** after a WASM upgrade the on-chain code knows the v3
/// `Subscription` shape, but users whose slots have not yet been migrated still
/// hold v1 or v2 blobs. Writing a fresh v3 blob for those users while others
/// still hold older blobs is safe *for the new subscriber*, but operators who
/// page through `migrate()` calls may read back a mix of shapes. Refusing all
/// new writes until migration is complete removes the ambiguity entirely.
pub fn require_current_version(env: &Env) {
    // Skip the guard for uninitialized contracts (no Token stored). This
    // covers test environments that bypass `initialize()` and set storage
    // directly; the guard is only meaningful post-upgrade on live contracts.
    if !env.storage().instance().has(&crate::DataKey::Token) {
        return;
    }
    if get_schema_version(env) < CURRENT_VERSION {
        env.panic_with_error(ContractError::SchemaMigrationRequired);
    }
}

/// Migrates the listed accounts' stored blobs toward `CURRENT_VERSION`.
///
/// Admin only. Safe to call in as many batches as needed, in any order.
///
/// - **Does not advance `SchemaVersion`.** The version stays where it was until
///   `finalize` confirms the whole upgrade is done, so `SchemaMigrationRequired`
///   keeps blocking new writes until then.
/// - **Idempotent per account.** Each processed account gets a `MigratedAccount`
///   marker. A later batch that lists the same account skips it, so a blob is
///   never converted twice and never counted twice.
/// - **Resumable.** `get_migration_progress().migrated_accounts` is the number of
///   distinct accounts processed. A restarted operator can resume from that
///   position in their (stable, de-duplicated) account list.
///
/// Steps applied to each account, based on the version when the upgrade began:
/// v1→v2 (rewrites a `SubscriptionV1` blob as a v2 `Subscription` with `paused: false`)
/// and v2→v3 (fills `referrer` from `DataKey::Referral`).
///
/// Accounts without a subscription blob are marked and counted too. This matches the
/// caller's intent: "this account has been handled".
pub fn migrate(env: &Env, users: Vec<Address>) {
    admin::require_admin(env);

    // Already complete: nothing to migrate, and no marker writes either.
    let start_version = get_schema_version(env);
    if start_version >= CURRENT_VERSION {
        return;
    }

    let mut newly_migrated: u64 = 0;
    for user in users.iter() {
        let marker = DataKey::MigratedAccount(user.clone());
        if env.storage().persistent().has(&marker) {
            // Processed in an earlier batch. Converting it again would try to
            // decode an already-rewritten blob as the older shape.
            continue;
        }

        let key = DataKey::Subscription(user.clone());

        if start_version < 2 {
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

        if start_version < 3 {
            if let Some(mut sub) = env.storage().persistent().get::<_, Subscription>(&key) {
                sub.referrer = referral::get_referrer(env, &user);
                env.storage().persistent().set(&key, &sub);
            }
        }

        env.storage().persistent().set(&marker, &true);
        env.storage().persistent().extend_ttl(
            &marker,
            SUBSCRIPTION_TTL_LEDGERS,
            SUBSCRIPTION_TTL_LEDGERS,
        );
        newly_migrated += 1;
    }

    if newly_migrated > 0 {
        let total = get_migrated_account_count(env) + newly_migrated;
        env.storage()
            .instance()
            .set(&DataKey::MigratedAccountCount, &total);
        events::publish_migration_progress(env, total);
    }
}

/// Completes the upgrade: advances `SchemaVersion` to `CURRENT_VERSION`, which
/// unblocks new subscriptions.
///
/// Admin only. `expected_total` is the number of accounts the operator believes
/// need migrating (for example, the length of the list they fed to `migrate`).
/// The call succeeds only when `migrated_accounts >= expected_total`, so an
/// operator who skipped a batch cannot clear `SchemaMigrationRequired` early.
///
/// Idempotent: once complete, later calls do nothing and emit nothing.
///
/// # Errors
///
/// - `MigrationIncomplete` (53) when fewer than `expected_total` accounts have
///   been processed.
pub fn finalize(env: &Env, expected_total: u64) {
    admin::require_admin(env);

    if get_schema_version(env) >= CURRENT_VERSION {
        return;
    }

    let processed = get_migrated_account_count(env);
    if processed < expected_total {
        env.panic_with_error(crate::errors::ContractErrorExt::MigrationIncomplete);
    }

    set_schema_version(env, CURRENT_VERSION);
    events::publish_migration_completed(
        env,
        CURRENT_VERSION,
        u32::try_from(processed).unwrap_or(u32::MAX),
    );
}
