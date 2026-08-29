#![no_std]
#![allow(clippy::too_many_arguments, clippy::inconsistent_digit_grouping)]

#[cfg(test)]
extern crate std;

mod admin;
mod batch;
#[cfg(feature = "bench")]
mod bench;
mod charge_exec;
mod errors;
mod events;
mod fee;
mod grace;
mod merchant_stats;
mod migration;
mod min_interval;
mod referral;
mod spending_limit;
mod storage;
mod subscription_count;
mod subscription_history;
mod subscription_metadata;
mod test;
mod trial;
mod upgrade;
mod validation;
mod whitelist;

use crate::errors::ContractError;
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, String, Symbol, Vec,
};

pub use batch::ChargeResult;
pub use batch::CancelResult;
pub use charge_exec::ChargeSimResult;
pub use charge_exec::PayPerUseSimResult;

// ─────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Subscription(Address),
    Token,
    // Admin
    Admin,
    // Grace period
    GracePeriod,
    // Merchant whitelist
    MerchantWhitelist(Address),
    WhitelistEnabled,
    WhitelistIndex(u32),
    WhitelistIndexSize,
    // Merchant freeze: blocks new subscriptions, independent of whitelist status
    MerchantFrozen(Address),
    MerchantFreezeReason(Address),
    // Protocol fee
    FeeCollector,
    FeeBps,
    // Feature: subscription count
    ActiveCount,
    // Feature: merchant revenue stats
    MerchantRevenue(Address),
    // Per-day merchant revenue buckets (keyed by Unix day)
    MerchantRevenueDay(Address, u64),
    // Index of which days have revenue buckets for a merchant
    MerchantRevenueDayIndex(Address),
    // Feature: daily spending limits (temporary storage)
    DailyLimit(Address),
    DailySpent(Address),
    DayStart(Address),
    // Feature: referral tracking
    Referral(Address),
    // Feature: state migration
    SchemaVersion,
    // Feature: subscription metadata labels
    SubscriptionMeta(Address),
    // Feature: charge history
    ChargeHistory(Address),
    // Feature: global volume cap
    GlobalVolumeWindow,
    // Feature: batch size limit override
    MaxBatchSize,
    // Feature: contract pause
    ContractPaused,
    // Feature: minimum subscription interval floor
    MinInterval,
    // Feature: consolidated merchant revenue history (Vec<i128>)
    MerchantRevenueHistory(Address),
    // Feature: subscriber index (append-only log)
    SubscriberIndex(u64),
    SubscriberIndexSize,
    // Reverse lookup of a subscriber's slot, used to prune on cancel
    SubscriberIndexSlot(Address),
    // Tombstone marking a pruned (cancelled) subscriber index slot
    SubscriberIndexRemoved(u64),
    // Feature: per-merchant subscriber count
    MerchantSubCount(Address),
    // Feature: merchant index for governance/ranking
    MerchantIndex(u32),
    MerchantIndexSize,
    MerchantKnown(Address),
    // Pending admin for two-step transfer
    PendingAdmin,
    // Two-step auth for protocol fee
    PendingFee,
    // Per-merchant custom fee recipient (merchant -> destination)
    MerchantFeeRecipient(Address),
    // Two-step auth for grace period
    PendingGracePeriod,
    // Two-step auth for upgrade
    PendingUpgrade,
    // Feature: pause expiry (bounded pause with auto-resume)
    PauseExpiry(Address),
    // Feature: cumulative protocol fees collected across all merchants
    TotalProtocolFees,
    // Feature: configurable global hourly volume cap override
    GlobalVolumeCapOverride,
    // Feature: configurable min/max fee bps bounds
    MinFeeBps,
    MaxFeeBps,
    // Feature: configurable whitelist batch size limit override
    MaxWhitelistBatchSize,
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

pub const SUBSCRIPTION_TTL_LEDGERS: u32 = 6307200; // ~1 year (assuming 5s blocks)
pub const MAX_BATCH_PAUSE_SUBSCRIPTIONS: u32 = 25;
/// Default cap for the admin whitelist batch entrypoints. Overridable at
/// runtime via `set_max_whitelist_batch_size`, bounded by `MAX_BATCH_SIZE_CEILING`.
pub const MAX_WHITELIST_BATCH_SIZE: u32 = 50;
/// Hard ceiling shared by every admin-configurable batch limit. Configured
/// limits are never allowed above this value, so batches stay bounded even if
/// an admin key is compromised.
pub const MAX_BATCH_SIZE_CEILING: u32 = 200;
pub const GLOBAL_MAX_VOLUME_PER_HOUR: i128 = 50_000_000_000_000; // 50 trillion stroops
pub const HOUR_IN_SECONDS: u64 = 3600;
pub const MAX_AMOUNT: i128 = 100_000_000_000;
pub const MAX_SUBSCRIPTION_AMOUNT: i128 = 100_000_000_000_000;

