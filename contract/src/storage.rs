use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::errors::ContractError;
use crate::{
    BillingState, DataKey, LastChargeRecord, StorageEntryFootprint, StorageFootprint, Subscription,
    SUBSCRIPTION_TTL_LEDGERS,
};

/// Number of per-subscriber keys reported by [`get_storage_footprint`].
///
/// `contract/src/test.rs::test_storage_footprint_covers_every_per_user_key`
/// asserts the footprint length against this constant, so adding a new
/// per-user `DataKey` without extending the footprint (and this count) fails
/// the suite. Update `docs/architecture/STORAGE-AND-TTL.md` in the same change.
pub const PER_USER_STORAGE_KEY_COUNT: u32 = 11;

/// Resolves ID zero across deployments that are partway through migration.
pub(crate) fn subscription_key(env: &Env, user: &Address) -> DataKey {
    let legacy = DataKey::Subscription(user.clone());
    if env.storage().persistent().has(&legacy) {
        legacy
    } else {
        DataKey::SubscriptionById(user.clone(), 0)
    }
}

pub fn get_subscription(env: &Env, user: &Address) -> Option<Subscription> {
    env.storage().persistent().get(&subscription_key(env, user))
}

/// Overwrites the stored subscription entry for `user`.
///
/// Callers that mutate a subscription in place (e.g. trial extension) write the
/// whole struct back through here so the storage key layout stays owned by this
/// module.
pub fn set_subscription(env: &Env, user: &Address, sub: &Subscription) {
    env.storage()
        .persistent()
        .set(&subscription_key(env, user), sub);
}

/// Extends the TTL of a subscription entry and, when present, its
/// associated `PauseExpiry` key. Keeping both entries alive is
/// critical: if PauseExpiry archives while the subscription survives,
/// bounded-pause auto-resume silently breaks.
///
/// Safe to call even if the entry has already expired (no-op).
pub fn extend_subscription_ttl(env: &Env, user: &Address) {
    let key = subscription_key(env, user);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().extend_ttl(
            &key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    }
    let expiry_key = DataKey::PauseExpiry(user.clone());
    if env.storage().persistent().has(&expiry_key) {
        env.storage().persistent().extend_ttl(
            &expiry_key,
            SUBSCRIPTION_TTL_LEDGERS / 2,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    }
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Token)
}

/// Returns the stored contract admin.
///
/// # Errors
///
/// Aborts with the typed `ContractError::NotInitialized` (code 7) when no
/// admin has been stored yet. Every admin-gated entrypoint reaches this
/// helper through `require_admin`, so a pre-`initialize` call surfaces a
/// stable wire code that clients can branch on instead of a host panic
/// string. Use [`get_admin_optional`] when absence is a normal outcome.
pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NotInitialized))
}

pub fn get_admin_optional(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn is_contract_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ContractPaused)
        .unwrap_or(false)
}

pub fn set_contract_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&DataKey::ContractPaused, &paused);
}

pub fn set_pause_expiry(env: &Env, user: &Address, expiry: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::PauseExpiry(user.clone()), &expiry);
}

pub fn get_pause_expiry(env: &Env, user: &Address) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::PauseExpiry(user.clone()))
}

pub fn clear_pause_expiry(env: &Env, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::PauseExpiry(user.clone()));
}

/// Resolves the paused-subscription `active`-flag semantics in one place.
///
/// A paused subscription — indefinite (`pause`) or bounded (`pause_until`) —
/// keeps `active == true`; pausing never deactivates a subscription. Since
/// issue #1009 the `paused && !active` combination is a **legacy** state only,
/// written by older versions of `pause_until` before this rule was encoded.
/// Cancellation (`cancel`, `batch_cancel`, `cancel_and_refund_prorated`) is
/// the only writer of `active = false`.
///
/// Legacy `paused && !active` rows are excluded from active counts and active
/// subscriber readers because their `active` flag is false. Raw append-only
/// subscriber-index readers still return the recorded address; they enumerate
/// slots rather than active subscriptions. `is_cancelled` preserves the
/// separate cancellation distinction for mutation and charge flows:
/// legacy paused rows are not considered cancelled by that helper.
///
/// - `subscription_count` — a paused subscription stays counted as active.
/// - `get_active_subscriber_page` — current paused subscriptions with
///   `active == true` stay listed; legacy inactive-paused rows do not.
/// - `cancel_and_refund_prorated` — `active == false` means cancelled, not
///   paused; the separate `paused` check is what blocks paused rows.
/// - `batch auto-resume` (`try_auto_resume`) — cancels and paused rows are
///   distinct outcomes; only a paused row with an elapsed expiry resumes.
/// - `resume` — only cancelled rows are rejected; legacy `paused && !active`
///   rows stay resumable.
pub fn is_cancelled(sub: &Subscription) -> bool {
    !sub.active && !sub.paused
}

fn get_billing_state(env: &Env, user: &Address) -> Option<BillingState> {
    env.storage()
        .persistent()
        .get(&DataKey::BillingState(user.clone()))
}

