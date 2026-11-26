// ─────────────────────────────────────────────────────────────
// Issue #1434 — Re-entrancy & checks-effects-interactions audit
// ─────────────────────────────────────────────────────────────
//
// Every money-moving entrypoint (`charge`, `batch_charge`,
// `charge_subscription`, `pay_per_use`, `pay_per_use_to`,
// `pay_per_use_with_nonce`, `cancel_and_refund_prorated`,
// `refund_last_charge`, `withdraw_merchant_revenue`) now follows strict CEI:
//
//   checks  →  effects (all storage writes + events)  →  interaction (token)
//
// Two layers protect the interaction phase:
//
//   1. Soroban's host rejects a cross-contract call back into the same
//      contract instance while it is still on the call stack, which rules out
//      EVM-style re-entrancy.
//   2. Even if a callback were possible, every state write is already
//      committed before the first token call, so a re-entrant read could never
//      observe pre-charge state (e.g. an un-advanced `last_charged` or an
//      un-debited daily limit).
//
// The `HostileToken` below is a fully functional SAC-shaped token that, when
// armed, calls back into FlowPay from inside `transfer` / `transfer_from` —
// exactly what a malicious token would do. Each test asserts the host rejects
// the re-entrant call (`try_*` returns `Err`) and that the aborted charge left
// no partial state behind.

use soroban_sdk::{contract, contractimpl, contracttype};

/// Re-entrant entrypoint selector armed on the hostile token.
pub(crate) const REENTER_CHARGE: u32 = 0;
pub(crate) const REENTER_PAY_PER_USE: u32 = 1;
pub(crate) const REENTER_CANCEL_REFUND: u32 = 2;
pub(crate) const REENTER_WITHDRAW: u32 = 3;

#[contracttype]
#[derive(Clone)]
pub enum HostileTokenKey {
    Balance(Address),
    Allowance(Address, Address),
    Reentry,
}

/// The callback a hostile token attempts while handling a transfer.
#[contracttype]
#[derive(Clone)]
pub struct ReentryCall {
    /// FlowPay contract to re-enter.
    pub target: Address,
    pub user: Address,
    pub merchant: Address,
    /// One of the `REENTER_*` selectors.
    pub entry: u32,
}

/// A minimal SAC-shaped token that can re-enter FlowPay mid-transfer.
#[contract]
pub struct HostileToken;

#[contractimpl]
impl HostileToken {
    /// Test-only mint (no auth, mirrors `StellarAssetClient::mint` under
    /// `mock_all_auths`).
    pub fn mint(env: Env, to: Address, amount: i128) {
        let balance = Self::balance_of(&env, &to);
        env.storage()
            .instance()
            .set(&HostileTokenKey::Balance(to), &(balance + amount));
    }

    pub fn approve(env: Env, from: Address, spender: Address, amount: i128) {
        from.require_auth();
        env.storage()
            .instance()
            .set(&HostileTokenKey::Allowance(from, spender), &amount);
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        Self::allowed(&env, &from, &spender)
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::balance_of(&env, &id)
    }

    /// Arms (`Some`) or disarms (`None`) the mid-transfer callback.
    pub fn arm_reentry(env: Env, call: Option<ReentryCall>) {
        match call {
            Some(call) => env.storage().instance().set(&HostileTokenKey::Reentry, &call),
            None => env.storage().instance().remove(&HostileTokenKey::Reentry),
        }
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::move_tokens(&env, &from, &to, amount);
        Self::reenter(&env);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        let remaining = Self::allowed(&env, &from, &spender) - amount;
        assert!(remaining >= 0, "insufficient allowance");
        env.storage().instance().set(
            &HostileTokenKey::Allowance(from.clone(), spender),
            &remaining,
        );
        Self::move_tokens(&env, &from, &to, amount);
        Self::reenter(&env);
    }
}