// ─────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub merchant: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_charged: u64,
    pub active: bool,
    pub paused: bool,              // true if paused, false otherwise
    pub token: Address,            // SAC token used for this subscription
    pub referrer: Option<Address>, // optional referral address
    pub label: Symbol,             // user-assigned label for this subscription
    pub trial_duration: u64,       // optional trial duration in seconds
    pub created_at: u64,           // timestamp of subscription creation
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionHealth {
    pub active: bool,
    pub charge_due: bool,
    pub within_grace: bool,
    pub has_sufficient_allowance: bool,
    pub is_paused: bool,
    pub trial_active: bool,
    pub daily_limit_set: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DailyLimitStatus {
    pub limit: Option<i128>,
    pub spent: i128,
    pub day_start: Option<u64>,
    pub remaining: Option<i128>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct HealthReport {
    pub is_healthy: bool,
    pub contract_paused: bool,
    pub token_configured: bool,
    pub admin_configured: bool,
    /// Approximate instance TTL in ledgers. On-chain, this is a hardcoded
    /// lower-bound estimate (100_000) because Soroban does not expose
    /// `get_ttl()` outside test builds. Do not treat as precise.
    pub instance_ttl_ledgers: u32,
    pub active_subscription_count: u64,
    pub schema_version: u32,
    pub fee_collector_set: bool,
    pub global_volume_utilization_pct: u32,
    /// Number of merchants with unwithdrawn revenue > 0.
    pub pending_merchant_rev_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GlobalVolumeWindow {
    pub current_window_start: u64,
    pub accumulated_volume: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProtocolStats {
    pub active_count: u64,
    pub fee_bps: u32,
    pub fee_collector: Option<Address>,
    pub grace_period: u64,
    pub whitelist_enabled: bool,
    pub schema_version: u32,
    pub contract_paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractConfig {
    pub fee_bps: u32,
    pub fee_collector: Option<Address>,
    pub grace_period: u64,
    pub min_interval: u64,
    pub max_batch_size: u32,
    pub global_volume_cap: i128,
    pub whitelist_enabled: bool,
    pub paused: bool,
    pub schema_version: u32,
}

// ─────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────

pub(crate) fn cancel_inner(env: &Env, user: &Address) -> Subscription {
    let key = DataKey::Subscription(user.clone());
    let mut sub: Subscription = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

    sub.active = false;

    env.storage().persistent().set(&key, &sub);
    extend_subscription_ttl(env, user);

    subscription_count::decrement(env);
    subscription_count::remove_subscriber_index(env, user);
    merchant_stats::decrement_subscriber_count(env, &sub.merchant);
    referral::remove_referral(env, user);

    sub
}

#[contract]
pub struct FlowPay;

#[contractimpl]
impl FlowPay {
    /// One-time deploy entrypoint: persists the default SAC token and the
    /// contract admin. Admin must authorize this invoke.
    ///
    /// Deploy scripts (`scripts/deploy-pipeline.ts`, `scripts/testnet-setup.ts`)
    /// depend on these invariants:
    /// - arity is `initialize(token, admin)`
    /// - a second call returns typed `ContractError::AlreadyInitialized` (code 1)
    /// - success stores both token and admin, readable via `get_token` / `get_admin`
    pub fn initialize(env: Env, token: Address, admin: Address) {
        bump_instance_ttl(&env);

        if env.storage().instance().has(&DataKey::Token) {
            env.panic_with_error(ContractError::AlreadyInitialized);
        }

        // Authorize and persist admin before writing Token so a missing/invalid
        // admin signature cannot leave a token-only (partial) initialization.
        admin::initialize_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Permissionlessly refreshes the shared instance storage TTL.
    ///
    /// Keeper liveness probes may call this entrypoint during read- or
    /// simulation-heavy periods. It does not require auth, inspect pause
    /// state, transfer funds, or mutate protocol state.
    pub fn bump_instance_ttl(env: Env) {
        bump_instance_ttl(&env);
    }

    pub fn get_max_batch_size(env: Env) -> u32 {
        batch::get_max_batch_size(&env)
    }

    pub fn set_max_batch_size(env: Env, size: u32) {
        admin::require_admin(&env);
        if size > MAX_BATCH_SIZE_CEILING {
            env.panic_with_error(ContractError::InvalidBatchSize);
        }
        env.storage().instance().set(&DataKey::MaxBatchSize, &size);
    }

    /// Returns the batch cap applied to the admin whitelist batch entrypoints
    /// (`whitelist_batch_add`, `whitelist_batch_remove`, `get_merchant_statuses`).
    ///
    /// This is a **separate** knob from `get_max_batch_size`, which bounds the
    /// charge batches — see the design note in `whitelist.rs`. Defaults to
    /// `MAX_WHITELIST_BATCH_SIZE` (50).
    pub fn get_max_whitelist_batch_size(env: Env) -> u32 {
        whitelist::get_max_whitelist_batch_size(&env)
    }

    /// Admin-only: overrides the whitelist batch cap.
    ///
    /// Panics with `InvalidBatchSize` when `size` is zero or exceeds
    /// `MAX_BATCH_SIZE_CEILING` (200), so whitelist batches always stay bounded.
    pub fn set_max_whitelist_batch_size(env: Env, size: u32) {
        admin::require_admin(&env);
        whitelist::set_max_whitelist_batch_size(&env, size);
    }

    pub fn get_contract_config(env: Env) -> ContractConfig {
        ContractConfig {
            fee_bps: fee::get_fee_bps(&env),
            fee_collector: fee::get_fee_collector(&env),
            grace_period: grace::get_grace_period(&env),
            min_interval: min_interval::get_min_interval(&env),
            max_batch_size: batch::get_max_batch_size(&env),
            global_volume_cap: GLOBAL_MAX_VOLUME_PER_HOUR,
            whitelist_enabled: whitelist::is_whitelist_enabled(&env),
            paused: is_contract_paused(&env),
            schema_version: env
                .storage()
                .instance()
                .get(&DataKey::SchemaVersion)
                .unwrap_or(1),
        }
    }

    pub fn get_batch_charge_estimate(env: Env, users: Vec<Address>) -> Vec<ChargeResult> {
        if users.len() > 200 {
            env.panic_with_error(ContractError::BatchTooLarge);
        }
        let mut results: Vec<ChargeResult> = Vec::new(&env);
        let now = env.ledger().timestamp();
        let grace_period = grace::get_grace_period(&env);

        for user in users.iter() {
            let key = DataKey::Subscription(user.clone());
            let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);

            let result = match sub_opt {
                None => ChargeResult::NoSubscription,
                Some(mut sub) => {
                    if sub.paused && charge_exec::try_auto_resume(&env, &user, &mut sub, now) {
                        // Auto-resumed — fall through to allowance check below.
                        // Re-run precheck on the now-active sub to be safe, then
                        // mirror the same allowance check as the live batch path.
                        match charge_exec::precheck_charge(&sub, now, grace_period) {
                            Err(skip) => skip,
                            Ok(()) => {
                                if !validation::has_sufficient_allowance(
                                    &env, &user, &sub.token, sub.amount,
                                ) {
                                    ChargeResult::AllowanceInsufficient
                                } else {
                                    ChargeResult::Charged
                                }
                            }
                        }
                    } else {
                        match charge_exec::precheck_charge(&sub, now, grace_period) {
                            Err(skip) => skip,
                            Ok(()) => {
                                if !validation::has_sufficient_allowance(
                                    &env, &user, &sub.token, sub.amount,
                                ) {
                                    ChargeResult::AllowanceInsufficient
                                } else {
                                    ChargeResult::Charged
                                }
                            }
                        }
                    }
                }
            };
            results.push_back(result);
        }
        results
    }

    /// Creates or replaces a recurring subscription for `user`.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber address. Must authorize the call.
    /// - `merchant`: Recipient that receives recurring and pay-per-use transfers.
    /// - `amount`: Amount transferred per billing period. Must be greater than zero.
    /// - `interval`: Billing cadence in seconds. Must be greater than zero.
    /// - `token`: Stellar Asset Contract used for this subscription.
    /// - `trial_period`: Optional seconds to delay the first charge.
    /// - `referrer`: Optional referrer stored for the subscriber.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, the merchant whitelist rejects `merchant`,
    /// `amount` or `interval` is zero, or the contract allowance is below `amount`.
    ///
    /// # Side Effects
    ///
    /// Stores the subscription, refreshes its TTL, updates active subscription
    /// count and referral storage, and emits `subscribed`.
    pub fn subscribe(
        env: Env,
        user: Address,
        merchant: Address,
        amount: i128,
        interval: u64,
        token: Address,
        trial_period: Option<u64>,
        referrer: Option<Address>,
    ) {
        subscribe_inner(
            &env,
            user,
            merchant,
            amount,
            interval,
            token,
            trial_period,
            referrer,
        );
    }

    pub fn subscribe_with_metadata(
        env: Env,
        user: Address,
        merchant: Address,
        amount: i128,
        interval: u64,
        token: Address,
        trial_period: Option<u64>,
        referrer: Option<Address>,
        label: String,
    ) {
        if label.len() > 64 {
            env.panic_with_error(ContractError::MetadataLabelTooLong);
        }

        subscribe_inner(
            &env,
            user.clone(),
            merchant,
            amount,
            interval,
            token,
            trial_period,
            referrer,
        );

        let _ = subscription_metadata::set_metadata(&env, &user, label);
    }

    /// Charges the next due recurring payment for `user`.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber whose active subscription should be charged.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// No subscriber signature is required. The contract spends through the
    /// previously granted token allowance.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, no subscription exists, the subscription
    /// is inactive or paused, the interval has not elapsed, the grace period has
    /// elapsed, or token transfer authorization/allowance is insufficient.
    ///
    /// # Side Effects
    ///
    /// Transfers `amount` from `user` to the merchant, records merchant revenue
    /// and charge history, refreshes subscription TTL, updates `last_charged`,
    /// and emits `charged`.
    pub fn charge(env: Env, user: Address) {
        bump_instance_ttl(&env);
        ensure_contract_not_paused(&env);
        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        let now = env.ledger().timestamp();

        if sub.paused {
            if charge_exec::try_auto_resume(&env, &user, &mut sub, now) {
                // Auto-resumed; fall through to charge immediately
            } else {
                env.panic_with_error(ContractError::SubscriptionPaused);
            }
        } else if !sub.active {
            env.panic_with_error(ContractError::SubscriptionInactive);
        }

        let next = charge_exec::compute_next_charge_at(&sub)
            .unwrap_or_else(|| env.panic_with_error(ContractError::SubscriptionPaused));

        if now < next {
            env.panic_with_error(ContractError::IntervalNotElapsed);
        }

        let grace_period = grace::get_grace_period(&env);
        if grace_period > 0 && now > next + grace_period {
            env.panic_with_error(ContractError::GracePeriodElapsed);
        }

        charge_exec::execute_charge(&env, &user, &key, &mut sub, now);
    }

    pub fn extend_subscription_ttl(env: Env, user: Address) {
        extend_subscription_ttl(&env, &user);
    }

    /// Permissionlessly refreshes the TTL of any subscription entry.
    /// Returns early (no-op) if no subscription exists for `user`.
    /// No auth required — safe for keeper bots to call for dormant subscribers.
    pub fn bump_subscription(env: Env, user: Address) {
        extend_subscription_ttl(&env, &user);
    }

    /// Bumps TTL for multiple subscription entries in a single call.
    /// Returns a list of addresses whose TTLs were actually extended.
    pub fn batch_extend_subscription_ttl(env: Env, users: Vec<Address>) -> Vec<Address> {
        batch::batch_extend_subscription_ttl(&env, users)
    }

    /// Dry-run simulation of a charge call. Returns ChargeSimResult variant indicating
    /// whether charge would succeed or the reason it would fail.
    pub fn simulate_charge(env: Env, user: Address) -> ChargeSimResult {
        charge_exec::simulate_charge(&env, user)
    }

    /// Dry-run simulation of a `pay_per_use` call. Returns a PayPerUseSimResult
    /// variant indicating whether the pay-per-use would succeed or the reason it
    /// would fail (contract paused, invalid/inactive/paused subscription, daily
    /// limit exceeded, or insufficient allowance). Performs no state writes.
    pub fn simulate_pay_per_use(env: Env, user: Address, amount: i128) -> PayPerUseSimResult {
        charge_exec::simulate_pay_per_use(&env, user, amount, None)
    }

    /// Dry-run simulation of a `pay_per_use_to` call. Mirrors
    /// `simulate_pay_per_use` but also validates the `recipient` (contract-address
    /// self-reference and merchant whitelist). Performs no state writes.
    pub fn simulate_pay_per_use_to(
        env: Env,
        user: Address,
        amount: i128,
        recipient: Address,
    ) -> PayPerUseSimResult {
        charge_exec::simulate_pay_per_use(&env, user, amount, Some(recipient))
    }

    /// Executes an immediate pay-per-use charge for an active subscription.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber address. Must authorize the call.
    /// - `amount`: One-time amount to transfer. Must be greater than zero.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, `amount` is zero, no subscription
    /// exists, the subscription is inactive or paused, the daily spending limit
    /// would be exceeded, or token transfer authorization/allowance is insufficient.
    ///
    /// # Side Effects
    ///
    /// Transfers `amount` to the subscription merchant, updates merchant revenue
    /// and daily spend tracking, and emits `pay_per_use`.
    pub fn pay_per_use(env: Env, user: Address, amount: i128) {
        bump_instance_ttl(&env);
        pay_per_use_inner(&env, user, amount, None);
    }

    /// Executes an immediate pay-per-use charge for an active subscription,
    /// routing payment to `recipient` instead of the subscription's merchant.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber address. Must authorize the call.
    /// - `amount`: One-time amount to transfer. Must be greater than zero.
    /// - `recipient`: Address that receives the net payment instead of `sub.merchant`.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Same as `pay_per_use`, plus panics if the merchant whitelist is enabled
    /// and `recipient` is not whitelisted.
    ///
    /// # Side Effects
    ///
    /// Transfers `amount` to `recipient`, updates `recipient`'s merchant revenue
    /// and the user's daily spend tracking (shared with `pay_per_use`), and
    /// emits `pay_per_use` with `recipient` in place of `sub.merchant`.
    pub fn pay_per_use_to(env: Env, user: Address, amount: i128, recipient: Address) {
        pay_per_use_inner(&env, user, amount, Some(recipient));
    }

    pub fn get_day_start(env: Env, user: Address) -> Option<u64> {
        spending_limit::get_day_start(&env, &user)
    }

    /// Cancels `user`'s active subscription.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber address. Must authorize the call.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Panics if no subscription exists for `user`.
    ///
    /// # Side Effects
    ///
    /// Marks the subscription inactive, decrements active subscription count, and
    /// emits `cancelled`.
    pub fn cancel(env: Env, user: Address) {
        bump_instance_ttl(&env);
        user.require_auth();
        cancel_inner(&env, &user);
        events::publish_cancelled(&env, &user);
    }

    /// Extends an active subscription's trial period (or delays next charge)
    /// by adding `additional_seconds` to its `last_charged` timestamp.
    ///
    /// # Panics
    /// - If `additional_seconds` is 0 (`IntervalMustBePositive`).
    /// - If the subscription is cancelled/inactive (`SubscriptionInactive`).
    /// - If the subscription is paused (`SubscriptionPaused`).
    /// - If the subscription doesn't exist (`NoSubscriptionFound`).
    /// - If `last_charged + additional_seconds` overflows `u64` (`ArithmeticOverflow`).
    pub fn extend_trial(env: Env, user: Address, additional_seconds: u64) {
        bump_instance_ttl(&env);
        user.require_auth();
        trial::extend_trial(&env, &user, additional_seconds);
    }

    pub fn cancel_and_refund_prorated(env: Env, user: Address, merchant: Address) {
        bump_instance_ttl(&env);
        user.require_auth();
        merchant.require_auth();

        let key = DataKey::Subscription(user.clone());
        let sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        if !sub.active {
            env.panic_with_error(ContractError::SubscriptionInactive);
        }
        if sub.paused {
            env.panic_with_error(ContractError::SubscriptionPaused);
        }
        if sub.merchant != merchant {
            env.panic_with_error(ContractError::RefundMerchantMismatch);
        }

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(sub.last_charged);
        let remaining = sub.interval.saturating_sub(elapsed);
        if sub.interval == 0 {
            env.panic_with_error(ContractError::IntervalMustBePositive);
        }
        let refund = (sub.amount * i128::from(remaining)) / i128::from(sub.interval);

        if refund <= 0 {
            env.panic_with_error(ContractError::RefundAmountMustBePositive);
        }

        // Refunds are merchant-funded; no protocol escrow is used. Validate the
        // source balance before the transfer so an underfunded merchant cannot
        // reach an opaque SAC failure or a partial cancellation.
        let token_client = token::Client::new(&env, &sub.token);
        if token_client.balance(&merchant) < refund {
            env.panic_with_error(ContractError::InsufficientMerchantBalance);
        }

        token_client.transfer(&merchant, &user, &refund);
        cancel_inner(&env, &user);
        events::publish_cancelled_with_refund(&env, &user, refund);
    }

    /// Pauses `user`'s subscription without cancelling it.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber address. Must authorize the call.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Panics if no subscription exists or the subscription is inactive.
    ///
    /// # Side Effects
    ///
    /// Sets the subscription `paused` flag and emits `paused`.
    pub fn pause(env: Env, user: Address) {
        bump_instance_ttl(&env);
        user.require_auth();

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        if !sub.active {
            env.panic_with_error(ContractError::SubscriptionInactive);
        }

        sub.paused = true;

        env.storage().persistent().set(&key, &sub);
        extend_subscription_ttl(&env, &user);
        storage::set_pause_expiry(&env, &user, u64::MAX);

        events::publish_paused(&env, &user);
    }

    /// Pauses `user`'s subscription until a specific expiry timestamp.
    /// The subscription will auto-resume via `charge` or `batch_charge`
    /// when the ledger timestamp reaches `expiry`.
    pub fn pause_until(env: Env, user: Address, expiry: u64) {
        bump_instance_ttl(&env);
        user.require_auth();

        let now = env.ledger().timestamp();
        if expiry <= now {
            env.panic_with_error(ContractError::InvalidPauseExpiry);
        }

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        if !sub.active {
            env.panic_with_error(ContractError::SubscriptionNotActive);
        }

        sub.paused = true;
        sub.active = false;

        env.storage().persistent().set(&key, &sub);
        storage::set_pause_expiry(&env, &user, expiry);

        events::publish_paused(&env, &user);
    }

    /// Resumes `user`'s paused subscription.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber address. Must authorize the call.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Panics if no subscription exists or the subscription is inactive.
    ///
    /// # Side Effects
    ///
    /// Clears the subscription `paused` flag and emits `resumed`.
    pub fn resume(env: Env, user: Address) {
        bump_instance_ttl(&env);
        user.require_auth();

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        // Reject cancelled subscriptions (inactive and not paused).
        // pause_until sets active=false while paused=true; those must still be resumable.
        if !sub.active && !sub.paused {
            env.panic_with_error(ContractError::SubscriptionInactive);
        }

        // Recovery rule: if the grace window has closed the subscription is no longer
        // chargeable. Resume is rejected to prevent false recoverability signals.
        // The only allowed exit is cancel(); re-subscribe to restore chargeability.
        // See docs/SUBSCRIBER-LIFECYCLE.md.
        if grace::is_grace_lapsed(&env, &sub) {
            env.panic_with_error(ContractError::ResumeGraceLapsed);
        }

        sub.paused = false;
        sub.active = true;

        env.storage().persistent().set(&key, &sub);
        extend_subscription_ttl(&env, &user);
        storage::clear_pause_expiry(&env, &user);

        events::publish_resumed(&env, &user);
    }

    /// Batch-pauses subscriptions for a list of user addresses.
    ///
    /// Admin-only emergency tool to freeze groups of related accounts in a
    /// single transaction. The vector is capped at 25 items to stay within
    /// ledger size constraints.
    ///
    /// # Parameters
    ///
    /// - `users`: List of subscriber addresses to pause. Max 25 items.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from the contract admin.
    ///
    /// # Side Effects
    ///
    /// For every valid active subscription, sets `paused = true`, persists the
    /// update, extends the subscription TTL, and emits a `subscription_paused`
    /// event. Invalid (non-existent) and already-paused entries are silently
    /// skipped. The contract pause flag does **not** block this call.
    pub fn batch_pause_subscriptions(env: Env, users: Vec<Address>) {
        admin::require_admin(&env);

        let max_batch: u32 = 25;
        if users.len() > max_batch {
            env.panic_with_error(ContractError::BatchTooLarge);
        }

        for user in users.iter() {
            let key = DataKey::Subscription(user.clone());

            let sub_opt: Option<Subscription> = env.storage().persistent().get(&key);
            if let Some(mut sub) = sub_opt {
                if !sub.active || sub.paused {
                    if sub.paused {
                        extend_subscription_ttl(&env, &user);
                    }
                    continue;
                }

                sub.paused = true;

                env.storage().persistent().set(&key, &sub);
                extend_subscription_ttl(&env, &user);
                events::publish_subscription_paused(&env, &user);
            }
        }
    }

    pub fn batch_cancel(env: Env, users: Vec<Address>) -> Vec<CancelResult> {
        admin::require_admin(&env);
        batch::batch_cancel(&env, users)
    }

    /// Proposes a new admin (step 1 of two-step transfer).
    /// The proposed address must call `accept_admin()` to complete the transfer.
    ///
    /// # Auth
    ///
    /// Requires authorization from the current admin.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        admin::transfer_admin(&env, &new_admin);
    }

    /// Accepts a pending admin transfer (step 2 of two-step transfer).
    /// Emits `admin_transferred` and replaces the active admin.
    ///
    /// # Auth
    ///
    /// Requires authorization from the pending (new) admin.
    pub fn accept_admin(env: Env) {
        admin::accept_admin(&env);
    }

    /// Returns the proposed admin address awaiting `accept_admin()`, or
    /// `None` if there is no pending transfer.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        admin::get_pending_admin(&env)
    }

    /// Returns whether the contract is currently paused.
    pub fn is_contract_paused(env: Env) -> bool {
        is_contract_paused(&env)
    }

    /// Returns the current admin address, or `None` if no admin has been set.
    pub fn get_admin(env: Env) -> Option<Address> {
        storage::get_admin_optional(&env)
    }

    /// Returns the default token address set during `initialize()`, or `None` if not initialized.
    pub fn get_token(env: Env) -> Option<Address> {
        storage::get_token(&env)
    }

    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        upgrade::propose_upgrade(&env, new_wasm_hash);
    }

    pub fn cancel_pending_upgrade(env: Env) {
        upgrade::cancel_pending_upgrade(&env);
    }

    pub fn commit_upgrade(env: Env) {
        upgrade::commit_upgrade(&env);
    }

    /// Returns the pending WASM hash queued for the two-step upgrade flow,
    /// or `None` if no upgrade has been proposed.
    ///
    /// # Auth
    ///
    /// None required — view-only read.
    ///
    /// # Storage
    ///
    /// Reads `DataKey::PendingUpgrade` from temporary storage (TTL ~24 h).
    /// Returns `None` when the key has expired or was never set.
    pub fn get_pending_upgrade(env: Env) -> Option<BytesN<32>> {
        upgrade::get_pending_upgrade(&env)
    }

    pub fn clear_fee(env: Env) {
        admin::require_admin(&env);
        fee::clear_fee(&env);
        events::publish_fee_cleared(&env);
    }

    pub fn get_fee_collector(env: Env) -> Option<Address> {
        fee::get_fee_collector(&env)
    }

    /// Returns the cumulative protocol fees collected across all merchants,
    /// accumulated from every `charge()` and `pay_per_use()` call.
    pub fn get_total_protocol_fees(env: Env) -> i128 {
        fee::get_total_protocol_fees(&env)
    }

    pub fn get_subscription(env: Env, user: Address) -> Option<Subscription> {
        env.storage().persistent().get(&DataKey::Subscription(user))
    }

    pub fn get_subscription_age(env: Env, user: Address) -> Option<u64> {
        let sub: Subscription = env.storage().persistent().get(&DataKey::Subscription(user))?;

        if sub.created_at == 0 {
            return None; // sentinel for migrated/unknown subscriptions
        }

        Some(env.ledger().timestamp() - sub.created_at)
    }

    /// Returns the Unix timestamp of the next scheduled charge for a user.
    ///
    /// Returns `None` if no subscription exists, the subscription is inactive,
    /// or the subscription is paused.
    pub fn next_charge_at(env: Env, user: Address) -> Option<u64> {
        let sub = storage::get_subscription(&env, &user)?;
        charge_exec::compute_next_charge_at(&sub)
    }

    /// Returns `true` when `user` has a charge due right now.
    ///
    /// A charge is due when:
    /// - The subscription is active and not paused
    /// - `now >= next_charge_at` (interval has elapsed)
    /// - `now <= next_charge_at + grace_period` (still within grace window, or no grace period set)
    ///
    /// No auth required.
    pub fn is_charge_due(env: Env, user: Address) -> bool {
        let sub = match storage::get_subscription(&env, &user) {
            Some(s) => s,
            None => return false,
        };
        let next = match charge_exec::compute_next_charge_at(&sub) {
            Some(n) => n,
            None => return false,
        };
        let now = env.ledger().timestamp();
        if now < next {
            return false;
        }
        let grace = grace::get_grace_period(&env);
        if grace > 0 && now > next + grace {
            return false;
        }
        true
    }

    /// Returns the trial end timestamp if the user is in a trial period.
    pub fn get_trial_end(env: Env, user: Address) -> Option<u64> {
        trial::get_trial_end(env, user)
    }

    /// Proposes a new contract-wide grace period for charges.
    /// Only the contract admin can call this.
    pub fn propose_grace_period(env: Env, seconds: u64) {
        bump_instance_ttl(&env);
        grace::propose_grace_period(&env, seconds);
    }

    /// Commits a pending contract-wide grace period proposal.
    /// Only the contract admin can call this.
    pub fn commit_grace_period(env: Env) {
        bump_instance_ttl(&env);
        grace::commit_grace_period(&env);
    }

    /// Returns the current grace period in seconds. Returns 0 if not set.
    pub fn get_grace_period(env: Env) -> u64 {
        grace::get_grace_period(&env)
    }

    /// Updates the recurring charge amount for `user`'s subscription.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber whose subscription amount should be adjusted.
    /// - `new_amount`: Replacement amount for future charges. Must be positive
    ///   and must not exceed `MAX_SUBSCRIPTION_AMOUNT`.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from the contract admin.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, no subscription exists for `user`,
    /// or `new_amount` fails amount validation.
    ///
    /// # Side Effects
    ///
    /// Overwrites the subscription's `amount` field in persistent storage,
    /// refreshes its TTL, and emits `sub_amount_updated`.
    pub fn set_subscription_amount(env: Env, user: Address, new_amount: i128) {
        ensure_contract_not_paused(&env);
        admin::require_admin(&env);

        validation::require_valid_amount(&env, new_amount);

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        let old_amount = sub.amount;
        sub.amount = new_amount;

        env.storage().persistent().set(&key, &sub);
        extend_subscription_ttl(&env, &user);

        events::publish_subscription_amount_updated(&env, &user, old_amount, new_amount);
    }

    /// Updates the billing interval for `user`'s subscription.
    ///
    /// # Parameters
    ///
    /// - `user`: Subscriber whose subscription interval should be adjusted.
    /// - `new_interval`: Replacement interval in seconds. Must be strictly
    ///   greater than zero.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from the contract admin.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, no subscription exists for `user`,
    /// or `new_interval` is zero (`ContractError::IntervalTooShort`).
    ///
    /// # Side Effects
    ///
    /// Overwrites the subscription's `interval` field in persistent storage,
    /// refreshes its TTL, and emits `sub_interval_updated`. The change takes
    /// effect immediately: `next_charge_at` will return
    /// `last_charged + new_interval` after this call.
    pub fn set_subscription_interval(env: Env, user: Address, new_interval: u64) {
        ensure_contract_not_paused(&env);
        admin::require_admin(&env);

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        validation::require_valid_interval(&env, new_interval);

        let old_interval = sub.interval;
        sub.interval = new_interval;

        env.storage().persistent().set(&key, &sub);
        extend_subscription_ttl(&env, &user);

        events::publish_subscription_interval_updated(&env, &user, old_interval, new_interval);
    }

    /// Sets the minimum allowed subscription interval in seconds.
    /// Only the contract admin can call this. Panics if seconds == 0.
    pub fn set_min_interval(env: Env, seconds: u64) {
        assert!(seconds > 0, "min interval must be positive");
        admin::require_admin(&env);
        min_interval::set_min_interval(&env, seconds);
    }

    /// Returns the minimum allowed subscription interval in seconds.
    /// Defaults to 3600 (1 hour) when unset.
    pub fn get_min_interval(env: Env) -> u64 {
        min_interval::get_min_interval(&env)
    }

    /// Adds a merchant to the whitelist.
    pub fn add_merchant(env: Env, merchant: Address) {
        bump_instance_ttl(&env);
        admin::require_admin(&env);
        whitelist::add_merchant(&env, &merchant);
    }

    /// Removes a merchant from the whitelist.
    pub fn remove_merchant(env: Env, merchant: Address) {
        bump_instance_ttl(&env);
        admin::require_admin(&env);
        whitelist::remove_merchant(&env, &merchant);
    }

    /// Adds multiple merchants to the whitelist in a single call.
    /// Admin-only. Duplicates are idempotent.
    /// Returns the number of entries processed.
    ///
    /// Capped at the configurable whitelist batch limit
    /// (`get_max_whitelist_batch_size`, default 50); panics with
    /// `BatchTooLarge` above it.
    pub fn whitelist_batch_add(env: Env, merchants: Vec<Address>) -> u32 {
        admin::require_admin(&env);

        whitelist::require_batch_within_limit(&env, merchants.len());

        for merchant in merchants.iter() {
            whitelist::add_merchant(&env, &merchant);
        }

        merchants.len()
    }

    /// Removes multiple merchants from the whitelist in a single call.
    /// Admin-only. Removing a non-whitelisted merchant is a no-op.
    /// Returns the number of entries processed.
    ///
    /// Capped at the configurable whitelist batch limit
    /// (`get_max_whitelist_batch_size`, default 50); panics with
    /// `BatchTooLarge` above it.
    pub fn whitelist_batch_remove(env: Env, merchants: Vec<Address>) -> u32 {
        admin::require_admin(&env);

        whitelist::require_batch_within_limit(&env, merchants.len());

        for merchant in merchants.iter() {
            whitelist::remove_merchant(&env, &merchant);
        }

        merchants.len()
    }

    /// Enables or disables the merchant whitelist.
    pub fn set_whitelist_enabled(env: Env, enabled: bool) {
        bump_instance_ttl(&env);
        admin::require_admin(&env);
        whitelist::set_whitelist_enabled(&env, enabled);
    }

    /// Returns whether the merchant whitelist is currently enabled. Defaults to true.
    pub fn get_whitelist_enabled(env: Env) -> bool {
        whitelist::get_whitelist_enabled(&env)
    }

    /// Returns whether the merchant whitelist is currently enabled.
    pub fn is_whitelist_enabled(env: Env) -> bool {
        whitelist::is_whitelist_enabled(&env)
    }

    /// Returns whether a merchant is whitelisted.
    pub fn is_merchant_whitelisted(env: Env, merchant: Address) -> bool {
        whitelist::is_whitelisted(&env, &merchant)
    }

    /// Returns a paginated vector of whitelisted merchants.
    pub fn get_whitelist_page(env: Env, offset: u32, limit: u32) -> Vec<Address> {
        whitelist::get_whitelist_page(&env, offset, limit)
    }

    /// Returns the total count of whitelisted merchants.
    pub fn get_whitelist_size(env: Env) -> u32 {
        whitelist::get_whitelist_size(&env)
    }

    /// Returns the whitelist and freeze status for a batch of merchant addresses.
    /// Capped at the configurable whitelist batch limit
    /// (`get_max_whitelist_batch_size`, default 50) so the read path and the
    /// admin write paths share one number.
    pub fn get_merchant_statuses(env: Env, merchants: Vec<Address>) -> Vec<(Address, bool, bool)> {
        whitelist::require_batch_within_limit(&env, merchants.len());
        let mut result = Vec::new(&env);
        for merchant in merchants.iter() {
            let whitelisted = whitelist::is_whitelisted(&env, &merchant);
            let frozen = whitelist::is_frozen(&env, &merchant);
            result.push_back((merchant, whitelisted, frozen));
        }
        result
    }

    /// Returns top N merchants ranked by subscriber count in descending order.
    /// `limit` is capped at 20; panics with `ContractError::BatchTooLarge` if exceeded.
    pub fn get_top_merchants_by_subs(env: Env, limit: u32) -> Vec<(Address, u32)> {
        merchant_stats::get_top_merchants_by_subs(&env, limit)
    }

    /// Sets a custom fee recipient for a merchant. The caller must be the merchant.
    /// The recipient cannot be the contract address and contract must not be paused.
    pub fn set_merchant_fee_recipient(env: Env, merchant: Address, recipient: Address) {
        ensure_contract_not_paused(&env);
        fee::set_merchant_fee_recipient(&env, &merchant, &recipient);
    }

    /// Returns the configured merchant fee recipient, or None when unset.
    pub fn get_merchant_fee_recipient(env: Env, merchant: Address) -> Option<Address> {
        fee::get_merchant_fee_recipient(&env, &merchant)
    }

    /// Freezes a merchant, blocking new subscriptions while leaving existing
    /// subscribers' charge and pay_per_use calls unaffected. Independent of
    /// whitelist status — idempotent.
    pub fn freeze_merchant(env: Env, merchant: Address, reason: Option<String>) {
        admin::require_admin(&env);
        whitelist::freeze(&env, &merchant, reason);
    }

    /// Unfreezes a merchant, allowing new subscriptions again. Idempotent.
    pub fn unfreeze_merchant(env: Env, merchant: Address) {
        admin::require_admin(&env);
        whitelist::unfreeze(&env, &merchant);
    }

    /// Returns the reason a merchant was frozen, if any.
    pub fn get_merchant_freeze_reason(env: Env, merchant: Address) -> Option<String> {
        whitelist::get_freeze_reason(&env, &merchant)
    }

    /// Extends the TTL of a specific merchant daily revenue bucket.
    pub fn bump_merchant_revenue_day(env: Env, merchant: Address, day: u64) {
        merchant_stats::bump_merchant_revenue_day(&env, &merchant, day);
    }

    /// Prunes missing or expired daily revenue buckets safely. Admin only.
    pub fn prune_merchant_revenue_days(env: Env, merchant: Address, days: Vec<u64>) {
        merchant_stats::prune_merchant_revenue_days(&env, &merchant, days);
    }

    /// Retrieves a specific daily revenue bucket. Returns 0 if missing.
    pub fn get_merchant_revenue_day(env: Env, merchant: Address, day: u64) -> i128 {
        merchant_stats::get_merchant_revenue_day(&env, &merchant, day)
    }

    /// Returns paginated per-day revenue pairs for a merchant.
    /// Limit is capped at 30. Returns an empty Vec if no history or out of bounds.
    pub fn get_merchant_revenue_day_page(
        env: Env,
        merchant: Address,
        offset: u32,
        limit: u32,
    ) -> Vec<(u64, i128)> {
        merchant_stats::get_merchant_revenue_day_page(&env, &merchant, offset, limit)
    }

    /// Returns whether a merchant is currently frozen.
    pub fn is_merchant_frozen(env: Env, merchant: Address) -> bool {
        whitelist::is_frozen(&env, &merchant)
    }

    /// Returns the current protocol fee settings, or `None` if unset.
    pub fn get_fee(env: Env) -> Option<(Address, u32)> {
        fee::get_fee_collector(&env).map(|collector| (collector, fee::get_fee_bps(&env)))
    }

    /// Proposes new protocol fee collection settings (step 1 of two-step commit).
    /// Stores the proposed `(collector, bps)` in temporary storage and emits
    /// `fee_proposed`. Must be followed by `commit_fee()` to take effect.
    ///
    /// # Auth
    ///
    /// Requires authorization from the current admin.
    ///
    /// # Errors
    ///
    /// Panics if `bps > 10000` (`InvalidFeeBps`) or if `collector` is the
    /// contract's own address (`InvalidFeeCollector`).
    pub fn propose_fee(env: Env, collector: Address, bps: u32) {
        bump_instance_ttl(&env);
        admin::require_admin(&env);
        fee::propose_fee(&env, collector, bps);
    }

    /// Commits a pending fee proposal (step 2 of two-step commit).
    /// Reads the pending `(collector, bps)` from temporary storage, applies it
    /// to instance storage, removes the pending entry, and emits `fee_committed`.
    ///
    /// # Auth
    ///
    /// Requires authorization from the current admin.
    ///
    /// # Errors
    ///
    /// Panics with `NoPendingProposal` if no pending fee exists.
    pub fn commit_fee(env: Env) {
        bump_instance_ttl(&env);
        admin::require_admin(&env);
        fee::commit_fee(&env);
    }

    // ─────────────────────────────────────────────────────────────
    // Batch charge
    // ─────────────────────────────────────────────────────────────

    /// Charges multiple subscribers in a single transaction.
    ///
    /// Each user is processed independently — individual failures (inactive,
    /// paused, interval not elapsed, etc.) are recorded as a `ChargeResult`
    /// variant and do **not** abort the batch.
    pub fn batch_charge(env: Env, users: Vec<Address>) -> Vec<ChargeResult> {
        bump_instance_ttl(&env);
        ensure_contract_not_paused(&env);
        batch::batch_charge(&env, users)
    }

    // ─────────────────────────────────────────────────────────────
    // Subscription count
    // ─────────────────────────────────────────────────────────────

    /// Returns the current number of active subscriptions.
    pub fn get_active_count(env: Env) -> u64 {
        subscription_count::get_active_count(&env)
    }

    // ─────────────────────────────────────────────────────────────
    // Subscriber index
    // ─────────────────────────────────────────────────────────────

    /// Returns the total number of unique subscribers ever recorded (append-only count).
    pub fn get_subscriber_count(env: Env) -> u64 {
        subscription_count::get_subscriber_index_size(&env)
    }

    /// Returns the subscriber address at the given index slot, or `None` if
    /// out of range or the slot has been pruned (cancelled subscriber).
    pub fn get_subscriber_at(env: Env, index: u64) -> Option<Address> {
        if subscription_count::is_subscriber_index_removed(&env, index) {
            return None;
        }
        env.storage()
            .persistent()
            .get(&DataKey::SubscriberIndex(index))
    }

    /// Returns a page of subscriber addresses starting at `offset`, capped at 50 per call.
    /// Pruned (cancelled) slots are skipped. Returns an empty Vec when
    /// `offset >= count` or `limit == 0`.
    pub fn get_subscriber_page(env: Env, offset: u64, limit: u32) -> Vec<Address> {
        let count = subscription_count::get_subscriber_index_size(&env);
        let cap: u32 = if limit > 50 { 50 } else { limit };
        let mut result = Vec::new(&env);
        if offset >= count || cap == 0 {
            return result;
        }
        let mut i = offset;
        let end = offset + cap as u64;
        while i < end && i < count {
            if !subscription_count::is_subscriber_index_removed(&env, i) {
                if let Some(addr) = env.storage().persistent().get(&DataKey::SubscriberIndex(i)) {
                    result.push_back(addr);
                }
            }
            i += 1;
        }
        result
    }

    /// Returns a list of subscriber addresses that are currently due for charging.
    /// Reads from the `SubscriberIndex` starting from `offset` up to `offset + limit`.
    /// Capped at 50 per call. Optionally filters out grace-lapsed subscriptions when
    /// `exclude_lapsed` is `Some(true)` or `None`.
    pub fn get_next_charge_batch(
        env: Env,
        offset: u64,
        limit: u32,
        exclude_lapsed: Option<bool>,
    ) -> Vec<Address> {
        if limit > 50 {
            env.panic_with_error(ContractError::BatchTooLarge);
        }
        let size = subscription_count::get_subscriber_index_size(&env);
        let mut result = Vec::new(&env);
        if offset >= size || limit == 0 {
            return result;
        }
        let exclude = exclude_lapsed.unwrap_or(true);
        let mut i = offset;
        let end = (offset + limit as u64).min(size);
        while i < end {
            if !subscription_count::is_subscriber_index_removed(&env, i) {
                if let Some(addr) = env.storage().persistent().get::<DataKey, Address>(&DataKey::SubscriberIndex(i)) {
                    if let Some(sub) = storage::get_subscription(&env, &addr) {
                        if let Some(next) = charge_exec::compute_next_charge_at(&sub) {
                            let now = env.ledger().timestamp();
                            if now >= next {
                                let grace = grace::get_grace_period(&env);
                                let lapsed = grace > 0 && now > next + grace;
                                if !exclude || !lapsed {
                                    result.push_back(addr);
                                }
                            }
                        }
                    }
                }
            }
            i += 1;
        }
        result
    }

    /// Extends the TTL of all subscriber index entries to prevent archival.
    ///
    /// Iterates `SubscriberIndex(0..size)` and calls `extend_ttl` on each,
    /// along with `SubscriberIndexSize`, `SubscriberIndexSlot`, and
    /// `SubscriberIndexRemoved` entries. Bumps TTL to `SUBSCRIPTION_TTL_LEDGERS`.
    ///
    /// # Auth
    ///
    /// Requires authorization from the contract admin.
    ///
    /// # Side Effects
    ///
    /// Extends the TTL of every persistent subscriber index entry and emits
    /// a `subscriber_index_ttl_extended` event with the total count.
    pub fn extend_subscriber_index_ttl(env: Env) {
        admin::require_admin(&env);

        let size = subscription_count::get_subscriber_index_size(&env);

        if size == 0 {
            return;
        }

        // Extend the size counter itself
        env.storage().persistent().extend_ttl(
            &DataKey::SubscriberIndexSize,
            SUBSCRIPTION_TTL_LEDGERS,
            SUBSCRIPTION_TTL_LEDGERS,
        );

        let mut count: u64 = 0;
        let mut i: u64 = 0;
        while i < size {
            let key = DataKey::SubscriberIndex(i);
            env.storage().persistent().extend_ttl(
                &key,
                SUBSCRIPTION_TTL_LEDGERS,
                SUBSCRIPTION_TTL_LEDGERS,
            );
            count += 1;
            i += 1;
        }

        events::publish_subscriber_index_ttl_extended(&env, count);
    }

    /// Admin-only repair: tombstones a single stale subscriber index slot.
    ///
    /// Looks up the occupant of `index`, refuses if that subscriber currently
    /// has an active subscription, then marks the slot removed so keepers skip
    /// it. This does **not** garbage-collect the rest of the index.
    ///
    /// # Auth
    ///
    /// Requires authorization from the contract admin.
    ///
    /// # Errors
    ///
    /// Panics with `NoSubscriptionFound` if `index` is out of range, empty, or
    /// already tombstoned. Panics with `CannotClearActiveSubscriber` if the
    /// occupant still has an active subscription.
    ///
    /// # Side Effects
    ///
    /// Writes `SubscriberIndexRemoved(index)`, drops the reverse slot lookup
    /// when it points at this index, and emits `subscriber_index_cleared`.
    pub fn clear_subscriber_index_entry(env: Env, index: u64) {
        admin::require_admin(&env);
        let user = subscription_count::clear_subscriber_index_entry(&env, index);
        events::publish_subscriber_index_cleared(&env, &user, index);
    }

    // ─────────────────────────────────────────────────────────────
    // Merchant revenue
    // ─────────────────────────────────────────────────────────────

    /// Returns the total amount charged to a merchant's subscribers
    /// (sum of all successful `charge()` and `pay_per_use()` calls).
    pub fn get_merchant_revenue(env: Env, merchant: Address) -> i128 {
        merchant_stats::get_merchant_revenue(&env, &merchant)
    }

    /// Returns per-charge revenue entries for the merchant (up to `days` most recent).
    /// Oldest -> newest. Returns an empty Vec when no history has been recorded or after clearing.
    pub fn get_merchant_revenue_history(env: Env, merchant: Address, days: u32) -> Vec<i128> {
        merchant_stats::get_merchant_revenue_history(&env, &merchant, days)
    }

    /// Returns aggregate revenue statistics for a merchant: (total, count, min_charge, max_charge).
    pub fn get_merchant_revenue_summary(env: Env, merchant: Address) -> (i128, i128, i128, i128) {
        merchant_stats::get_merchant_revenue_summary(&env, &merchant)
    }

    /// Returns a composite health report for a user's subscription.
    pub fn get_subscription_health(env: Env, user: Address) -> SubscriptionHealth {
        let sub = match storage::get_subscription(&env, &user) {
            Some(s) => s,
            None => {
                return SubscriptionHealth {
                    active: false,
                    charge_due: false,
                    within_grace: false,
                    has_sufficient_allowance: false,
                    is_paused: false,
                    trial_active: false,
                    daily_limit_set: false,
                }
            }
        };

        let active = sub.active;
        let is_paused = sub.paused;
        let charge_due = Self::is_charge_due(env.clone(), user.clone());

        let next_charge = charge_exec::compute_next_charge_at(&sub);
        let now = env.ledger().timestamp();
        let grace = grace::get_grace_period(&env);

        let within_grace = if let Some(next) = next_charge {
            now >= next && grace > 0 && now <= next + grace
        } else {
            false
        };

        let has_sufficient_allowance =
            validation::has_sufficient_allowance(&env, &user, &sub.token, sub.amount);

        let trial_active = trial::get_trial_end(env.clone(), user.clone()).is_some();
        let daily_limit_set = spending_limit::get_daily_limit(&env, &user).is_some();

        SubscriptionHealth {
            active,
            charge_due,
            within_grace,
            has_sufficient_allowance,
            is_paused,
            trial_active,
            daily_limit_set,
        }
    }

    /// Clears the merchant's revenue history Vec from persistent storage.
    /// Only the contract admin can call this. Idempotent — safe to call when no history exists.
    /// Does not affect the cumulative revenue total.
    pub fn clear_merchant_revenue_history(env: Env, merchant: Address) {
        admin::require_admin(&env);
        merchant_stats::clear_revenue_history(&env, &merchant);
        events::publish_merchant_history_cleared(&env, &merchant);
    }

    /// Returns the number of active subscribers for a given merchant.
    pub fn get_merchant_subscriber_count(env: Env, merchant: Address) -> u64 {
        merchant_stats::get_merchant_subscriber_count(&env, &merchant)
    }

    /// Returns the number of active subscribers for a given merchant (as u32).
    pub fn get_merchant_sub_count(env: Env, merchant: Address) -> u32 {
        subscription_count::get_merchant_sub_count(&env, &merchant)
    }

    /// Returns active subscriber counts for multiple merchants in a single call.
    /// Capped at 50 merchants; panics with `BatchTooLarge` above that.
    /// Returns `(addr, 0)` for merchants with no recorded count.
    /// No auth required.
    pub fn get_merchant_sub_counts(env: Env, merchants: Vec<Address>) -> Vec<(Address, u32)> {
        merchant_stats::get_merchant_sub_counts(&env, &merchants)
    }

    /// Resets a merchant's cumulative revenue counter to zero.
    /// Only the contract admin can call this.
    pub fn reset_merchant_revenue(env: Env, merchant: Address) {
        admin::require_admin(&env);
        merchant_stats::reset_merchant_revenue(&env, &merchant);
    }

    /// Withdraws the merchant's accrued revenue from the contract balance
    /// to their address.
    ///
    /// # Parameters
    ///
    /// - `merchant`: The merchant address. Must authorize the call.
    ///
    /// # Returns
    ///
    /// Returns nothing.
    ///
    /// # Auth
    ///
    /// Requires authorization from `merchant`.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, the global token is not configured,
    /// or the tracked accrued balance is zero or negative
    /// (`ContractError::ZeroBalanceAvailable`).
    ///
    /// # Side Effects
    ///
    /// Resets the `MerchantRevenue` counter to zero before transferring
    /// (reentrancy safety), then transfers tokens from the contract account
    /// to `merchant` and emits `merchant_withdrawal`.
    pub fn withdraw_merchant_revenue(env: Env, merchant: Address) {
        ensure_contract_not_paused(&env);
        merchant.require_auth();

        let token_addr = storage::get_token(&env)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NotInitialized));

        let amount = merchant_stats::get_merchant_revenue(&env, &merchant);
        if amount <= 0 {
            env.panic_with_error(ContractError::ZeroBalanceAvailable);
        }

        // Reset before transfer to guard against reentrancy.
        merchant_stats::reset_merchant_revenue(&env, &merchant);

        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &merchant, &amount);

        events::publish_merchant_withdrawal(&env, &merchant, amount);
    }

    // ─────────────────────────────────────────────────────────────
    // Daily spending limits
    // ─────────────────────────────────────────────────────────────

    /// Sets a daily spending cap for `pay_per_use()` for the calling user.
    /// Stored in temporary storage; resets automatically after ~1 day.
    pub fn set_daily_limit(env: Env, user: Address, limit: i128) {
        user.require_auth();
        if limit <= 0 {
            env.panic_with_error(ContractError::AmountMustBePositive);
        }
        spending_limit::set_daily_limit(&env, &user, limit);
        events::publish_daily_limit_set(&env, &user, limit);
    }

    /// Returns the daily spending limit for a user, or `None` if not set.
    /// Removes the caller's daily spending cap for `pay_per_use()`.
    pub fn remove_daily_limit(env: Env, user: Address) {
        user.require_auth();
        spending_limit::remove_daily_limit(&env, &user);
        events::publish_daily_limit_removed(&env, &user);
    }

    /// Returns the current daily spending limit for the caller, or `None` if unset.
    pub fn get_daily_limit(env: Env, user: Address) -> Option<i128> {
        spending_limit::get_daily_limit(&env, &user)
    }

    // ─────────────────────────────────────────────────────────────
    /// Returns the amount spent so far today via `pay_per_use()` for the caller.
    pub fn get_daily_spent(env: Env, user: Address) -> i128 {
        spending_limit::get_daily_spent(&env, &user)
    }

    /// Returns a consistent snapshot of a user's daily spending window.
    /// `remaining` is `None` when no limit is configured and is clamped to
    /// zero when spending has reached or exceeded the configured limit.
    pub fn get_daily_limit_status(env: Env, user: Address) -> DailyLimitStatus {
        spending_limit::get_daily_limit_status(&env, &user)
    }

    // ─────────────────────────────────────────────
    // Referral tracking
    // ─────────────────────────────────────────────────────────────

    /// Returns the referrer address for a given subscriber, or `None`.
    pub fn get_referral(env: Env, user: Address) -> Option<Address> {
        referral::get_referrer(&env, &user)
    }

    /// Returns the referrer address for a given subscriber, or `None`.
    pub fn get_referrer(env: Env, user: Address) -> Option<Address> {
        referral::get_referrer(&env, &user)
    }

    // ─────────────────────────────────────────────────────────────
    // State migration
    // ─────────────────────────────────────────────────────────────

    /// Migrates contract storage to the latest schema version.
    /// Safe to call multiple times — subsequent calls are no-ops.
    pub fn migrate(env: Env, users: Vec<Address>) {
        migration::migrate(&env, users);
    }

    /// Returns the current storage schema version.
    pub fn get_schema_version(env: Env) -> u32 {
        migration::get_schema_version(&env)
    }

    // ─────────────────────────────────────────────────────────────
    // Subscription metadata
    // ─────────────────────────────────────────────────────────────

    /// Attaches a short label (e.g. plan name) to the caller's subscription.
    pub fn set_metadata(env: Env, user: Address, label: String) {
        user.require_auth();
        if let Err(err) = subscription_metadata::set_metadata(&env, &user, label) {
            env.panic_with_error(err);
        }
    }

    /// Returns the metadata label for a subscriber, or `None` if not set.
    pub fn get_metadata(env: Env, user: Address) -> Option<String> {
        subscription_metadata::get_metadata(&env, &user)
    }

    /// Alias for `get_metadata` — returns the metadata label for a subscriber, or `None` if not set.
    pub fn get_subscription_label(env: Env, user: Address) -> Option<String> {
        subscription_metadata::get_metadata(&env, &user)
    }

    /// Clears the metadata label for the caller's subscription.
    pub fn clear_metadata(env: Env, user: Address) {
        user.require_auth();
        subscription_metadata::clear_metadata(&env, &user);
    }

    // ─────────────────────────────────────────────────────────────
    // Charge history
    // ─────────────────────────────────────────────────────────────

    /// Returns the last (up to 12) charge timestamps for a subscriber,
    /// ordered oldest → newest.
    pub fn get_charge_history(env: Env, user: Address) -> Vec<u64> {
        subscription_history::get_charge_history(&env, &user)
    }

    /// Returns the count of stored charge timestamps for a subscriber.
    pub fn get_charge_history_count(env: Env, user: Address) -> u32 {
        subscription_history::get_charge_history_count(&env, &user)
    }

    // ─────────────────────────────────────────────────────────────
    // Protocol stats
    // ─────────────────────────────────────────────────────────────

    /// Returns a snapshot of all protocol-level state in a single call.
    pub fn get_protocol_stats(env: Env) -> ProtocolStats {
        ProtocolStats {
            active_count: subscription_count::get_active_count(&env),
            fee_bps: fee::get_fee_bps(&env),
            fee_collector: fee::get_fee_collector(&env),
            grace_period: grace::get_grace_period(&env),
            whitelist_enabled: whitelist::is_whitelist_enabled(&env),
            schema_version: migration::get_schema_version(&env),
            contract_paused: env
                .storage()
                .instance()
                .get(&DataKey::ContractPaused)
                .unwrap_or(false),
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Contract pause
    // ─────────────────────────────────────────────────────────────

    /// Pauses the contract. Only the admin can call this.
    pub fn pause_contract(env: Env) {
        admin::require_admin(&env);
        storage::set_contract_paused(&env, true);
        events::publish_contract_paused(&env);
    }

    /// Unpauses the contract. Only the admin can call this.
    pub fn unpause_contract(env: Env) {
        admin::require_admin(&env);
        storage::set_contract_paused(&env, false);
        events::publish_contract_unpaused(&env);
    }

    // Admin setup
    // ─────────────────────────────────────────────────────────────

    /// Bootstrap-only entrypoint that writes the contract admin when no admin
    /// is configured. This is a narrower alternative to [`Self::initialize`]:
    ///
    /// - **`initialize(token, admin)`** atomically sets the default token *and*
    ///   the admin together. Use this for standard deployments via
    ///   `scripts/deploy-pipeline.ts` — it is the canonical full-init path.
    /// - **`set_initial_admin(admin)`** sets only the admin slot. It is
    ///   intended for partial-recovery or segmented-deploy scenarios where the
    ///   token is written separately (or not at all), and admin-only governance
    ///   is needed before full initialization.
    ///
    /// In both cases the proposed admin must sign the call via
    /// `require_auth()`, and a second call on an already-configured contract
    /// fails with a typed `ContractError::AdminAlreadySet` (code 42) so
    /// deploy scripts can detect the condition without string-parsing panics.
    pub fn set_initial_admin(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            env.panic_with_error(ContractError::AdminAlreadySet);
        }
        storage::set_admin(&env, &admin);
    }

    // ─────────────────────────────────────────────────────────────
    // Health check
    // ─────────────────────────────────────────────────────────────

    /// Returns a snapshot of contract health. Safe to call at any time — no auth required, no storage writes.
    pub fn contract_health_check(env: Env) -> HealthReport {
        let contract_paused = storage::is_contract_paused(&env);
        let token_configured = storage::get_token(&env).is_some();
        let admin_configured = storage::get_admin_optional(&env).is_some();
        let fee_collector_set = fee::get_fee_collector(&env).is_some();

        #[cfg(any(test, feature = "testutils"))]
        let instance_ttl_ledgers = {
            use soroban_sdk::testutils::storage::Instance as _;
            env.storage().instance().get_ttl()
        };
        #[cfg(not(any(test, feature = "testutils")))]
        let instance_ttl_ledgers = 100_000; // at least 1 day of TTL remaining, used as default since get_ttl is not available on-chain

        let active_subscription_count = subscription_count::get_active_count(&env);
        let schema_version = migration::get_schema_version(&env);

        let window: Option<GlobalVolumeWindow> =
            env.storage().instance().get(&DataKey::GlobalVolumeWindow);
        let accumulated_volume = window.map(|w| w.accumulated_volume).unwrap_or(0);
        let cap = env
            .storage()
            .instance()
            .get(&DataKey::GlobalVolumeCapOverride)
            .unwrap_or(GLOBAL_MAX_VOLUME_PER_HOUR);

        let pct = if cap > 0 {
            ((accumulated_volume * 100) / cap) as u32
        } else {
            0
        };
        let global_volume_utilization_pct = if pct > 100 { 100 } else { pct };

        let total_merchants = merchant_stats::get_merchant_index_size(&env);
        let mut pending_merchant_rev_count = 0;
        for i in 0..total_merchants {
            if let Some(merchant) = env.storage().persistent().get(&DataKey::MerchantIndex(i)) {
                if merchant_stats::get_merchant_revenue(&env, &merchant) > 0 {
                    pending_merchant_rev_count += 1;
                }
            }
        }

        // Healthy when not paused, fully configured, and at least 1 day of TTL remaining (17_280 ledgers at ~5 s/ledger)
        let is_healthy = !contract_paused
            && token_configured
            && admin_configured
            && instance_ttl_ledgers > 17_280;

        HealthReport {
            is_healthy,
            contract_paused,
            token_configured,
            admin_configured,
            instance_ttl_ledgers,
            active_subscription_count,
            schema_version,
            fee_collector_set,
            global_volume_utilization_pct,
            pending_merchant_rev_count,
        }
    }

    /// Clears the charge history for a subscriber.
    /// Only the contract admin can call this.
    pub fn clear_charge_history(env: Env, user: Address) {
        admin::require_admin(&env);
        subscription_history::clear_charge_history(&env, &user);
    }

    /// Admin-only: removes the ChargeHistory entry for `user` entirely.
    pub fn prune_charge_history(env: Env, user: Address) {
        admin::require_admin(&env);
        subscription_history::prune_charge_history(&env, &user);
    }

    /// Returns the current TTL (in ledgers) of the ChargeHistory entry, or 0 if absent.
    pub fn get_charge_history_ttl(env: Env, user: Address) -> u32 {
        subscription_history::get_charge_history_ttl(&env, &user)
    }

    /// Returns a paginated slice of charge timestamps for a subscriber.
    /// limit is capped at 12. If `ascending` is false, records are returned in descending order (newest first).
    pub fn get_charge_history_page(
        env: Env,
        user: Address,
        offset: u32,
        limit: u32,
        ascending: bool,
    ) -> Vec<u64> {
        subscription_history::get_charge_history_page(&env, &user, offset, limit, ascending)
    }

    /// Transfers subscription ownership from `user` to `new_user`.
    ///
    /// # Auth
    ///
    /// Requires authorization from `user`.
    ///
    /// # Errors
    ///
    /// Panics if the contract is paused, no active subscription exists for
    /// `user`, or `new_user` already holds an active subscription.
    ///
    /// # Side Effects
    ///
    /// Moves the subscription struct to `new_user`, removes it from `user`,
    /// refreshes TTL, and emits `sub_transferred` and `subscription_transferred`.
    pub fn transfer_subscription(env: Env, user: Address, new_user: Address) {
        ensure_contract_not_paused(&env);
        user.require_auth();
        new_user.require_auth();

        let old_key = DataKey::Subscription(user.clone());
        let new_key = DataKey::Subscription(new_user.clone());

        let sub: Subscription = env
            .storage()
            .persistent()
            .get(&old_key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        if !sub.active {
            env.panic_with_error(ContractError::NoSubscriptionFound);
        }

        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, Subscription>(&new_key)
        {
            if existing.active {
                env.panic_with_error(ContractError::SubscriptionAlreadyActive);
            }
        }

        env.storage().persistent().set(&new_key, &sub);
        env.storage().persistent().remove(&old_key);

        subscription_count::transfer_subscriber_index(&env, &user, &new_user);
        extend_subscription_ttl(&env, &new_user);

        events::publish_subscription_transferred(&env, &user, &new_user);
        events::emit_subscription_transferred(&env, &user, &new_user, &sub);
    }

    // ─────────────────────────────────────────────────────────────
    // Configurable global hourly volume cap
    // ─────────────────────────────────────────────────────────────

    /// Returns the currently effective global hourly volume cap (stroops).
    /// Falls back to the compile-time `GLOBAL_MAX_VOLUME_PER_HOUR` default
    /// when no operator override has been configured.
    pub fn get_global_volume_cap(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::GlobalVolumeCapOverride)
            .unwrap_or(GLOBAL_MAX_VOLUME_PER_HOUR)
    }

    /// Returns the current global volume window as `(accumulated_volume, window_start_timestamp)`.
    /// Returns `(0, 0)` if no window has been started yet.
    /// No auth required.
    pub fn get_global_volume_window(env: Env) -> (i128, u64) {
        let window: Option<GlobalVolumeWindow> =
            env.storage().instance().get(&DataKey::GlobalVolumeWindow);
        match window {
            Some(w) => (w.accumulated_volume, w.current_window_start),
            None => (0, 0),
        }
    }

    /// Admin-only: overrides the global hourly volume cap without requiring
    /// a contract upgrade. `new_cap` must be strictly positive.
    pub fn set_global_volume_cap(env: Env, new_cap: i128) {
        admin::require_admin(&env);
        if new_cap <= 0 {
            env.panic_with_error(ContractError::InvalidVolumeCap);
        }
        env.storage()
            .instance()
            .set(&DataKey::GlobalVolumeCapOverride, &new_cap);
    }

    // ─────────────────────────────────────────────────────────────
    // Configurable fee bounds (governance guardrails)
    // ─────────────────────────────────────────────────────────────

    /// Admin-only: configures the allowed [min_bps, max_bps] range for
    /// future fee proposals, guarding against accidental fee misconfiguration
    /// (e.g. an operator typo setting bps close to 10000).
    pub fn set_fee_bounds(env: Env, min_bps: u32, max_bps: u32) {
        admin::require_admin(&env);
        if min_bps > max_bps || max_bps > 10_000 {
            env.panic_with_error(ContractError::InvalidFeeBounds);
        }
        env.storage().instance().set(&DataKey::MinFeeBps, &min_bps);
        env.storage().instance().set(&DataKey::MaxFeeBps, &max_bps);
    }

    /// Returns the configured (min_bps, max_bps) fee bounds, defaulting to
    /// (0, 10000) when governance has not configured explicit bounds.
    pub fn get_fee_bounds(env: Env) -> (u32, u32) {
        let min_bps = env
            .storage()
            .instance()
            .get(&DataKey::MinFeeBps)
            .unwrap_or(0u32);
        let max_bps = env
            .storage()
            .instance()
            .get(&DataKey::MaxFeeBps)
            .unwrap_or(10_000u32);
        (min_bps, max_bps)
    }

    // ─────────────────────────────────────────────────────────────
    // Lightweight subscription reads
    // ─────────────────────────────────────────────────────────────

    /// Returns the token address for a user's subscription without decoding
    /// the full `Subscription` struct.
    ///
    /// Returns `Some(token)` when any subscription record exists for `user`
    /// (including inactive/cancelled ones), and `None` when the user has never
    /// subscribed.
    ///
    /// No auth required (view-only).
    pub fn get_subscription_token(env: Env, user: Address) -> Option<Address> {
        let sub: Subscription = env.storage().persistent().get(&DataKey::Subscription(user))?;
        Some(sub.token)
    }

    /// Returns just the merchant address for a user's subscription, without
    /// decoding the full `Subscription` struct. Lighter-weight than
    /// `get_subscription` for callers that only need to know which merchant
    /// a user subscribes to.
    pub fn get_subscriber_merchant(env: Env, user: Address) -> Option<Address> {
        let sub: Subscription = env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(user))?;
        Some(sub.merchant)
    }

    /// Returns a page of subscriber addresses starting at `offset`, capped
    /// at 50 per call, filtered to only those whose subscription is
    /// currently active. Avoids forcing callers to over-fetch via
    /// `get_subscriber_page` and filter client-side.
    pub fn get_active_subscriber_page(env: Env, offset: u64, limit: u32) -> Vec<Address> {
        let count = subscription_count::get_subscriber_index_size(&env);
        let cap: u32 = if limit > 50 { 50 } else { limit };
        let mut result = Vec::new(&env);
        if offset >= count || cap == 0 {
            return result;
        }
        let mut i = offset;
        while i < count && result.len() < cap {
            if let Some(addr) = env
                .storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::SubscriberIndex(i))
            {
                if let Some(sub) = env
                    .storage()
                    .persistent()
                    .get::<DataKey, Subscription>(&DataKey::Subscription(addr.clone()))
                {
                    if sub.active {
                        result.push_back(addr);
                    }
                }
            }
            i += 1;
        }
        result
    }
}

