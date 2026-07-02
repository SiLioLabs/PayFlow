use soroban_sdk::{Address, Env};

use crate::batch::ChargeResult;
use crate::events;
use crate::fee;
use crate::merchant_stats;
use crate::storage;
use crate::subscription_history;
use crate::{extend_subscription_ttl, DataKey, Subscription};

/// Returns the next charge timestamp for a subscription, or `None` if not chargeable.
/// Handles the trial case: when `last_charged` is in the future, it is the trial end time.
pub fn compute_next_charge_at(sub: &Subscription) -> Option<u64> {
    if !sub.active || sub.paused {
        return None;
    }
    Some(sub.last_charged + sub.interval)
}

/// Attempts to auto-resume a paused subscription if the pause expiry has passed.
/// Returns `true` if the subscription was auto-resumed (and caller should proceed with charge),
/// or `false` if the subscription remains paused.
pub fn try_auto_resume(env: &Env, user: &Address, sub: &mut Subscription, now: u64) -> bool {
    if sub.paused {
        let expiry = storage::get_pause_expiry(env, user);
        if let Some(expiry_ts) = expiry {
            if now >= expiry_ts {
                sub.paused = false;
                if now > sub.last_charged {
                    sub.last_charged = now;
                }
                env.storage().persistent().set(&DataKey::Subscription(user.clone()), sub);
                storage::clear_pause_expiry(env, user);
                events::publish_subscription_auto_resumed(env, user);
                return true;
            }
        }
    }
    false
}

/// Batch pre-check: returns `Ok(())` when a charge may proceed, or the skip result.
pub fn precheck_charge(
    sub: &Subscription,
    now: u64,
    grace_period: u64,
) -> Result<(), ChargeResult> {
    let next = compute_next_charge_at(sub).ok_or({
        if !sub.active {
            ChargeResult::Inactive
        } else {
            ChargeResult::Paused
        }
    })?;
    if now < next {
        return Err(ChargeResult::Skipped);
    }
    if grace_period > 0 && now > next + grace_period {
        return Err(ChargeResult::GracePeriodElapsed);
    }
    Ok(())
}

/// Fee-aware transfer, bookkeeping, and persistence shared by `charge()` and `batch_charge()`.
/// Returns the protocol fee deducted from the subscription amount.
pub fn execute_charge(
    env: &Env,
    user: &Address,
    key: &DataKey,
    sub: &mut Subscription,
    now: u64,
) -> i128 {
    let fee_amount = fee::transfer_subscription_charge(env, user, sub);
    let net = sub.amount - fee_amount;

    crate::check_and_update_global_volume(env, sub.amount);
    merchant_stats::increment_revenue_with_daily(env, &sub.merchant, net);

    sub.last_charged = now;
    env.storage().persistent().set(key, sub);
    extend_subscription_ttl(env, user);
    subscription_history::record_charge(env, user, now);
    events::publish_charged(env, user, sub, fee_amount, now);

    fee_amount
}