impl HostileToken {
    fn balance_of(env: &Env, id: &Address) -> i128 {
        env.storage()
            .instance()
            .get(&HostileTokenKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn allowed(env: &Env, from: &Address, spender: &Address) -> i128 {
        env.storage()
            .instance()
            .get(&HostileTokenKey::Allowance(from.clone(), spender.clone()))
            .unwrap_or(0)
    }

    fn move_tokens(env: &Env, from: &Address, to: &Address, amount: i128) {
        let from_balance = Self::balance_of(env, from);
        assert!(from_balance >= amount, "insufficient balance");
        let to_balance = Self::balance_of(env, to);
        env.storage()
            .instance()
            .set(&HostileTokenKey::Balance(from.clone()), &(from_balance - amount));
        env.storage()
            .instance()
            .set(&HostileTokenKey::Balance(to.clone()), &(to_balance + amount));
    }

    /// The attack: call back into FlowPay while the outer invocation is still
    /// on the call stack.
    fn reenter(env: &Env) {
        let call: Option<ReentryCall> = env.storage().instance().get(&HostileTokenKey::Reentry);
        let Some(call) = call else {
            return;
        };
        let client = FlowPayClient::new(env, &call.target);
        match call.entry {
            REENTER_CHARGE => client.charge(&call.user),
            REENTER_PAY_PER_USE => client.pay_per_use(&call.user, &1_i128),
            REENTER_CANCEL_REFUND => client.cancel_and_refund_prorated(&call.user, &call.merchant),
            _ => client.withdraw_merchant_revenue(&call.merchant),
        };
    }
}

/// Deploys FlowPay with a hostile token, a funded/approved user and a funded
/// merchant. Returns `(env, contract_id, token, user, merchant)`.
fn hostile_setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FlowPay, ());
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    let token_id = env.register(HostileToken, ());
    let token = HostileTokenClient::new(&env, &token_id);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    token.mint(&user, &10_000_0000000_i128);
    token.mint(&merchant, &10_000_0000000_i128);
    token.approve(&user, &contract_id, &10_000_0000000_i128);

    FlowPayClient::new(&env, &contract_id).initialize(&token_id, &Address::generate(&env));

    (env, contract_id, token_id, user, merchant)
}

fn arm_reentry(
    env: &Env,
    token_addr: &Address,
    contract_id: &Address,
    user: &Address,
    merchant: &Address,
    entry: u32,
) {
    HostileTokenClient::new(env, token_addr).arm_reentry(&Some(ReentryCall {
        target: contract_id.clone(),
        user: user.clone(),
        merchant: merchant.clone(),
        entry,
    }));
}

/// Control: the hostile token is a working token when its callback is disarmed.
#[test]
fn hostile_token_without_reentry_completes_charge() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000_i128,
        &86_400_u64,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    client.charge(&user);

    let sub = client.get_subscription(&user).expect("subscription");
    assert_eq!(sub.last_charged, env.ledger().timestamp());
    assert_eq!(client.get_merchant_revenue(&merchant), 1_0000000);
}

/// `charge` — a token that re-enters `charge` mid-transfer is rejected by the
/// host, nothing is charged twice and no partial state is committed.
#[test]
fn reentrant_token_cannot_double_charge_via_charge() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000_i128,
        &86_400_u64,
        &token_addr,
        &None,
        &None,
    );
    let before = client.get_subscription(&user).expect("subscription");
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    arm_reentry(
        &env,
        &token_addr,
        &contract_id,
        &user,
        &merchant,
        REENTER_CHARGE,
    );
    let result = client.try_charge(&user);
    assert!(result.is_err(), "re-entrant charge must be rejected");

    let after = client.get_subscription(&user).expect("subscription");
    assert_eq!(after.last_charged, before.last_charged);
    assert_eq!(client.get_merchant_revenue(&merchant), 0);
    let token = HostileTokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&user), 10_000_0000000);
    assert_eq!(token.balance(&merchant), 10_000_0000000);
}

/// `pay_per_use` — re-entry from the token call is rejected and neither the
/// daily spend counter nor the merchant revenue is left partially applied.
#[test]
fn reentrant_token_cannot_double_spend_via_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000_i128,
        &86_400_u64,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &100_0000000_i128);

    arm_reentry(
        &env,
        &token_addr,
        &contract_id,
        &user,
        &merchant,
        REENTER_PAY_PER_USE,
    );
    let result = client.try_pay_per_use(&user, &5_0000000_i128);
    assert!(result.is_err(), "re-entrant pay_per_use must be rejected");

    assert_eq!(client.get_daily_spent(&user), 0);
    assert_eq!(client.get_merchant_revenue(&merchant), 0);
    let token = HostileTokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&user), 10_000_0000000);
}