#[contractimpl]
#[cfg(test)]
impl FlowPay {
    /// Upgrades the current contract WASM to `new_wasm_hash` (test only).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        upgrade::upgrade(&env, new_wasm_hash);
    }
}

/// Refreshes the contract instance's TTL. Instance storage holds shared
/// protocol state (Admin, Token, FeeCollector, FeeBps, GracePeriod,
/// WhitelistEnabled, SchemaVersion, ActiveCount, ...) which all share one
/// TTL — if it lapses from prolonged inactivity, the contract is bricked.
/// Called at the start of every state-mutating public function so any
/// active use continuously keeps the instance alive without a keeper.
fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(SUBSCRIPTION_TTL_LEDGERS / 2, SUBSCRIPTION_TTL_LEDGERS);
}

fn extend_subscription_ttl(env: &Env, user: &Address) {
    storage::extend_subscription_ttl(env, user);
    env.storage()
        .instance()
        .extend_ttl(SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
}

/// Shared implementation for `pay_per_use` and `pay_per_use_to`. `recipient`
/// is `None` for `pay_per_use` (defaults to `sub.merchant`, matching its
/// existing behavior exactly) and `Some(addr)` for `pay_per_use_to`.
fn pay_per_use_inner(env: &Env, user: Address, amount: i128, recipient: Option<Address>) {
    ensure_contract_not_paused(env);
    user.require_auth();

    if amount <= 0 {
        env.panic_with_error(ContractError::AmountMustBePositive);
    }
    if amount > MAX_AMOUNT {
        env.panic_with_error(ContractError::AmountExceedsMaximum);
    }

    let key = DataKey::Subscription(user.clone());

    let sub: Subscription = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

    if sub.paused {
        env.panic_with_error(ContractError::SubscriptionPaused);
    }
    if !sub.active {
        env.panic_with_error(ContractError::SubscriptionInactive);
    }

    // Only the explicit `pay_per_use_to` path re-validates the whitelist;
    // `pay_per_use` (recipient == None) keeps its existing behavior of not
    // re-checking a merchant that was already whitelisted at subscribe time.
    let is_pay_per_use_to = recipient.is_some();
    let recipient = recipient.unwrap_or_else(|| sub.merchant.clone());

    if is_pay_per_use_to {
        if recipient == env.current_contract_address() {
            env.panic_with_error(ContractError::InvalidRecipient);
        }
        if whitelist::is_whitelist_enabled(env) && !whitelist::is_whitelisted(env, &recipient) {
            env.panic_with_error(ContractError::MerchantNotWhitelisted);
        }
    }

    spending_limit::enforce_limit(env, &user, amount);

    let fee_amount = fee::transfer_pay_per_use(env, &user, &sub.token, amount, &recipient);
    let net_amount = amount - fee_amount;

    check_and_update_global_volume(env, amount);
    merchant_stats::increment_revenue_with_daily(env, &recipient, net_amount);
    spending_limit::record_spend(env, &user, amount);
    extend_subscription_ttl(env, &user);

    events::publish_pay_per_use(env, &user, &recipient, amount);
}

fn subscribe_inner(
    env: &Env,
    user: Address,
    merchant: Address,
    amount: i128,
    interval: u64,
    token: Address,
    trial_period: Option<u64>,
    referrer: Option<Address>,
) {
    bump_instance_ttl(env);
    user.require_auth();

    if whitelist::is_whitelist_enabled(env) && !whitelist::is_whitelisted(env, &merchant) {
        env.panic_with_error(ContractError::MerchantNotWhitelisted);
    }

    if whitelist::is_frozen(env, &merchant) {
        env.panic_with_error(ContractError::MerchantFrozen);
    }

    // Prevent new subscriptions when contract is paused
    let paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::ContractPaused)
        .unwrap_or(false);
    if paused {
        env.panic_with_error(ContractError::ContractPausedError);
    }

    validation::require_valid_amount(env, amount);
    validation::validate_interval(env, interval);

    use soroban_sdk::xdr::ToXdr;
    if token.clone().to_xdr(env).get(7) == Some(0) {
        env.panic_with_error(ContractError::InvalidTokenAddress);
    }

    validation::check_allowance(env, &user, &token, amount);

    let now = env.ledger().timestamp();
    let trial_duration = trial_period.unwrap_or(0);
    let last_charged = now + trial_duration;

    let existing = storage::get_subscription(env, &user);
    let should_increment = existing.as_ref().is_none_or(|s| !s.active);

    if let Some(ref existing_sub) = existing {
        if existing_sub.active && existing_sub.merchant != merchant {
            merchant_stats::decrement_subscriber_count(env, &existing_sub.merchant);
        }
    }

    let sub = Subscription {
        merchant,
        amount,
        interval,
        last_charged,
        active: true,
        paused: false,
        token,
        referrer: referrer.clone(),
        label: Symbol::new(env, ""),
        trial_duration,
        created_at: env.ledger().timestamp(),
    };

    env.storage()
        .persistent()
        .set(&DataKey::Subscription(user.clone()), &sub);

    extend_subscription_ttl(env, &user);

    if should_increment {
        subscription_count::increment(env);
        subscription_count::append_subscriber_index(env, &user);
    }
    referral::store_referral(env, &user, &referrer);
    merchant_stats::increment_subscriber_count(env, &sub.merchant);
    events::publish_subscribed(env, &user, &sub);
}