fn set_billing_state(env: &Env, user: &Address, state: &BillingState) {
    let key = DataKey::BillingState(user.clone());
    env.storage().persistent().set(&key, state);
    env.storage().persistent().extend_ttl(
        &key,
        SUBSCRIPTION_TTL_LEDGERS / 2,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}

fn empty_billing_state() -> BillingState {
    BillingState {
        last_charge_merchant: None,
        last_charge_token: None,
        last_charge_amount: 0,
        last_charge_fee: 0,
        last_charge_net: 0,
        last_charge_at: 0,
        last_skip_at: None,
    }
}

/// Stores the snapshot of the most recent scheduled charge for `user`.
pub fn set_last_charge(env: &Env, user: &Address, record: &LastChargeRecord) {
    let mut state = get_billing_state(env, user).unwrap_or_else(empty_billing_state);
    state.last_charge_merchant = Some(record.merchant.clone());
    state.last_charge_token = Some(record.token.clone());
    state.last_charge_amount = record.amount;
    state.last_charge_fee = record.fee;
    state.last_charge_net = record.net;
    state.last_charge_at = record.charged_at;
    set_billing_state(env, user, &state);
}

pub fn get_last_charge(env: &Env, user: &Address) -> Option<LastChargeRecord> {
    let state = get_billing_state(env, user)?;
    Some(LastChargeRecord {
        merchant: state.last_charge_merchant?,
        token: state.last_charge_token?,
        amount: state.last_charge_amount,
        fee: state.last_charge_fee,
        net: state.last_charge_net,
        charged_at: state.last_charge_at,
    })
}

/// Removes the last-charge snapshot, making a second refund fail closed with
/// `NoLastChargeToRefund` (double-refund guard).
pub fn clear_last_charge(env: &Env, user: &Address) {
    if let Some(mut state) = get_billing_state(env, user) {
        state.last_charge_merchant = None;
        state.last_charge_token = None;
        state.last_charge_amount = 0;
        state.last_charge_fee = 0;
        state.last_charge_net = 0;
        state.last_charge_at = 0;
        set_billing_state(env, user, &state);
    }
}

pub fn set_last_skip_at(env: &Env, user: &Address, timestamp: u64) {
    let mut state = get_billing_state(env, user).unwrap_or_else(empty_billing_state);
    state.last_skip_at = Some(timestamp);
    set_billing_state(env, user, &state);
}

pub fn get_last_skip_at(env: &Env, user: &Address) -> Option<u64> {
    get_billing_state(env, user)?.last_skip_at
}

#[cfg(any(test, feature = "testutils"))]
fn persistent_ttl(env: &Env, key: &DataKey) -> u32 {
    use soroban_sdk::testutils::storage::Persistent;
    if env.storage().persistent().has(key) {
        env.storage().persistent().get_ttl(key)
    } else {
        0
    }
}

#[cfg(not(any(test, feature = "testutils")))]
fn persistent_ttl(_env: &Env, _key: &DataKey) -> u32 {
    0
}

#[cfg(any(test, feature = "testutils"))]
fn temporary_ttl(env: &Env, key: &DataKey) -> u32 {
    use soroban_sdk::testutils::storage::Temporary;
    if env.storage().temporary().has(key) {
        env.storage().temporary().get_ttl(key)
    } else {
        0
    }
}

#[cfg(not(any(test, feature = "testutils")))]
fn temporary_ttl(_env: &Env, _key: &DataKey) -> u32 {
    0
}

/// Enumerates every per-subscriber storage key with its presence flag and
/// (test builds only) remaining TTL, so clients can estimate rent without
/// guessing which keys exist.
pub fn get_storage_footprint(env: &Env, user: &Address) -> StorageFootprint {
    let mut entries = Vec::new(env);

    let mut push_persistent = |name: &str, key: DataKey| {
        entries.push_back(StorageEntryFootprint {
            key: Symbol::new(env, name),
            present: env.storage().persistent().has(&key),
            ttl_ledgers: persistent_ttl(env, &key),
        });
    };
    push_persistent("subscription", subscription_key(env, user));
    push_persistent("referral", DataKey::Referral(user.clone()));
    push_persistent("metadata", DataKey::SubscriptionMeta(user.clone()));
    push_persistent("charge_history", DataKey::ChargeHistory(user.clone()));
    push_persistent("index_slot", DataKey::SubscriberIndexSlot(user.clone()));
    push_persistent("pause_expiry", DataKey::PauseExpiry(user.clone()));

    // `last_charge` and `last_skip` share one underlying `BillingState` key, so
    // their presence flags read the inner options while reporting that key's
    // TTL.
    let billing_key = DataKey::BillingState(user.clone());
    let billing = get_billing_state(env, user);
    entries.push_back(StorageEntryFootprint {
        key: Symbol::new(env, "last_charge"),
        present: billing
            .as_ref()
            .is_some_and(|state| state.last_charge_merchant.is_some()),
        ttl_ledgers: persistent_ttl(env, &billing_key),
    });
    entries.push_back(StorageEntryFootprint {
        key: Symbol::new(env, "last_skip"),
        present: billing
            .as_ref()
            .is_some_and(|state| state.last_skip_at.is_some()),
        ttl_ledgers: persistent_ttl(env, &billing_key),
    });

    let mut push_temporary = |name: &str, key: DataKey| {
        entries.push_back(StorageEntryFootprint {
            key: Symbol::new(env, name),
            present: env.storage().temporary().has(&key),
            ttl_ledgers: temporary_ttl(env, &key),
        });
    };
    push_temporary("daily_limit", DataKey::DailyLimit(user.clone()));
    push_temporary("daily_spent", DataKey::DailySpent(user.clone()));
    push_temporary("day_start", DataKey::DayStart(user.clone()));

    StorageFootprint { entries }
}
