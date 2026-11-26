// Legacy events use dynamic topics and version tags. Keep their wire encoding.
#![allow(deprecated)]

use soroban_sdk::{Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec};

use crate::Subscription;

/// Current event wire-schema marker. V1 is the historical shape with no marker.
const EVENT_SCHEMA_V2: &str = "v2";

/// Publish an event while appending its schema version after existing topics.
/// Keeping the marker last preserves the established event name and actor topic
/// positions for consumers that already index those fields.
fn publish_versioned<Topics, Data>(env: &Env, topics: Topics, data: Data)
where
    Topics: IntoVal<Env, Vec<Val>>,
    Data: IntoVal<Env, Val>,
{
    let mut topics = topics.into_val(env);
    topics.push_back(Symbol::new(env, EVENT_SCHEMA_V2).into_val(env));
    env.events().publish(topics, data);
}

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
    pub paid_to: Option<Address>,
    pub fee_bps: u32,
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
        (Symbol::new(env, "cancelled_with_refund"), user.clone()),
        CancelledWithRefundEventData {
            refund_amount: refund,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundedEventData {
    pub merchant: Address,
    pub amount: i128,
    pub fee: i128,
    pub net: i128,
    pub charged_at: u64,
    pub ledger_sequence: u32,
}

/// Publishes `refunded(user)` after a merchant refunds the last scheduled
/// charge without cancelling the subscription. `amount` is the gross amount
/// returned to the subscriber; `fee` and `net` are the reversed bookkeeping
/// legs booked at charge time (`fee + net == amount`).
pub fn publish_refunded(
    env: &Env,
    user: &Address,
    merchant: &Address,
    amount: i128,
    fee: i128,
    net: i128,
    charged_at: u64,
) {
    env.events().publish(
        (Symbol::new(env, "refunded"), user.clone()),
        RefundedEventData {
            merchant: merchant.clone(),
            amount,
            fee,
            net,
            charged_at,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChargeSkippedEventData {
    pub interval: u64,
    pub new_last_charged: u64,
    pub next_charge_at: u64,
    pub ledger_sequence: u32,
}

/// Publishes `charge_skipped(user)` after `skip_next_charge` advances the
/// subscription schedule by exactly one interval.
pub fn publish_charge_skipped(
    env: &Env,
    user: &Address,
    interval: u64,
    new_last_charged: u64,
    next_charge_at: u64,
) {
    env.events().publish(
        (Symbol::new(env, "charge_skipped"), user.clone()),
        ChargeSkippedEventData {
            interval,
            new_last_charged,
            next_charge_at,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

/// Publishes `pay_per_use(user)` for an instant micro-transfer to `merchant`.
/// The recipient is carried in the payload as `merchant` so indexers keying on
/// `(event, user)` still see every payment the subscriber made.
pub fn publish_pay_per_use(env: &Env, user: &Address, merchant: &Address, amount: i128) {
    publish_versioned(
        env,
        (Symbol::new(env, "pay_per_use"), user.clone()),
        PayPerUseEventData {
            merchant: merchant.clone(),
            amount,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

/// Publishes the same checked net amount used for the merchant transfer and revenue.
pub fn publish_charged(
    env: &Env,
    user: &Address,
    sub: &Subscription,
    fee_amount: i128,
    net: i128,
    charged_at: u64,
    paid_to: Option<Address>,
    fee_bps: u32,
) {
    // Charge payload gained `fee_bps`; mark only this event v3 so existing
    // consumers can continue decoding the v2 payload shape for other events.
    let mut topics: soroban_sdk::Vec<Val> = soroban_sdk::vec![
        env,
        Symbol::new(env, "charged").into_val(env),
        user.into_val(env)
    ];
    topics.push_back(Symbol::new(env, "v3").into_val(env));
    env.events().publish(
        topics,
        ChargeEventData {
            merchant: sub.merchant.clone(),
            gross: sub.amount,
            fee: fee_amount,
            net,
            charged_at,
            ledger_sequence: env.ledger().sequence(),
            paid_to,
            fee_bps,
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
    publish_versioned(
        env,
        (
            Symbol::new(env, "admin_transfer_proposed"),
            new_admin.clone(),
        ),
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
        (
            Symbol::new(env, "merchant_revenue_pruned"),
            merchant.clone(),
        ),
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
    publish_versioned(env, (Symbol::new(env, "batch_charge_skips"),), data);
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
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
    publish_versioned(
        env,
        (Symbol::new(env, "max_batch_size_set"),),
        MaxBatchSizeSetEventData { old, new },
    );
}
pub fn publish_max_whitelist_batch_size_set(env: &Env, old: u32, new: u32) {
    publish_versioned(
        env,
        (Symbol::new(env, "max_wl_batch_size_set"),),
        (old, new),
    );
}

pub fn publish_merchant_history_cleared(env: &Env, merchant: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "merch_hist_cleared"),),
        merchant.clone(),
    );
}

pub fn publish_paused(env: &Env, user: &Address) {
    publish_versioned(env, (Symbol::new(env, "paused"), user.clone()), ());
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseUntilEventData {
    pub expiry_timestamp: u64,
    pub ledger_sequence: u32,
}

pub fn publish_pause_until(env: &Env, user: &Address, expiry_timestamp: u64) {
    publish_versioned(
        env,
        (Symbol::new(env, "pause_until"), user.clone()),
        PauseUntilEventData {
            expiry_timestamp,
            ledger_sequence: env.ledger().sequence(),
        },
    );
}

pub fn publish_resumed(env: &Env, user: &Address) {
    publish_versioned(env, (Symbol::new(env, "resumed"), user.clone()), ());
}

pub fn publish_subscription_paused(env: &Env, user: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "subscription_paused"), user.clone()),
        (),
    );
}

pub fn publish_subscription_transferred(env: &Env, old_user: &Address, new_user: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "sub_transferred"), old_user.clone()),
        new_user.clone(),
    );
}

pub fn publish_subscription_transferred_detailed(
    env: &Env,
    from: &Address,
    to: &Address,
    sub: &Subscription,
) {
    publish_versioned(
        env,
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
    publish_versioned(env, (Symbol::new(env, "upgrade"),), new_wasm_hash.clone());
}

pub fn publish_upgrade_proposed(env: &Env, new_wasm_hash: &BytesN<32>) {
    publish_versioned(
        env,
        (Symbol::new(env, "upg_proposed"),),
        new_wasm_hash.clone(),
    );
}

pub fn publish_upgrade_cancelled(env: &Env) {
    publish_versioned(env, (Symbol::new(env, "upg_cancelled"),), ());
}

pub fn publish_contract_paused(env: &Env) {
    publish_versioned(env, (Symbol::new(env, "contract_paused"),), ());
}

pub fn publish_contract_unpaused(env: &Env) {
    publish_versioned(env, (Symbol::new(env, "contract_unpaused"),), ());
}

pub fn publish_daily_limit_set(env: &Env, user: &Address, limit: i128) {
    publish_versioned(
        env,
        (Symbol::new(env, "daily_limit_set"), user.clone()),
        limit,
    );
}

pub fn publish_daily_limit_removed(env: &Env, user: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "daily_limit_removed"), user.clone()),
        (),
    );
}

pub fn publish_fee_cleared(env: &Env) {
    publish_versioned(env, (Symbol::new(env, "fee_cleared"),), ());
}

pub fn publish_daily_window_started(env: &Env, user: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "daily_window_started"), user.clone()),
        (),
    );
}
pub fn publish_subscription_amount_updated(
    env: &Env,
    user: &Address,
    old_amount: i128,
    new_amount: i128,
) {
    publish_versioned(
        env,
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
    publish_versioned(
        env,
        (Symbol::new(env, "sub_interval_updated"), user.clone()),
        (old_interval, new_interval),
    );
}

pub fn publish_referred(env: &Env, user: &Address, referrer: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "referred"), user.clone()),
        referrer.clone(),
    );
}

