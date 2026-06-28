#![no_std]

mod admin;
mod batch;
#[cfg(test)]
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
    // Merchant freeze: blocks new subscriptions, independent of whitelist status
    MerchantFrozen(Address),
    // Protocol fee
    FeeCollector,
    FeeBps,
    // Feature: subscription count
    ActiveCount,
    // Feature: merchant revenue stats
    MerchantRevenue(Address),
    // Per-day merchant revenue buckets (keyed by Unix day)
    MerchantRevenueDay(Address, u64),
    // Feature: daily spending limits (temporary storage)
    DailyLimit(Address),
    DailySpent(Address),
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
    // Feature: contract pause
    ContractPaused,
    // Feature: minimum subscription interval floor
    MinInterval,
    // Feature: consolidated merchant revenue history (Vec<i128>)
    MerchantRevenueHistory(Address),
    // Feature: subscriber index (append-only log)
    SubscriberIndex(u64),
    SubscriberIndexSize,
    // Feature: per-merchant subscriber count
    MerchantSubCount(Address),
    // Pending admin for two-step transfer
    PendingAdmin,
    // Two-step auth for protocol fee
    PendingFee,
    // Two-step auth for grace period
    PendingGracePeriod,
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

pub const SUBSCRIPTION_TTL_LEDGERS: u32 = 6307200; // ~1 year (assuming 5s blocks)
pub const MAX_BATCH_PAUSE_SUBSCRIPTIONS: u32 = 25;
pub const GLOBAL_MAX_VOLUME_PER_HOUR: i128 = 50_000_000_000_000; // 50 trillion stroops
pub const HOUR_IN_SECONDS: u64 = 3600;
pub const MAX_AMOUNT: i128 = 100_000_000_000;
pub const MAX_SUBSCRIPTION_AMOUNT: i128 = 1_000_000_0000000;

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
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct HealthReport {
    pub is_healthy: bool,
    pub contract_paused: bool,
    pub token_configured: bool,
    pub admin_configured: bool,
    pub instance_ttl_ledgers: u32,
    pub active_subscription_count: u64,
    pub schema_version: u32,
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

// ─────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────

#[contract]
pub struct FlowPay;

#[contractimpl]
impl FlowPay {
    pub fn initialize(env: Env, token: Address, admin: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            env.panic_with_error(ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Token, &token);
        admin::initialize_admin(&env, &admin);
        env.storage().instance().extend_ttl(50_000, 100_000);
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
        subscribe_inner(&env, user, merchant, amount, interval, token, trial_period, referrer);
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
        subscribe_inner(&env, user.clone(), merchant, amount, interval, token, trial_period, referrer);
        subscription_metadata::set_metadata(&env, &user, label);
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
        ensure_contract_not_paused(&env);
        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        if !sub.active {
            env.panic_with_error(ContractError::SubscriptionNotActive);
        }
        if sub.paused {
            env.panic_with_error(ContractError::SubscriptionPaused);
        }

        let now = env.ledger().timestamp();

        let next = charge_exec::compute_next_charge_at(&sub)
            .unwrap_or_else(|| env.panic_with_error(ContractError::SubscriptionPaused));

        if now < next {
            env.panic_with_error(ContractError::IntervalNotElapsed);
        }

        let grace_period = grace::get_grace_period(&env);
        if grace_period > 0 && now > next + grace_period {
            env.panic_with_error(ContractError::GracePeriodElapsed);
        }

        check_and_update_global_volume(&env, sub.amount);
        charge_exec::execute_charge(&env, &user, &key, &mut sub, now);
    }

    pub fn extend_subscription_ttl(env: Env, user: Address) {
        extend_subscription_ttl(&env, &user);
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
        ensure_contract_not_paused(&env);
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

        if !sub.active {
            env.panic_with_error(ContractError::SubscriptionNotActive);
        }
        if sub.paused {
            env.panic_with_error(ContractError::SubscriptionPaused);
        }

        spending_limit::enforce_limit(&env, &user, amount);

        let token = token::Client::new(&env, &sub.token);

        let mut merchant_amount = amount;
        if let Some((collector, bps)) = fee::get_fee(&env) {
            let fee_amount = (amount * (bps as i128)) / 10_000;
            if fee_amount > 0 {
                token.transfer_from(
                    &env.current_contract_address(),
                    &user,
                    &collector,
                    &fee_amount,
                );
                merchant_amount = amount - fee_amount;
            }
        }

        token.transfer_from(
            &env.current_contract_address(),
            &user,
            &sub.merchant,
            &merchant_amount,
        );

        check_and_update_global_volume(&env, amount);
        merchant_stats::increment_revenue_with_daily(&env, &sub.merchant, merchant_amount);
        spending_limit::record_spend(&env, &user, amount);

        events::publish_pay_per_use(&env, &user, &sub.merchant, amount);
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
        user.require_auth();

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no subscription found");

        sub.active = false;

        env.storage().persistent().set(&key, &sub);

        subscription_count::decrement(&env);
        merchant_stats::decrement_subscriber_count(&env, &sub.merchant);
        referral::remove_referral(&env, &user);
        events::publish_cancelled(&env, &user);
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
        user.require_auth();

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

        env.storage().persistent().set(&key, &sub);

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
        user.require_auth();

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        if !sub.active {
            env.panic_with_error(ContractError::SubscriptionNotActive);
        }

        sub.paused = false;

        env.storage().persistent().set(&key, &sub);

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
            env.panic_with_error(ContractError::BatchSizeExceeded);
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

    /// Upgrades the current contract WASM to `new_wasm_hash`.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        upgrade::upgrade(&env, new_wasm_hash);
    }

    pub fn get_subscription(env: Env, user: Address) -> Option<Subscription> {
        env.storage().persistent().get(&DataKey::Subscription(user))
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
        grace::propose_grace_period(&env, seconds);
    }

    /// Commits a pending contract-wide grace period proposal.
    /// Only the contract admin can call this.
    pub fn commit_grace_period(env: Env) {
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

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        validation::require_valid_amount(&env, new_amount);

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
        events::publish_min_interval_updated(&env, seconds);
    }

    /// Returns the minimum allowed subscription interval in seconds.
    /// Defaults to 3600 (1 hour) when unset.
    pub fn get_min_interval(env: Env) -> u64 {
        min_interval::get_min_interval(&env)
    }

    /// Adds a merchant to the whitelist.
    pub fn add_merchant(env: Env, merchant: Address) {
        admin::require_admin(&env);
        whitelist::add_merchant(&env, &merchant);
    }

    /// Removes a merchant from the whitelist.
    pub fn remove_merchant(env: Env, merchant: Address) {
        admin::require_admin(&env);
        whitelist::remove_merchant(&env, &merchant);
    }

    /// Enables or disables the merchant whitelist.
    pub fn set_whitelist_enabled(env: Env, enabled: bool) {
        admin::require_admin(&env);
        whitelist::set_whitelist_enabled(&env, enabled);
    }

    /// Returns whether the merchant whitelist is currently enabled.
    pub fn is_whitelist_enabled(env: Env) -> bool {
        whitelist::is_whitelist_enabled(&env)
    }

    /// Returns whether a merchant is whitelisted.
    pub fn is_merchant_whitelisted(env: Env, merchant: Address) -> bool {
        whitelist::is_whitelisted(&env, &merchant)
    }

    /// Freezes a merchant, blocking new subscriptions while leaving existing
    /// subscribers' charge and pay_per_use calls unaffected. Independent of
    /// whitelist status — idempotent.
    pub fn freeze_merchant(env: Env, merchant: Address) {
        admin::require_admin(&env);
        whitelist::freeze(&env, &merchant);
    }

    /// Unfreezes a merchant, allowing new subscriptions again. Idempotent.
    pub fn unfreeze_merchant(env: Env, merchant: Address) {
        admin::require_admin(&env);
        whitelist::unfreeze(&env, &merchant);
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

    /// Returns whether a merchant is currently frozen.
    pub fn is_merchant_frozen(env: Env, merchant: Address) -> bool {
        whitelist::is_frozen(&env, &merchant)
    }

    /// Returns the current protocol fee settings, or `None` if unset.
    pub fn get_fee(env: Env) -> Option<(Address, u32)> {
        fee::get_fee_collector(&env).map(|collector| (collector, fee::get_fee_bps(&env)))
    }

    /// Proposes new protocol fee collection settings.
    /// Only the contract admin can call this.
    pub fn propose_fee(env: Env, collector: Address, bps: u32) {
        fee::propose_fee(&env, collector, bps);
    }

    /// Commits pending protocol fee collection settings.
    /// Only the contract admin can call this.
    pub fn commit_fee(env: Env) {
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

    /// Returns the subscriber address at the given index slot, or `None` if out of range.
    pub fn get_subscriber_at(env: Env, index: u64) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::SubscriberIndex(index))
    }

    /// Returns a page of subscriber addresses starting at `offset`, capped at 50 per call.
    /// Returns an empty Vec when `offset >= count` or `limit == 0`.
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
            if let Some(addr) = env
                .storage()
                .persistent()
                .get(&DataKey::SubscriberIndex(i))
            {
                result.push_back(addr);
            }
            i += 1;
        }
        result
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

    // ─────────────────────────────────────────────
    // Referral tracking
    // ─────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────
    // Admin setup
    // ─────────────────────────────────────────────────────────────

    /// Sets the contract admin. Can only be called once; subsequent calls panic.
    pub fn set_initial_admin(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("admin already set");
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

        #[cfg(any(test, feature = "testutils"))]
        let instance_ttl_ledgers = {
            use soroban_sdk::testutils::storage::Instance as _;
            env.storage().instance().get_ttl()
        };
        #[cfg(not(any(test, feature = "testutils")))]
        let instance_ttl_ledgers = 100_000; // at least 1 day of TTL remaining, used as default since get_ttl is not available on-chain
        let active_subscription_count = subscription_count::get_active_count(&env);
        let schema_version = migration::get_schema_version(&env);

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
        }
    }

    /// Clears the charge history for a subscriber.
    /// Only the contract admin can call this.
    pub fn clear_charge_history(env: Env, user: Address) {
        admin::require_admin(&env);
        subscription_history::clear_charge_history(&env, &user);
    }

    /// Returns a paginated slice of charge timestamps for a subscriber.
    /// limit is capped at 12.
    pub fn get_charge_history_page(env: Env, user: Address, offset: u32, limit: u32) -> Vec<u64> {
        subscription_history::get_charge_history_page(&env, &user, offset, limit)
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
    /// refreshes TTL, and emits `sub_transferred`.
    pub fn transfer_subscription(env: Env, user: Address, new_user: Address) {
        ensure_contract_not_paused(&env);
        user.require_auth();

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

        extend_subscription_ttl(&env, &new_user);

        events::publish_subscription_transferred(&env, &user, &new_user);
    }
}

