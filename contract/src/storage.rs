use soroban_sdk::{Address, Env};

use crate::errors::ContractError;
use crate::{DataKey, Subscription, SUBSCRIPTION_TTL_LEDGERS};

pub fn get_subscription(env: &Env, user: &Address) -> Option<Subscription> {
    env.storage()
        .persistent()
        .get(&DataKey::Subscription(user.clone()))
}

/// Overwrites the stored subscription entry for `user`.
///
/// Callers that mutate a subscription in place (e.g. trial extension) write the
/// whole struct back through here so the storage key layout stays owned by this
/// module.
pub fn set_subscription(env: &Env, user: &Address, sub: &Subscription) {
    env.storage()
        .persistent()
        .set(&DataKey::Subscription(user.clone()), sub);
}

/// Extends the TTL of a subscription entry and, when present, its
/// associated `PauseExpiry` key. Keeping both entries alive is
/// critical: if PauseExpiry archives while the subscription survives,
/// bounded-pause auto-resume silently breaks.
///
/// Safe to call even if the entry has already expired (no-op).
pub fn extend_subscription_ttl(env: &Env, user: &Address) {
    let key = DataKey::Subscription(user.clone());
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
/// Readers that ask "is this subscription still live / counted?" must use
/// this helper (or its `!` form) instead of a bare `sub.active`, so cancelled
/// and paused rows cannot be conflated:
///
/// - `subscription_count` — a paused subscription stays counted as active.
/// - `get_active_subscriber_page` — a paused subscription stays listed.
/// - `cancel_and_refund_prorated` — `active == false` means cancelled, not
///   paused; the separate `paused` check is what blocks paused rows.
/// - `batch auto-resume` (`try_auto_resume`) — cancels and paused rows are
///   distinct outcomes; only a paused row with an elapsed expiry resumes.
/// - `resume` — only cancelled rows are rejected; legacy `paused && !active`
///   rows stay resumable.
pub fn is_cancelled(sub: &Subscription) -> bool {
    !sub.active && !sub.paused
}
