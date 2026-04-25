#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

/// Returns (env, contract_id, token_addr, user, merchant)
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200);

    (env, contract_id, token_addr, user, merchant)
}

/// Helper: deploy second token
fn setup_second_token(env: &Env, contract_id: &Address, user: &Address) -> Address {
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let sac = StellarAssetClient::new(env, &token_addr);
    sac.mint(user, &10_000_0000000);

    let token = TokenClient::new(env, &token_addr);
    token.approve(user, contract_id, &10_000_0000000, &200);

    token_addr
}

// ─────────────────────────────────────────────
// Core functionality tests
// ─────────────────────────────────────────────

#[test]
fn test_subscribe_and_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);
    assert_eq!(sub.token, token_addr);

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

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
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
    client.charge(&user);
}

// ─────────────────────────────────────────────
// Multi-token + advanced features
// ─────────────────────────────────────────────

#[test]
fn test_multi_token_independent_subscriptions() {
    let (env, contract_id, token_a, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let token_b = setup_second_token(&env, &contract_id, &user_b);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user_a, &merchant, &amount, &interval, &token_a);
    client.subscribe(&user_b, &merchant, &amount, &interval, &token_b);

    let sub_a = client.get_subscription(&user_a).unwrap();
    let sub_b = client.get_subscription(&user_b).unwrap();

    assert_eq!(sub_a.token, token_a);
    assert_eq!(sub_b.token, token_b);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user_a);
    client.charge(&user_b);
}

#[test]
fn test_user_can_switch_token() {
    let (env, contract_id, token_a, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let token_b = setup_second_token(&env, &contract_id, &user);
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_a);
    client.subscribe(&user, &merchant, &2_0000000, &interval, &token_b);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.token, token_b);
    assert_eq!(sub.amount, 2_0000000);
}

#[test]
fn test_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);

    let token = TokenClient::new(&env, &token_addr);
    let before = token.balance(&merchant);

    client.pay_per_use(&user, &5_0000000);

    assert_eq!(token.balance(&merchant), before + 5_0000000);
}

#[test]
#[should_panic]
fn test_pay_per_use_inactive() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.cancel(&user);
    client.pay_per_use(&user, &1_0000000);
}

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr);
    client.pay_per_use(&user, &0);
}

/// initialize() still works for backward compat but is not required.
#[test]
fn test_initialize_backward_compat() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // initialize with a default token — should not affect per-sub token
    client.initialize(&token_addr);

    let token_b = setup_second_token(&env, &contract_id, &user);
    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_b, &None);

    // Subscription uses token_b, not the initialized default
    assert_eq!(client.get_subscription(&user).unwrap().token, token_b);
}

// ── Issue #14: cancel nonexistent subscription ───────────────────────────────

/// cancel() must panic with "no subscription found" when called on a user with no subscription.
#[test]
#[should_panic(expected = "no subscription found")]
fn test_cancel_nonexistent() {
// ── Issue #13: get_subscription for nonexistent subscription ─────────────────

/// get_subscription() must return None for an address with no subscription.
#[test]
fn test_get_subscription_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    
    let random = Address::generate(&env);
    client.cancel(&random);
    assert!(client.get_subscription(&random).is_none(), "get_subscription should return None for unknown address");
// ── Issue #12: last_charged timestamp update ─────────────────────────────────

/// charge() must update last_charged to the current ledger timestamp.
#[test]
fn test_charge_updates_last_charged() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None);

    // Record the timestamp before advancing time
    let subscribe_time = env.ledger().timestamp();

    // Advance ledger time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1000; // advance by interval + 1000 seconds
    });

    // Record the timestamp right before charge
    let charge_time = env.ledger().timestamp();
    assert!(charge_time > subscribe_time, "charge time should be after subscribe time");

    client.charge(&user);

    let sub_after = client.get_subscription(&user).unwrap();
    // Verify last_charged is exactly equal to the charge_time
    assert_eq!(sub_after.last_charged, charge_time, "last_charged should equal the ledger timestamp at charge time");
  }

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_zero_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &0, &86400, &token_addr);
}

#[test]
#[should_panic(expected = "interval must be positive")]
fn test_zero_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &0, &token_addr);
}

// ─────────────────────────────────────────────
// Multi-user isolation
// ─────────────────────────────────────────────

#[test]
fn test_multiple_users() {
    let (env, contract_id, token_addr, user_a, merchant_a) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let merchant_b = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);

    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let amount_a: i128 = 1_0000000;
    let amount_b: i128 = 2_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user_a, &merchant_a, &amount_a, &interval, &token_addr);
    client.subscribe(&user_b, &merchant_b, &amount_b, &interval, &token_addr);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user_a);
}

// ─────────────────────────────────────────────
// Cancel + charge edge cases
// ─────────────────────────────────────────────

#[test]
#[should_panic(expected = "subscription is not active")]
fn test_charge_after_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr);
    client.cancel(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
    });

    client.charge(&user);
}