/// `pay_per_use_to` — same guarantee for the explicit-recipient variant.
#[test]
fn reentrant_token_cannot_double_spend_via_pay_per_use_to() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000_i128,
        &86_400_u64,
        &token_addr,
        &None,
        &None,
    );

    arm_reentry(
        &env,
        &token_addr,
        &contract_id,
        &user,
        &merchant,
        REENTER_PAY_PER_USE,
    );
    let result = client.try_pay_per_use_to(&user, &5_0000000_i128, &recipient);
    assert!(result.is_err(), "re-entrant pay_per_use_to must be rejected");

    assert_eq!(client.get_daily_spent(&user), 0);
    let token = HostileTokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&user), 10_000_0000000);
    assert_eq!(token.balance(&recipient), 0);
}

/// `cancel_and_refund_prorated` — the subscription is cleared (effect) before
/// the merchant → user transfer, and a re-entrant call from that transfer is
/// rejected without leaving the subscription half-cancelled.
#[test]
fn reentrant_token_cannot_double_refund_via_cancel_and_refund() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000_i128,
        &(86_400_u64 * 30),
        &token_addr,
        &None,
        &None,
    );
    // Move into the first period so a prorated refund is positive.
    env.ledger().with_mut(|l| l.timestamp += 86_400);

    arm_reentry(
        &env,
        &token_addr,
        &contract_id,
        &user,
        &merchant,
        REENTER_CANCEL_REFUND,
    );
    let result = client.try_cancel_and_refund_prorated(&user, &merchant);
    assert!(result.is_err(), "re-entrant refund must be rejected");

    let sub = client.get_subscription(&user).expect("subscription");
    assert!(sub.active, "aborted refund must not cancel the subscription");
    let token = HostileTokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&user), 10_000_0000000);
}

/// `refund_last_charge` — the revenue reversal and last-charge record clear
/// happen before the merchant → user transfer.
#[test]
fn reentrant_token_cannot_double_refund_via_refund_last_charge() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000_i128,
        &86_400_u64,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.charge(&user);
    assert_eq!(client.get_merchant_revenue(&merchant), 1_0000000);

    arm_reentry(
        &env,
        &token_addr,
        &contract_id,
        &user,
        &merchant,
        REENTER_CANCEL_REFUND,
    );
    let result = client.try_refund_last_charge(&user, &merchant);
    assert!(result.is_err(), "re-entrant refund must be rejected");

    // The aborted refund rolled back: revenue and the last-charge record are
    // exactly as the successful charge left them.
    assert_eq!(client.get_merchant_revenue(&merchant), 1_0000000);
    let token = HostileTokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&user), 10_000_0000000 - 1_0000000);
}

/// `withdraw_merchant_revenue` — revenue is reset before the transfer, so a
/// re-entrant withdrawal cannot drain the same balance twice.
#[test]
fn reentrant_token_cannot_double_withdraw_merchant_revenue() {
    let (env, contract_id, token_addr, user, merchant) = hostile_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000_i128,
        &86_400_u64,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.charge(&user);
    let revenue_before = client.get_merchant_revenue(&merchant);
    assert_eq!(revenue_before, 1_0000000);

    arm_reentry(
        &env,
        &token_addr,
        &contract_id,
        &user,
        &merchant,
        REENTER_WITHDRAW,
    );
    let result = client.try_withdraw_merchant_revenue(&merchant);
    assert!(result.is_err(), "re-entrant withdrawal must be rejected");

    assert_eq!(client.get_merchant_revenue(&merchant), revenue_before);
    let token = HostileTokenClient::new(&env, &token_addr);
    // The merchant only holds its initial mint plus the one successful charge.
    assert_eq!(token.balance(&merchant), 10_000_0000000);
}