pub fn publish_admin_transferred(env: &Env, old_admin: &Address, new_admin: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "admin_transferred"),),
        (old_admin.clone(), new_admin.clone()),
    );
}

pub fn publish_fee_proposed(env: &Env, collector: &Address, bps: u32) {
    publish_versioned(
        env,
        (Symbol::new(env, "fee_proposed"),),
        (collector.clone(), bps),
    );
}

pub fn publish_fee_committed(env: &Env, collector: &Address, bps: u32) {
    publish_versioned(
        env,
        (Symbol::new(env, "fee_committed"),),
        (collector.clone(), bps),
    );
}

pub fn publish_merchant_added(env: &Env, merchant: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_added"), merchant.clone()),
        (),
    );
}

pub fn publish_merchant_removed(env: &Env, merchant: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_removed"), merchant.clone()),
        (),
    );
}

pub fn publish_merchant_frozen(env: &Env, merchant: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_frozen"), merchant.clone()),
        (),
    );
}

pub fn publish_merchant_unfrozen(env: &Env, merchant: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_unfrozen"), merchant.clone()),
        (),
    );
}

pub fn publish_grace_period_proposed(env: &Env, seconds: u64) {
    publish_versioned(env, (Symbol::new(env, "grace_period_proposed"),), seconds);
}

pub fn publish_grace_period_committed(env: &Env, seconds: u64) {
    publish_versioned(env, (Symbol::new(env, "grace_period_committed"),), seconds);
}

pub fn publish_subscription_auto_resumed(env: &Env, user: &Address) {
    publish_versioned(
        env,
        (Symbol::new(env, "subscription_auto_resumed"), user.clone()),
        (),
    );
}

