use soroban_sdk::{Address, BytesN, Env, Symbol};

use crate::Subscription;

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscribedEventData {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChargeEventData {
    pub merchant: Address,
    pub gross: i128,
    pub fee: i128,
    pub net: i128,
    pub charged_at: u64,
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayPerUseEventData {
    pub merchant: Address,
    pub amount: i128,
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CancelledEventData {
    pub ledger_sequence: u32,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CancelledWithRefundEventData {
    pub refund_amount: i128,
    pub ledger_sequence: u32,
}

pub fn publish_subscribed(env: &Env, user: &Address, sub: &Subscription) {
    env.events().publish(
        (Symbol::new(env, "subscribed"), user.clone()),
        SubscribedEventData {
            merchant: sub.merchant.clone(),
            amount: sub.amount,
            interval: sub.interval,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_charged(
    env: &Env,
    user: &Address,
    sub: &Subscription,
    fee_amount: i128,
    charged_at: u64,
) {
    let net = sub.amount - fee_amount;
    env.events().publish(
        (Symbol::new(env, "charged"), user.clone()),
        ChargeEventData {
            merchant: sub.merchant.clone(),
            gross: sub.amount,
            fee: fee_amount,
            net,
            charged_at,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

// ─────────────────────────────────────────────────────────────
// Batch charge skip summary
// ─────────────────────────────────────────────────────────────
//
// `batch_charge` reports per-user outcomes in its return value, which only the
// caller of the transaction sees. Event-driven consumers (scripts/indexer.ts,
// scripts/watch-events.ts) therefore had no on-chain signal for a batch where
// subscriptions were paused, cancelled, missing, or past their grace window.
//
// This event closes that gap with ONE summary per batch instead of one event
// per skipped user: per-user emission would scale event fees and ledger
// footprint with batch size, and the not-due case (`Skipped`) is the common,
// uninteresting outcome that would dominate the stream. Per-user attribution
// stays available off-chain via the return value and `get_batch_charge_estimate`.
//
// Emission is conditional: the event fires only when at least one *interesting*
// outcome occurred (no_subscription / inactive / paused / grace_elapsed /
// allowance_insufficient). An all-charged or all-not-due batch emits nothing,
// so the steady state costs exactly what it did before.

/// Aggregate outcome counts for a single `batch_charge` call.
///
/// `charged + not_due + no_subscription + inactive + grace_elapsed + paused
/// + allowance_insufficient == total`.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchChargeSkipsEventData {
    /// Addresses submitted in the batch.
    pub total: u32,
    /// `ChargeResult::Charged`
    pub charged: u32,
    /// `ChargeResult::Skipped` — interval has not elapsed yet.
    pub not_due: u32,
    /// `ChargeResult::NoSubscription`
    pub no_subscription: u32,
    /// `ChargeResult::Inactive`
    pub inactive: u32,
    /// `ChargeResult::Paused`
    pub paused: u32,
    /// `ChargeResult::GracePeriodElapsed`
    pub grace_elapsed: u32,
    /// `ChargeResult::AllowanceInsufficient` — the subscriber's allowance is
    /// below the gross amount. This is the alerting case: the subscription is
    /// still active and will keep failing until the subscriber re-approves.
    pub allowance_insufficient: u32,
    pub ledger_sequence: u32,
}

/// Publishes the `batch_charge_skips` summary. Callers must only invoke this
/// when at least one interesting (non-`Charged`, non-`Skipped`) outcome occurred.
pub fn publish_batch_charge_skips(env: &Env, data: BatchChargeSkipsEventData) {
    env.events()
        .publish((Symbol::new(env, "batch_charge_skips"),), data);
}

pub fn publish_pay_per_use(env: &Env, user: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "pay_per_use"), user.clone()),
        PayPerUseEventData {
            merchant: merchant.clone(),
            amount,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_cancelled(env: &Env, user: &Address) {
    env.events().publish(
        (Symbol::new(env, "cancelled"), user.clone()),
        CancelledEventData {
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_cancelled_with_refund(env: &Env, user: &Address, refund_amount: i128) {
    env.events().publish(
        (Symbol::new(env, "cancelled_with_refund"), user.clone()),
        CancelledWithRefundEventData {
            refund_amount,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrialExtendedEventData {
    pub additional_seconds: u64,
    pub new_last_charged: u64,
    pub ledger_sequence: u32,
}

pub fn publish_trial_extended(
    env: &Env,
    user: &Address,
    additional_seconds: u64,
    new_last_charged: u64,
) {
    env.events().publish(
        (Symbol::new(env, "trial_extended"), user.clone()),
        TrialExtendedEventData {
            additional_seconds,
            new_last_charged,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinIntervalSetEventData {
    pub old: u64,
    pub new: u64,
}

pub fn publish_min_interval_set(env: &Env, old: u64, new: u64) {
    env.events().publish(
        (Symbol::new(env, "min_interval_set"),),
        MinIntervalSetEventData { old, new },
    );
}

pub fn publish_merchant_history_cleared(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merch_hist_cleared"),), merchant.clone());
}

pub fn publish_paused(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "paused"), user.clone()), ());
}

pub fn publish_resumed(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "resumed"), user.clone()), ());
}

pub fn publish_subscription_paused(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "subscription_paused"), user.clone()), ());
}

pub fn publish_subscription_transferred(env: &Env, old_user: &Address, new_user: &Address) {
    env.events().publish(
        (Symbol::new(env, "sub_transferred"), old_user.clone()),
        new_user.clone(),
    );
}

pub fn emit_subscription_transferred(env: &Env, from: &Address, to: &Address, sub: &Subscription) {
    env.events().publish(
        (
            Symbol::new(env, "subscription_transferred"),
            from.clone(),
            to.clone(),
        ),
        (
            sub.merchant.clone(),
            sub.amount,
            sub.interval,
            sub.token.clone(),
        ),
    );
}

pub fn publish_upgraded(env: &Env, _new_wasm_hash: &BytesN<32>) {
    env.events().publish((Symbol::new(env, "upgrade"),), ());
}

pub fn publish_upgrade_proposed(env: &Env, new_wasm_hash: &BytesN<32>) {
    env.events()
        .publish((Symbol::new(env, "upg_proposed"),), new_wasm_hash.clone());
}

pub fn publish_upgrade_cancelled(env: &Env) {
    env.events()
        .publish((Symbol::new(env, "upg_cancelled"),), ());
}

pub fn publish_contract_paused(env: &Env) {
    env.events()
        .publish((Symbol::new(env, "contract_paused"),), ());
}

pub fn publish_contract_unpaused(env: &Env) {
    env.events()
        .publish((Symbol::new(env, "contract_unpaused"),), ());
}

pub fn publish_daily_limit_set(env: &Env, user: &Address, limit: i128) {
    env.events()
        .publish((Symbol::new(env, "daily_limit_set"), user.clone()), limit);
}

pub fn publish_daily_limit_removed(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "daily_limit_removed"), user.clone()), ());
}

pub fn publish_fee_cleared(env: &Env) {
    env.events().publish((Symbol::new(env, "fee_cleared"),), ());
}

pub fn publish_daily_window_started(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "daily_window_started"), user.clone()), ());
}
pub fn publish_subscription_amount_updated(
    env: &Env,
    user: &Address,
    old_amount: i128,
    new_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "sub_amount_updated"), user.clone()),
        (old_amount, new_amount),
    );
}

