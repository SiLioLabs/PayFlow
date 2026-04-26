#![no_std]

mod admin;
mod batch;
mod errors;
mod events;
mod fee;
mod grace;
mod merchant_stats;
mod migration;
mod referral;
mod spending_limit;
mod storage;
mod subscription_count;
mod subscription_history;
mod subscription_metadata;
mod test;
mod trial;
mod validation;
mod whitelist;

use crate::errors::ContractError;
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Symbol, Vec};

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
    // Protocol fee
    FeeCollector,
    FeeBps,
    // Feature: subscription count
    ActiveCount,
    // Feature: merchant revenue stats
    MerchantRevenue(Address),
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
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

pub const SUBSCRIPTION_TTL_LEDGERS: u32 = 6307200; // ~1 year (assuming 5s blocks)

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
    pub paused: bool,
    pub token: Address,
}

// ─────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────

#[contract]
pub struct FlowPay;

#[contractimpl]
impl FlowPay {
    pub fn initialize(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Token, &token);
    }

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
        user.require_auth();

        if whitelist::is_whitelist_enabled(&env) {
            if !whitelist::is_whitelisted(&env, &merchant) {
                env.panic_with_error(ContractError::MerchantNotWhitelisted);
            }
        }

        assert!(amount > 0, "amount must be positive");
        assert!(interval > 0, "interval must be positive");

        let token_client = token::Client::new(&env, &token);
        let allowance = token_client.allowance(&user, &env.current_contract_address());
        assert!(allowance >= amount, "insufficient allowance");

        let now = env.ledger().timestamp();
        let last_charged = match trial_period {
            Some(period) => now + period,
            None => now,
        };

        let sub = Subscription {
            merchant,
            amount,
            interval,
            last_charged,
            active: true,
            paused: false,
            token,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Subscription(user.clone()), &sub);

        extend_subscription_ttl(&env, &user);

        subscription_count::increment(&env);
        referral::store_referral(&env, &user, &referrer);
        events::publish_subscribed(&env, &user, &sub);
    }

    pub fn charge(env: Env, user: Address) {
        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        assert!(sub.active, "subscription is not active");
        assert!(!sub.paused, "subscription is paused");

        let now = env.ledger().timestamp();

        if now < sub.last_charged + sub.interval {
            env.panic_with_error(ContractError::IntervalNotElapsed);
        }

        let grace_period = grace::get_grace_period(&env);
        if grace_period > 0 && now > sub.last_charged + sub.interval + grace_period {
            env.panic_with_error(ContractError::GracePeriodElapsed);
        }

        let token = token::Client::new(&env, &sub.token);

        token.transfer_from(
            &env.current_contract_address(),
            &user,
            &sub.merchant,
            &sub.amount,
        );

        merchant_stats::increment_revenue(&env, &sub.merchant, sub.amount);

        sub.last_charged = now;

        env.storage().persistent().set(&key, &sub);
        extend_subscription_ttl(&env, &user);

        subscription_history::record_charge(&env, &user, now);
        events::publish_charged(&env, &user, &sub, now);
    }

    pub fn extend_subscription_ttl(env: Env, user: Address) {
        extend_subscription_ttl(&env, &user);
    }

    pub fn pay_per_use(env: Env, user: Address, amount: i128) {
        user.require_auth();

        assert!(amount > 0, "amount must be positive");

        let key = DataKey::Subscription(user.clone());

        let sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        assert!(sub.active, "subscription is not active");
        assert!(!sub.paused, "subscription is paused");

        spending_limit::enforce_limit(&env, &user, amount);

        let token = token::Client::new(&env, &sub.token);

        token.transfer_from(
            &env.current_contract_address(),
            &user,
            &sub.merchant,
            &amount,
        );

        merchant_stats::increment_revenue(&env, &sub.merchant, amount);
        spending_limit::record_spend(&env, &user, amount);

        events::publish_pay_per_use(&env, &user, &sub.merchant, amount);
    }

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
        events::publish_cancelled(&env, &user);
    }

    pub fn pause(env: Env, user: Address) {
        user.require_auth();

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no subscription found");

        assert!(sub.active, "subscription is not active");

        sub.paused = true;

        env.storage().persistent().set(&key, &sub);

        env.events()
            .publish((Symbol::new(&env, "paused"), user), ());
    }

    pub fn resume(env: Env, user: Address) {
        user.require_auth();

        let key = DataKey::Subscription(user.clone());

        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no subscription found");

        assert!(sub.active, "subscription is not active");

        sub.paused = false;

        env.storage().persistent().set(&key, &sub);

        env.events()
            .publish((Symbol::new(&env, "resumed"), user), ());
    }

    pub fn get_subscription(env: Env, user: Address) -> Option<Subscription> {
        env.storage().persistent().get(&DataKey::Subscription(user))
    }

    /// Returns the Unix timestamp of the next scheduled charge for a user.
    ///
    /// Returns `None` if:
    /// - No subscription exists for the user
    /// - The subscription is inactive (cancelled)
    ///
    /// Returns `Some(last_charged + interval)` if the subscription is active.
    pub fn next_charge_at(env: Env, user: Address) -> Option<u64> {
        let sub = storage::get_subscription(&env, &user)?;
        if !sub.active {
            None
        } else {
            Some(sub.last_charged + sub.interval)
        }
    }

    /// Returns the trial end timestamp if the user is in a trial period.
    pub fn get_trial_end(env: Env, user: Address) -> Option<u64> {
        trial::get_trial_end(env, user)
    }

    /// Sets the contract-wide grace period for charges.
    /// Only the contract admin can call this.
    pub fn set_grace_period(env: Env, seconds: u64) {
        admin::require_admin(&env);
        grace::set_grace_period(&env, seconds);
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

    /// Sets the protocol fee collection settings.
    /// Only the contract admin can call this.
    pub fn set_fee(env: Env, collector: Address, bps: u32) {
        admin::require_admin(&env);
        fee::set_fee(&env, collector, bps);
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
    // Merchant revenue
    // ─────────────────────────────────────────────────────────────

    /// Returns the total amount charged to a merchant's subscribers
    /// (sum of all successful `charge()` and `pay_per_use()` calls).
    pub fn get_merchant_revenue(env: Env, merchant: Address) -> i128 {
        merchant_stats::get_merchant_revenue(&env, &merchant)
    }

    // ─────────────────────────────────────────────────────────────
    // Daily spending limits
    // ─────────────────────────────────────────────────────────────

    /// Sets a daily spending cap for `pay_per_use()` for the calling user.
    /// Stored in temporary storage; resets automatically after ~1 day.
    pub fn set_daily_limit(env: Env, user: Address, limit: i128) {
        user.require_auth();
        assert!(limit > 0, "limit must be positive");
        spending_limit::set_daily_limit(&env, &user, limit);
    }

    // ─────────────────────────────────────────────────────────────
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
    pub fn migrate(env: Env) {
        migration::migrate(&env);
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
        subscription_metadata::set_metadata(&env, &user, label);
    }

    /// Returns the metadata label for a subscriber, or `None` if not set.
    pub fn get_metadata(env: Env, user: Address) -> Option<String> {
        subscription_metadata::get_metadata(&env, &user)
    }

    // ─────────────────────────────────────────────────────────────
    // Charge history
    // ─────────────────────────────────────────────────────────────

    /// Returns the last (up to 12) charge timestamps for a subscriber,
    /// ordered oldest → newest.
    pub fn get_charge_history(env: Env, user: Address) -> Vec<u64> {
        subscription_history::get_charge_history(&env, &user)
    }
}

fn extend_subscription_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Subscription(user.clone()),
        SUBSCRIPTION_TTL_LEDGERS,
        SUBSCRIPTION_TTL_LEDGERS,
    );
}
