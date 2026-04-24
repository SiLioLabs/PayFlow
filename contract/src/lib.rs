#![no_std]

mod errors;
mod events;
mod storage;
mod test;
mod validation;

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol,
};
use crate::errors::ContractError;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Subscription(Address), // user → Subscription
    Token,                 // optional default token (kept for backward compat)
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub merchant: Address,
    pub amount: i128,       // amount per period (in stroops / smallest unit)
    pub interval: u64,      // seconds between charges
    pub last_charged: u64,  // ledger timestamp of last charge
    pub active: bool,
    pub paused: bool,       // true if paused, false otherwise
    pub token: Address,     // SAC token used for this subscription
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct FlowPay;

#[contractimpl]
impl FlowPay {
    /// Optional one-time initialisation: set a default token for the contract.
    /// This is kept for backward compatibility but is no longer required —
    /// each subscription now carries its own token address.
    pub fn initialize(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            env.panic_with_error(ContractError::AlreadyInitialized);
        }
        storage::set_token(&env, &token);
    }

    /// User creates (or updates) a subscription to a merchant.
    ///
    /// `token` is the SAC address of the token to use for this subscription
    /// (e.g. native XLM or USDC). Each subscription can use a different token.
    ///
    /// The user must have already called `approve()` on the token contract
    /// granting this contract an allowance >= amount.
    pub fn subscribe(
        env: Env,
        user: Address,
        merchant: Address,
        amount: i128,
        interval: u64,
        token: Address,
    ) {
        user.require_auth();

        assert!(amount > 0, "amount must be positive");
        assert!(interval > 0, "interval must be positive");

        // Verify the user has approved a sufficient allowance — fail early with a
        // clear error rather than silently storing a subscription that will fail
        // to charge later.
        let token_client = token::Client::new(&env, &token);
        let allowance = token_client.allowance(&user, &env.current_contract_address());
        assert!(allowance >= amount, "insufficient allowance");

        let sub = Subscription {
            merchant,
            amount,
            interval,
            last_charged: env.ledger().timestamp(),
            active: true,
            paused: false,
            token,
        };

        storage::set_subscription(&env, &user, &sub);
        events::publish_subscribed(&env, &user, &sub);
    }

    /// Charge a user's subscription.
    ///
    /// Anyone can call this (your backend / keeper service will call it).
    /// The contract verifies the interval has elapsed before transferring.
    /// Uses the token stored on the subscription itself.
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

        let token = token::Client::new(&env, &sub.token);
        token.transfer_from(
            &env.current_contract_address(),
            &user,
            &sub.merchant,
            &sub.amount,
        );

        sub.last_charged = now;
        storage::set_subscription(&env, &user, &sub);

        events::publish_charged(&env, &user, &sub, now);
    }

    /// Pay-per-use microtransaction — charge an arbitrary amount right now,
    /// no interval check. Uses the token stored on the subscription.
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

        let token = token::Client::new(&env, &sub.token);
        token.transfer_from(
            &env.current_contract_address(),
            &user,
            &sub.merchant,
            &amount,
        );

        events::publish_pay_per_use(&env, &user, &sub.merchant, amount);
    }

    /// Cancel a subscription. Only the subscriber can cancel.
    pub fn cancel(env: Env, user: Address) {
        user.require_auth();

        let key = DataKey::Subscription(user.clone());
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| env.panic_with_error(ContractError::NoSubscriptionFound));

        sub.active = false;
        storage::set_subscription(&env, &user, &sub);

        events::publish_cancelled(&env, &user);
    }

    /// Pause a subscription. Only the subscriber can pause.
    ///
    /// While paused, `charge()` and `pay_per_use()` will panic.
    /// The subscription record is preserved and can be resumed at any time.
    pub fn pause(env: Env, user: Address) {
        user.require_auth();

        let key = DataKey::Subscription(user.clone());
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no subscription found");

        assert!(sub.active, "subscription is not active");
        assert!(!sub.paused, "subscription is already paused");

        sub.paused = true;
        env.storage().persistent().set(&key, &sub);

        env.events()
            .publish((Symbol::new(&env, "paused"), user), ());
    }

    /// Resume a paused subscription. Only the subscriber can resume.
    pub fn resume(env: Env, user: Address) {
        user.require_auth();

        let key = DataKey::Subscription(user.clone());
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no subscription found");

        assert!(sub.active, "subscription is not active");
        assert!(sub.paused, "subscription is not paused");

        sub.paused = false;
        env.storage().persistent().set(&key, &sub);

        env.events()
            .publish((Symbol::new(&env, "resumed"), user), ());
    }

    /// Read a subscription (view function).
    pub fn get_subscription(env: Env, user: Address) -> Option<Subscription> {
        storage::get_subscription(&env, &user)
    }
}
