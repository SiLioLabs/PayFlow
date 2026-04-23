#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

/// Returns (env, contract_id, token_addr, user, merchant)
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy a test token (Stellar Asset Contract)
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    // Deploy FlowPay contract (no initialize() call needed — token is per-sub)
    let contract_id = env.register_contract(None, FlowPay);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Mint tokens to user
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    // Approve FlowPay to spend on behalf of user
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200);

    (env, contract_id, token_addr, user, merchant)
}

/// Helper: deploy a second independent SAC token and fund a user
fn setup_second_token(
    env: &Env,
    contract_id: &Address,
    user: &Address,
) -> Address {
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let sac = StellarAssetClient::new(env, &token_addr);
    sac.mint(user, &10_000_0000000);

    let token = TokenClient::new(env, &token_addr);
    token.approve(user, contract_id, &10_000_0000000, &200);

    token_addr
}

// ── Existing tests (updated to pass token to subscribe) ──────────────────────

#[test]
fn test_subscribe_and_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000; // 5 tokens
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);
    assert_eq!(sub.token, token_addr);

    // Advance ledger time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let sub_after = client.get_subscription(&user).unwrap();
    assert!(sub_after.last_charged > 0);
}

#[test]
fn test_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr);
    client.cancel(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
#[should_panic]
fn test_charge_too_early() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr);
    client.charge(&user); // immediately — should panic
}

// ── Multi-token tests ─────────────────────────────────────────────────────────

/// Two users subscribe with different tokens; each charge uses the correct token.
#[test]
fn test_multi_token_independent_subscriptions() {
    let (env, contract_id, token_a, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let token_b = setup_second_token(&env, &contract_id, &user_b);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    // user_a subscribes with token_a, user_b with token_b
    client.subscribe(&user_a, &merchant, &amount, &interval, &token_a);
    client.subscribe(&user_b, &merchant, &amount, &interval, &token_b);

    let sub_a = client.get_subscription(&user_a).unwrap();
    let sub_b = client.get_subscription(&user_b).unwrap();

    assert_eq!(sub_a.token, token_a);
    assert_eq!(sub_b.token, token_b);
    assert_ne!(sub_a.token, sub_b.token);

    // Advance time and charge both
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user_a);
    client.charge(&user_b);

    // Verify balances: merchant should have received from both tokens
    let tc_a = TokenClient::new(&env, &token_a);
    let tc_b = TokenClient::new(&env, &token_b);

    assert_eq!(tc_a.balance(&merchant), amount);
    assert_eq!(tc_b.balance(&merchant), amount);
}

/// A single user can re-subscribe with a different token (e.g. switching from XLM to USDC).
#[test]
fn test_user_can_switch_token() {
    let (env, contract_id, token_a, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let token_b = setup_second_token(&env, &contract_id, &user);

    let interval: u64 = 86400;

    // Subscribe with token_a
    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_a);
    assert_eq!(client.get_subscription(&user).unwrap().token, token_a);

    // Re-subscribe with token_b (overwrites)
    client.subscribe(&user, &merchant, &2_0000000, &interval, &token_b);
    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.token, token_b);
    assert_eq!(sub.amount, 2_0000000);
}

/// pay_per_use uses the token stored on the subscription.
#[test]
fn test_pay_per_use_uses_subscription_token() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &5_0000000, &86400, &token_addr);

    let pay_amount: i128 = 1_0000000;
    client.pay_per_use(&user, &pay_amount);

    let tc = TokenClient::new(&env, &token_addr);
    assert_eq!(tc.balance(&merchant), pay_amount);
}

/// initialize() still works for backward compat but is not required.
#[test]
fn test_initialize_backward_compat() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // initialize with a default token — should not affect per-sub token
    client.initialize(&token_addr);

    let token_b = setup_second_token(&env, &contract_id, &user);
    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_b);

    // Subscription uses token_b, not the initialized default
    assert_eq!(client.get_subscription(&user).unwrap().token, token_b);
}
