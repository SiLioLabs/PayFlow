use soroban_sdk::{Address, BytesN, Env, String, Symbol};

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

/// Publishes `cancelled(user)` after a subscription is cancelled.
pub fn publish_cancelled(env: &Env, user: &Address) {
    env.events().publish(
        (Symbol::new(env, "cancelled"), user.clone()),
        CancelledEventData {
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

/// Publishes `cancelled_with_refund(user, refund)` after a prorated refund
/// cancels the subscription. `refund` is the amount transferred back to the
/// subscriber, in the subscription's token.
pub fn publish_cancelled_with_refund(env: &Env, user: &Address, refund: i128) {
    env.events().publish(
        (Symbol::new(env, "cancelled_with_refund"), user.clone()),
        CancelledWithRefundEventData {
            refund_amount: refund,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

/// Publishes `pay_per_use(user)` for an instant micro-transfer to `merchant`.
/// The recipient is carried in the payload as `merchant` so indexers keying on
/// `(event, user)` still see every payment the subscriber made.
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
// Admin transfer events
// ─────────────────────────────────────────────────────────────
//
// `transfer_admin` stages a pending admin takeover by storing `PendingAdmin`,
// but previously emitted nothing; only `accept_admin` fired `admin_transferred`.
// That left the first half of the two-step handoff invisible to indexers and
// monitoring. `admin_transfer_proposed` closes the gap by announcing the
// proposed address at staging time. The `accept_admin` event is unchanged.

/// Payload for `admin_transfer_proposed`. Carries the proposed new admin.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferProposedEventData {
    pub new_admin: Address,
    pub ledger_sequence: u32,
}

/// Publishes `admin_transfer_proposed(new_admin)` when a transfer is staged.
pub fn publish_admin_transfer_proposed(env: &Env, new_admin: &Address) {
    env.events().publish(
        (Symbol::new(env, "admin_transfer_proposed"), new_admin.clone()),
        AdminTransferProposedEventData {
            new_admin: new_admin.clone(),
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

// ─────────────────────────────────────────────────────────────
// Subscription metadata events
// ─────────────────────────────────────────────────────────────
//
// `set_metadata` and `clear_metadata` mutate per-subscription labels without
// emitting events, while every other state-changing action publishes one.
// Indexers and the frontend's EventFeed cannot reconstruct label history
// without these events, leaving the event catalog incomplete.

/// Payload for `metadata_set`. Carries the subject (user) and the label that
/// was written.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataSetEventData {
    pub user: Address,
    pub label: String,
    pub ledger_sequence: u32,
}

/// Payload for `metadata_cleared`. Carries the subject (user) whose label was
/// removed.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataClearedEventData {
    pub user: Address,
    pub ledger_sequence: u32,
}

/// Publishes `metadata_set(user)` with the written label.
pub fn publish_metadata_set(env: &Env, user: &Address, label: &String) {
    env.events().publish(
        (Symbol::new(env, "metadata_set"), user.clone()),
        MetadataSetEventData {
            user: user.clone(),
            label: label.clone(),
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

/// Publishes `metadata_cleared(user)`.
pub fn publish_metadata_cleared(env: &Env, user: &Address) {
    env.events().publish(
        (Symbol::new(env, "metadata_cleared"), user.clone()),
        MetadataClearedEventData {
            user: user.clone(),
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

// ─────────────────────────────────────────────────────────────
// Merchant revenue audit events
// ─────────────────────────────────────────────────────────────
//
// `reset_merchant_revenue` and `prune_merchant_revenue_days` destroy merchant
// revenue history. Without an on-chain event, ops tooling and indexers cannot
// distinguish an operator reset from a bug or archival, and annual/journal
// reconciliation has no trail. These events close that gap.

/// Payload for `merchant_revenue_reset`. Emitted when an operator resets a
/// merchant's revenue history.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantRevenueResetEventData {
    pub merchant: Address,
    pub ledger_sequence: u32,
}

/// Payload for `merchant_revenue_pruned`. `removed_days` is the number of day
/// buckets removed, so reconciliation can account for the pruned history.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantRevenuePrunedEventData {
    pub merchant: Address,
    pub removed_days: u32,
    pub ledger_sequence: u32,
}

/// Publishes `merchant_revenue_reset(merchant)`.
pub fn publish_merchant_revenue_reset(env: &Env, merchant: &Address) {
    env.events().publish(
        (Symbol::new(env, "merchant_revenue_reset"), merchant.clone()),
        MerchantRevenueResetEventData {
            merchant: merchant.clone(),
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

/// Publishes `merchant_revenue_pruned(merchant)` with the number of removed
/// day buckets.
pub fn publish_merchant_revenue_pruned(env: &Env, merchant: &Address, removed_days: u32) {
    env.events().publish(
        (Symbol::new(env, "merchant_revenue_pruned"), merchant.clone()),
        MerchantRevenuePrunedEventData {
            merchant: merchant.clone(),
            removed_days,
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
    env.events().publish(
        (Symbol::new(env, "batch_charge_skips"),),
        data,
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

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaxBatchSizeSetEventData {
    pub old: u32,
    pub new: u32,
}

pub fn publish_max_batch_size_set(env: &Env, old: u32, new: u32) {
    env.events().publish(
        (Symbol::new(env, "max_batch_size_set"),),
        MaxBatchSizeSetEventData { old, new },
    );
}
pub fn publish_max_whitelist_batch_size_set(env: &Env, old: u32, new: u32) {
    env.events()
        .publish((Symbol::new(env, "max_wl_batch_size_set"),), (old, new));
}

pub fn publish_merchant_history_cleared(env: &Env, merchant: &Address) {
    env.events()
        .publish((Symbol::new(env, "merch_hist_cleared"),), merchant.clone());
}

pub fn publish_paused(env: &Env, user: &Address) {
    env.events()
        .publish((Symbol::new(env, "paused"), user.clone()), ());
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseUntilEventData {
    pub expiry_timestamp: u64,
    pub ledger_sequence: u32,
}

pub fn publish_pause_until(env: &Env, user: &Address, expiry_timestamp: u64) {
    env.events().publish(
        (Symbol::new(env, "pause_until"), user.clone()),
        PauseUntilEventData {
            expiry_timestamp,
            ledger_sequence: env.ledger().sequence(),
        },
    );
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

pub fn publish_upgraded(env: &Env, new_wasm_hash: &BytesN<32>) {
    env.events()
        .publish((Symbol::new(env, "upgrade"),), new_wasm_hash.clone());
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

pub fn publish_merchant_fee_recipient_cleared(env: &Env, merchant: &Address) {
    env.events().publish(
        (Symbol::new(env, "merchant_fee_recipient_cleared"), merchant.clone()),
        (),
    );
}

pub fn publish_fee_bounds_set(env: &Env, min_bps: u32, max_bps: u32) {
    env.events()
        .publish((Symbol::new(env, "fee_bounds_set"),), (min_bps, max_bps));
}

pub fn publish_global_volume_cap_set(env: &Env, old: i128, new: i128) {
    env.events()
        .publish((Symbol::new(env, "global_volume_cap_set"),), (old, new));
}

pub fn publish_whitelist_enabled(env: &Env, enabled: bool) {
    env.events()
        .publish((Symbol::new(env, "whitelist_enabled"),), enabled);
}

/// Publishes `metadata_cleared` event — called from `subscription_metadata::clear_metadata`.
pub fn metadata_cleared(env: &Env, user: &Address) {
    env.events().publish(
        (Symbol::new(env, "metadata_cleared"), user.clone()),
        user.clone(),
    );
}

pub fn publish_merchant_withdrawal(env: &Env, merchant: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "merchant_withdrawal"), merchant.clone()),
        amount,
    );
}