pub(crate) fn check_and_update_global_volume(env: &Env, amount: i128) {
    let now = env.ledger().timestamp();
    let mut window: GlobalVolumeWindow = env
        .storage()
        .instance()
        .get(&DataKey::GlobalVolumeWindow)
        .unwrap_or(GlobalVolumeWindow {
            current_window_start: now,
            accumulated_volume: 0,
        });

    // Checked: a window start near u64::MAX must not wrap the rollover test
    // into an accidental (or permanently suppressed) window reset.
    let window_end = window
        .current_window_start
        .checked_add(HOUR_IN_SECONDS)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));

    if now >= window_end {
        window.current_window_start = now;
        window.accumulated_volume = 0;
    }

    // Overflow and cap breach are distinct failure modes: an accumulator that
    // cannot represent the sum is a typed `ArithmeticOverflow`, not a policy
    // rejection, so clients can tell "the protocol is at its hourly cap" from
    // "this amount is not representable".
    let new_volume = window
        .accumulated_volume
        .checked_add(amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::ArithmeticOverflow));

    if new_volume > GLOBAL_MAX_VOLUME_PER_HOUR {
        env.panic_with_error(ContractError::GlobalVolumeExceeded);
    }

    window.accumulated_volume = new_volume;
    env.storage()
        .instance()
        .set(&DataKey::GlobalVolumeWindow, &window);
}

fn is_contract_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ContractPaused)
        .unwrap_or(false)
}

fn ensure_contract_not_paused(env: &Env) {
    if is_contract_paused(env) {
        env.panic_with_error(ContractError::ContractPaused);
    }
}