pub fn publish_migration_completed(env: &Env, version: u32, user_count: u32) {
    publish_versioned(
        env,
        (Symbol::new(env, "migration_completed"),),
        (version, user_count),
    );
}

pub fn publish_subscriber_index_ttl_extended(env: &Env, count: u64) {
    publish_versioned(
        env,
        (Symbol::new(env, "subscriber_index_ttl_extended"),),
        count,
    );
}

pub fn publish_merchant_state_ttl_extended(env: &Env, count: u64) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_state_ttl_extended"),),
        count,
    );
}

/// Audit event for a successful admin repair of a stale subscriber index slot.
pub fn publish_subscriber_index_cleared(env: &Env, user: &Address, index: u64) {
    publish_versioned(
        env,
        (Symbol::new(env, "subscriber_index_cleared"), user.clone()),
        index,
    );
}

pub fn publish_merchant_fee_recipient_set(env: &Env, merchant: &Address, recipient: &Address) {
    publish_versioned(
        env,
        (
            Symbol::new(env, "merchant_fee_recipient_set"),
            merchant.clone(),
        ),
        recipient.clone(),
    );
}

pub fn publish_merchant_max_per_use_set(env: &Env, merchant: &Address, max_amount: i128) {
    publish_versioned(
        env,
        (
            Symbol::new(env, "merchant_max_per_use_set"),
            merchant.clone(),
        ),
        max_amount,
    );
}

pub fn publish_merchant_fee_recipient_cleared(env: &Env, merchant: &Address) {
    publish_versioned(
        env,
        (
            Symbol::new(env, "merchant_fee_recipient_cleared"),
            merchant.clone(),
        ),
        (),
    );
}

pub fn publish_fee_bounds_set(env: &Env, min_bps: u32, max_bps: u32) {
    publish_versioned(
        env,
        (Symbol::new(env, "fee_bounds_set"),),
        (min_bps, max_bps),
    );
}

pub fn publish_operator_changed(env: &Env, operator: &Option<Address>) {
    publish_versioned(
        env,
        (Symbol::new(env, "operator_changed"),),
        operator.clone(),
    );
}

pub fn publish_merchant_fee_bps_set(env: &Env, merchant: &Address, bps: Option<u32>) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_fee_bps_set"), merchant.clone()),
        bps,
    );
}

pub fn publish_referral_reward_accrued(
    env: &Env,
    user: &Address,
    referrer: &Address,
    amount: i128,
) {
    publish_versioned(
        env,
        (Symbol::new(env, "referral_reward_accrued"), user.clone()),
        (referrer.clone(), amount),
    );
}

pub fn publish_referral_reward_withdrawn(env: &Env, referrer: &Address, amount: i128) {
    publish_versioned(
        env,
        (
            Symbol::new(env, "referral_reward_withdrawn"),
            referrer.clone(),
        ),
        amount,
    );
}

pub fn publish_referral_reward_policy(env: &Env, bps: u32, max_charges: u32) {
    publish_versioned(
        env,
        (Symbol::new(env, "referral_reward_policy"),),
        (bps, max_charges),
    );
}

pub fn publish_global_volume_cap_set(env: &Env, old: i128, new: i128) {
    publish_versioned(
        env,
        (Symbol::new(env, "global_volume_cap_set"),),
        (old, new),
    );
}

pub fn publish_whitelist_enabled(env: &Env, enabled: bool) {
    publish_versioned(env, (Symbol::new(env, "whitelist_enabled"),), enabled);
}

pub fn publish_merchant_withdrawal(env: &Env, merchant: &Address, amount: i128) {
    publish_versioned(
        env,
        (Symbol::new(env, "merchant_withdrawal"), merchant.clone()),
        amount,
    );
}

/// Publishes `keeper_tip_bps_set(old, new)` when the admin changes the keeper tip.
pub fn publish_keeper_tip_bps_set(env: &Env, old: u32, new: u32) {
    env.events()
        .publish((Symbol::new(env, "keeper_tip_bps_set"),), (old, new));
}

/// Publishes `keeper_tip(keeper, user, tip)` when a `charge_with_tip` call pays
/// the keeper its share of the protocol fee. `tip` is in token base units.
pub fn publish_keeper_tip(env: &Env, keeper: &Address, user: &Address, tip: i128) {
    env.events().publish(
        (Symbol::new(env, "keeper_tip"), keeper.clone()),
        (user.clone(), tip),
    );
}

/// Publishes `migration_progress(migrated_accounts)` after a `migrate` batch
/// processes at least one new account. `migrated_accounts` is the running total
/// for this upgrade, so indexers can follow progress without polling.
pub fn publish_migration_progress(env: &Env, migrated_accounts: u64) {
    env.events()
        .publish((Symbol::new(env, "migration_progress"),), migrated_accounts);
}
