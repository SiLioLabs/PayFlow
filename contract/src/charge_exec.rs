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

/// ─────────────────────────────────────────────────────────────
/// Shared dry-run precheck helper (Issue #801 — Issue 005)
/// ─────────────────────────────────────────────────────────────
///
/// Both `simulate_charge` and `get_batch_charge_estimate` are
/// keeper dry-run surfaces.  Historically they duplicated the
/// skip/pause/grace/not-due logic and could disagree on:
///   - pause auto-resume timing
///   - grace-period-elapsed timing
///   - not-due timing
///
/// They now share a single precheck: `dry_run_skip_precheck`.
///
/// Intentional remaining differences between the two callers:
///   * Return enums differ (ChargeSimResult vs ChargeResult)
///     because ChargeResult has a stable discriminant layout
///     consumed by off-chain keepers/indexers and cannot be
///     changed.  `into_sim_result` / `into_batch_result` map
///     the shared precheck outcomes accordingly.
///   * Allowance / InsufficientAllowance handling is NOT part
///     of the shared precheck.  It belongs to Issue 001 and is
///     performed separately by each caller after this helper
///     returns `ProceedToAllowance`.  Do NOT move allowance
///     logic into this helper — that would overlap with Issue
///     001's scope.
///   * `get_batch_charge_estimate` returns `ChargeResult::Charged`
///     to indicate "would charge" while `simulate_charge`
///     returns `ChargeSimResult::WouldSucceed`.  Neither
///     performs a transfer.
///   * `simulate_charge` collapses missing subscriptions into
///     `ChargeSimResult::Inactive` (existing API semantics),
///     while the batch path distinguishes `NoSubscription`
///     from `Inactive` — the mapping is explicit in the
///     conversion helpers below.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DryRunSkipOutcome {
    NoSubscription,
    ContractPaused,
    SubscriptionPaused,
    Inactive,
    NotDue,
    GracePeriodElapsed,
    ProceedToAllowance,
}

impl DryRunSkipOutcome {
    pub(crate) fn into_sim_result(self) -> ChargeSimResult {
        match self {
            DryRunSkipOutcome::NoSubscription => ChargeSimResult::Inactive,
            DryRunSkipOutcome::ContractPaused => ChargeSimResult::ContractPaused,
            DryRunSkipOutcome::SubscriptionPaused => ChargeSimResult::SubscriptionPaused,
            DryRunSkipOutcome::Inactive => ChargeSimResult::Inactive,
            DryRunSkipOutcome::NotDue => ChargeSimResult::NotDue,
            DryRunSkipOutcome::GracePeriodElapsed => ChargeSimResult::GracePeriodElapsed,
            DryRunSkipOutcome::ProceedToAllowance => ChargeSimResult::WouldSucceed,
        }
    }

    pub(crate) fn into_batch_result(self) -> ChargeResult {
        match self {
            DryRunSkipOutcome::NoSubscription => ChargeResult::NoSubscription,
            DryRunSkipOutcome::ContractPaused => {
                ChargeResult::Inactive
            }
            DryRunSkipOutcome::SubscriptionPaused => ChargeResult::Paused,
            DryRunSkipOutcome::Inactive => ChargeResult::Inactive,
            DryRunSkipOutcome::NotDue => ChargeResult::Skipped,
            DryRunSkipOutcome::GracePeriodElapsed => ChargeResult::GracePeriodElapsed,
            DryRunSkipOutcome::ProceedToAllowance => ChargeResult::Charged,
        }
    }
}

/// Shared precheck covering the existing skip/pause/grace/inactive/
/// not-due matrix.  Returns a unified `DryRunSkipOutcome` that the
/// caller maps to its specific result enum.
///
/// The helper performs a **virtual** auto-resume: if the subscription
/// is paused with a `PauseExpiry` at or before `now`, the local copy
/// of `sub` is updated to reflect the post-auto-resume state (matching
/// what `try_auto_resume` would do on the live path) but NO storage
/// writes occur — this is a pure dry-run.
///
/// `check_contract_paused` controls whether the top-level contract
/// pause gate is applied.  Both dry-run surfaces (simulate_charge,
/// get_batch_charge_estimate) set it to `true` so they agree on the
/// contract-paused case.  The live `batch_charge` path panics on
/// contract pause via `ensure_contract_not_paused` before reaching
/// the per-user loop.
pub(crate) fn dry_run_skip_precheck(
    env: &Env,
    user: &Address,
    sub_opt: Option<Subscription>,
    check_contract_paused: bool,
) -> (DryRunSkipOutcome, Option<Subscription>) {
    if check_contract_paused && storage::is_contract_paused(env) {
        return (DryRunSkipOutcome::ContractPaused, None);
    }

    let mut sub = match sub_opt {
        None => return (DryRunSkipOutcome::NoSubscription, None),
        Some(s) => s,
    };

    let now = env.ledger().timestamp();

    if sub.paused {
        let mut auto_resumed = false;
        if let Some(expiry_ts) = storage::get_pause_expiry(env, user) {
            if now >= expiry_ts {
                sub.paused = false;
                sub.active = true;
                auto_resumed = true;
            }
        }
        if !auto_resumed {
            return (DryRunSkipOutcome::SubscriptionPaused, None);
        }
    }

    if !sub.active {
        return (DryRunSkipOutcome::Inactive, None);
    }

    let next = match compute_next_charge_at(&sub) {
        Some(n) => n,
        None => return (DryRunSkipOutcome::SubscriptionPaused, None),
    };

    if now < next {
        return (DryRunSkipOutcome::NotDue, None);
    }

    let grace_period = grace::get_grace_period(env);
    if grace_period > 0 && now > next + grace_period {
        return (DryRunSkipOutcome::GracePeriodElapsed, None);
    }

    (DryRunSkipOutcome::ProceedToAllowance, Some(sub))
}

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
///
/// Uses the shared `dry_run_skip_precheck` helper so skip/pause/grace/
/// not-due outcomes agree exactly with `get_batch_charge_estimate`.
///
/// Intentional differences vs `get_batch_charge_estimate` (see
/// design comment block at `DryRunSkipOutcome`):
///   * Returns `ChargeSimResult` (keeper-friendly enum).
///   * Missing subscriptions map to `ChargeSimResult::Inactive`.
///   * Allowance check performed locally after the shared precheck
///     returns `ProceedToAllowance` (Issue 001 scope — do not move).
pub fn simulate_charge(env: &Env, user: Address) -> ChargeSimResult {
    let key = DataKey::Subscription(user.clone());
    let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

    let (outcome, sub_after_precheck) =
        dry_run_skip_precheck(env, &user, sub_opt, true);

    if let DryRunSkipOutcome::ProceedToAllowance = outcome {
        let sub = sub_after_precheck.expect("sub present when ProceedToAllowance");
        if !validation::has_sufficient_allowance(env, &user, &sub.token, sub.amount) {
            return ChargeSimResult::InsufficientAllowance;
        }
    }

    outcome.into_sim_result()
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