pub fn publish_subscription_interval_updated(
    env: &Env,
    user: &Address,
    old_interval: u64,
    new_interval: u64,
) {
    env.events().publish(
        (Symbol::new(env, "sub_interval_updated"), user.clone()),
        (old_interval, new_interval),
    );
}

pub fn publish_merchant_withdrawal(env: &Env, merchant: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "merchant_withdrawal"), merchant.clone()),
        amount,
    );
}

pub fn publish_referred(env: &Env, user: &Address, referrer: &Address) {
    env.events().publish(
        (Symbol::new(env, "referred"), user.clone()),
        referrer.clone(),
    );
}

pub fn publish_admin_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (Symbol::new(env, "admin_transferred"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

pub fn publish_fee_proposed(env: &Env, collector: &Address, bps: u32) {
    env.events().publish(
        (Symbol::new(env, "fee_proposed"),),
        (collector.clone(), bps),
    );
}

pub fn publish_fee_committed(env: &Env, collector: &Address, bps: u32) {
    env.events().publish(
        (Symbol::new(env, "fee_committed"),),
        (collector.clone(), bps),
    );
}

pub fn publish_merchant_added(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merchant_added"), merchant.clone()), ());
}

pub fn publish_merchant_removed(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merchant_removed"), merchant.clone()), ());
}

pub fn publish_merchant_frozen(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merchant_frozen"), merchant.clone()), ());
}

pub fn publish_merchant_unfrozen(env: &Env, merchant: &Address) {
    env.events().publish(
        (Symbol::new(env, "merchant_unfrozen"), merchant.clone()),
        (),
    );
}

pub fn publish_grace_period_proposed(env: &Env, seconds: u64) {
    env.events()
        .publish((Symbol::new(env, "grace_period_proposed"),), seconds);
}

pub fn publish_grace_period_committed(env: &Env, seconds: u64) {
    env.events()
        .publish((Symbol::new(env, "grace_period_committed"),), seconds);
}

pub fn publish_subscription_auto_resumed(env: &Env, user: &Address) {
    env.events().publish(
        (Symbol::new(env, "subscription_auto_resumed"), user.clone()),
        (),
    );
}

pub fn publish_migration_completed(env: &Env, version: u32, user_count: u32) {
    env.events().publish(
        (Symbol::new(env, "migration_completed"),),
        (version, user_count),
    );
}

pub fn publish_subscriber_index_ttl_extended(env: &Env, count: u64) {
    env.events()
        .publish((Symbol::new(env, "subscriber_index_ttl_extended"),), count);
}

/// Audit event for a successful admin repair of a stale subscriber index slot.
pub fn publish_subscriber_index_cleared(env: &Env, user: &Address, index: u64) {
    env.events().publish(
        (Symbol::new(env, "subscriber_index_cleared"), user.clone()),
        index,
    );
}

pub fn publish_merchant_fee_recipient_set(env: &Env, merchant: &Address, recipient: &Address) {
    env.events().publish(
        (Symbol::new(env, "merchant_fee_recipient_set"), merchant.clone()),
        recipient.clone(),
    );
}

