use soroban_sdk::{contracttype, Address, Env};

use crate::batch::ChargeResult;
use crate::events;
use crate::fee;
use crate::grace;
use crate::merchant_stats;
use crate::spending_limit;
use crate::storage;
use crate::subscription_history;
use crate::validation;
use crate::whitelist;
use crate::{extend_subscription_ttl, DataKey, MAX_AMOUNT, Subscription};

/// Outcome of dry-running/simulating a charge() call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ChargeSimResult {
    WouldSucceed,
    NotDue,
    Inactive,
    InsufficientAllowance,
    GracePeriodElapsed,
    ContractPaused,
    SubscriptionPaused,
}

/// Simulates a charge for a subscription without making state modifications.
pub fn simulate_charge(env: &Env, user: Address) -> ChargeSimResult {
    if storage::is_contract_paused(env) {
        return ChargeSimResult::ContractPaused;
    }

    let key = DataKey::Subscription(user.clone());
    let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

    let mut sub = match sub_opt {
        None => return ChargeSimResult::Inactive,
        Some(s) => s,
    };

    let now = env.ledger().timestamp();

    if sub.paused {
        let mut auto_resumed = false;
        if let Some(expiry_ts) = storage::get_pause_expiry(env, &user) {
            if now >= expiry_ts {
                sub.paused = false;
                sub.active = true;
                auto_resumed = true;
            }
        }
        if !auto_resumed {
            return ChargeSimResult::SubscriptionPaused;
        }
    }

    if !sub.active {
        return ChargeSimResult::Inactive;
    }

    let next = match compute_next_charge_at(&sub) {
        Some(n) => n,
        None => return ChargeSimResult::SubscriptionPaused,
    };

    if now < next {
        return ChargeSimResult::NotDue;
    }

    let grace_period = grace::get_grace_period(env);
    if grace_period > 0 && now > next + grace_period {
        return ChargeSimResult::GracePeriodElapsed;
    }

    if !validation::has_sufficient_allowance(env, &user, &sub.token, sub.amount) {
        return ChargeSimResult::InsufficientAllowance;
    }

    ChargeSimResult::WouldSucceed
}

/// Outcome of dry-running/simulating a `pay_per_use` / `pay_per_use_to` call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PayPerUseSimResult {
    WouldSucceed,
    Inactive,
    InsufficientAllowance,
    ContractPaused,
    SubscriptionPaused,
    /// `amount` is not positive (`AmountMustBePositive`).
    AmountMustBePositive,
    /// `amount` exceeds the per-call cap (`MAX_AMOUNT`, `AmountExceedsMaximum`).
    AmountExceedsMaximum,
    /// The daily spending limit would be exceeded (`DailyLimitExceeded`).
    DailyLimitExceeded,
    /// `pay_per_use_to` recipient is the contract's own address (`InvalidRecipient`).
    InvalidRecipient,
    /// The whitelist is enabled and `pay_per_use_to` recipient is not whitelisted.
    MerchantNotWhitelisted,
}

/// Simulates a `pay_per_use` / `pay_per_use_to` call without making any state
/// modifications. `recipient == None` mirrors `pay_per_use` (payment routed to
/// the subscription merchant, no re-validation of the merchant whitelist);
/// `Some(recipient)` mirrors `pay_per_use_to`.
pub fn simulate_pay_per_use(
    env: &Env,
    user: Address,
    amount: i128,
    recipient: Option<Address>,
) -> PayPerUseSimResult {
    if storage::is_contract_paused(env) {
        return PayPerUseSimResult::ContractPaused;
    }
    if amount <= 0 {
        return PayPerUseSimResult::AmountMustBePositive;
    }
    if amount > MAX_AMOUNT {
        return PayPerUseSimResult::AmountExceedsMaximum;
    }

    let key = DataKey::Subscription(user.clone());
    let sub: Option<Subscription> = env.storage().persistent().get(&key);
    let sub = match sub {
        None => return PayPerUseSimResult::Inactive,
        Some(s) => s,
    };

    if sub.paused {
        return PayPerUseSimResult::SubscriptionPaused;
    }
    if !sub.active {
        return PayPerUseSimResult::Inactive;
    }

    let is_pay_per_use_to = recipient.is_some();
    let recipient = recipient.unwrap_or_else(|| sub.merchant.clone());

    if is_pay_per_use_to {
        if recipient == env.current_contract_address() {
            return PayPerUseSimResult::InvalidRecipient;
        }
        if whitelist::is_whitelist_enabled(env) && !whitelist::is_whitelisted(env, &recipient) {
            return PayPerUseSimResult::MerchantNotWhitelisted;
        }
    }

    if let Some(limit) = spending_limit::get_daily_limit(env, &user) {
        let spent = spending_limit::get_daily_spent(env, &user);
        if spent + amount > limit {
            return PayPerUseSimResult::DailyLimitExceeded;
        }
    }

    if !validation::has_sufficient_allowance(env, &user, &sub.token, amount) {
        return PayPerUseSimResult::InsufficientAllowance;
    }

    PayPerUseSimResult::WouldSucceed
}

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
                sub.active = true;
                env.storage()
                    .persistent()
                    .set(&DataKey::Subscription(user.clone()), sub);
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
        if sub.paused {
            ChargeResult::Paused
        } else {
            ChargeResult::Inactive
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
