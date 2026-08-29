use crate::{DataKey, Subscription, SUBSCRIPTION_TTL_LEDGERS};
use soroban_sdk::Env;

pub fn get_grace_period(env: &Env) -> u64 {
    if let Some(seconds) = env.storage().instance().get(&DataKey::GracePeriod) {
        let lower = SUBSCRIPTION_TTL_LEDGERS / 2;
        let upper = SUBSCRIPTION_TTL_LEDGERS;
        env.storage().instance().extend_ttl(lower, upper);
        seconds
    } else {
        0
    }
}

/// Returns `true` when a subscription's grace window has definitively closed:
/// grace_period > 0 AND now > last_charged + interval + grace_period.
/// Uses the same math as charge/batch_charge paths.
/// See docs/SUBSCRIBER-LIFECYCLE.md for the single recovery rule:
/// cancel is always allowed; re-subscribe to restore chargeability.
pub fn is_grace_lapsed(env: &Env, sub: &Subscription) -> bool {
    let grace_period = get_grace_period(env);
    if grace_period == 0 {
        return false;
    }
    let now = env.ledger().timestamp();
    now > sub.last_charged + sub.interval + grace_period
}

/// Proposes a new contract-wide grace period.
pub fn propose_grace_period(env: &Env, seconds: u64) {
    assert!(seconds <= u64::MAX / 2, "grace period too large");
    crate::admin::require_admin(env);

    env.storage()
        .temporary()
        .set(&DataKey::PendingGracePeriod, &seconds);
    env.storage()
        .temporary()
        .extend_ttl(&DataKey::PendingGracePeriod, 17280, 17280);
    crate::events::publish_grace_period_proposed(env, seconds);
}

/// Commits a pending grace period proposal.
pub fn commit_grace_period(env: &Env) {
    crate::admin::require_admin(env);

    let seconds: u64 = env
        .storage()
        .temporary()
        .get(&DataKey::PendingGracePeriod)
        .unwrap_or_else(|| env.panic_with_error(crate::errors::ContractError::NoPendingProposal));

    env.storage()
        .temporary()
        .remove(&DataKey::PendingGracePeriod);

    env.storage()
        .instance()
        .set(&DataKey::GracePeriod, &seconds);

    let lower = SUBSCRIPTION_TTL_LEDGERS / 2;
    let upper = SUBSCRIPTION_TTL_LEDGERS;
    env.storage().instance().extend_ttl(lower, upper);

    crate::events::publish_grace_period_committed(env, seconds);
}