fn extend_subscription_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Subscription(user.clone()),
        SUBSCRIPTION_TTL_LEDGERS,
        SUBSCRIPTION_TTL_LEDGERS,
    );
    env.storage().instance().extend_ttl(SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
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
    user.require_auth();

    if whitelist::is_whitelist_enabled(env) {
        if !whitelist::is_whitelisted(env, &merchant) {
            env.panic_with_error(ContractError::MerchantNotWhitelisted);
        }
    }

    let paused = env
        .storage()
        .instance()
        .get::<_, bool>(&DataKey::ContractPaused)
        .unwrap_or(false);
    if paused {
        env.panic_with_error(ContractError::ContractPausedError);
    }

    if whitelist::is_frozen(env, &merchant) {
        env.panic_with_error(ContractError::MerchantFrozen);
    }

    validation::require_valid_amount(env, amount);
    if interval == 0 {
        env.panic_with_error(ContractError::IntervalMustBePositive);
    }

    use soroban_sdk::xdr::ToXdr;
    if token.clone().to_xdr(env).get(7) == Some(0) {
        env.panic_with_error(ContractError::InvalidTokenAddress);
    }

    validation::check_allowance(env, &user, &token, amount);
    if interval < 60 {
        env.panic_with_error(ContractError::IntervalTooShort);
    }

    if interval < min_interval::get_min_interval(env) {
        env.panic_with_error(ContractError::IntervalTooShort);
    }

    let token_client = token::Client::new(env, &token);
    let allowance = token_client.allowance(&user, &env.current_contract_address());
    if allowance < amount {
        env.panic_with_error(ContractError::InsufficientAllowance);
    }

    let now = env.ledger().timestamp();
    let trial_duration = trial_period.unwrap_or(0);
    let last_charged = now + trial_duration;

    let existing = storage::get_subscription(env, &user);
    let should_increment = existing.as_ref().map_or(true, |s| !s.active);

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

fn check_and_update_global_volume(env: &Env, amount: i128) {
    let now = env.ledger().timestamp();
    let mut window: GlobalVolumeWindow = env
        .storage()
        .instance()
        .get(&DataKey::GlobalVolumeWindow)
        .unwrap_or(GlobalVolumeWindow {
            current_window_start: now,
            accumulated_volume: 0,
        });

    if now >= window.current_window_start + HOUR_IN_SECONDS {
        window.current_window_start = now;
        window.accumulated_volume = 0;
    }

    let new_volume = window
        .accumulated_volume
        .checked_add(amount)
        .unwrap_or_else(|| env.panic_with_error(ContractError::GlobalVolumeExceeded));

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
