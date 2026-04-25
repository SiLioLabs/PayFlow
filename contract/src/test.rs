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

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
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

    client.subscribe(&user_a, &merchant, &amount, &interval, &token_a, &None);
    client.subscribe(&user_b, &merchant, &amount, &interval, &token_b, &None);

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

    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_a, &None);
    client.subscribe(&user, &merchant, &2_0000000, &interval, &token_b, &None);

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

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_pay_per_use_zero_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
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
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let random = Address::generate(&env);
    client.cancel(&random);
}

// ── Issue #13: get_subscription for nonexistent subscription ─────────────────

/// get_subscription() must return None for an address with no subscription.
#[test]
fn test_get_subscription_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    
    let random = Address::generate(&env);
    assert!(client.get_subscription(&random).is_none(), "get_subscription should return None for unknown address");
}
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

    client.subscribe(&user, &merchant, &0, &86400, &token_addr, &None);
}

#[test]
#[should_panic(expected = "interval must be positive")]
fn test_zero_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &0, &token_addr, &None);
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

    client.subscribe(&user_a, &merchant_a, &amount_a, &interval, &token_addr, &None);
    client.subscribe(&user_b, &merchant_b, &amount_b, &interval, &token_addr, &None);

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

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.cancel(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
    });

    client.charge(&user);
}

// ─────────────────────────────────────────────
// batch_charge tests
// ─────────────────────────────────────────────

#[test]
fn test_batch_charge_charged_and_skipped() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let interval: u64 = 86400;
    client.subscribe(&user_a, &merchant, &1_0000000, &interval, &token_addr, &None);
    client.subscribe(&user_b, &merchant, &1_0000000, &interval, &token_addr, &None);

    // Only advance past interval for user_a
    env.ledger().with_mut(|l| { l.timestamp += interval + 1; });

    // user_b re-subscribes at the new timestamp so their interval hasn't elapsed
    client.subscribe(&user_b, &merchant, &1_0000000, &interval, &token_addr, &None);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::Skipped);
}

#[test]
fn test_batch_charge_no_subscription() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let unknown = Address::generate(&env);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(unknown);

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::NoSubscription);
}

#[test]
fn test_batch_charge_inactive() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_addr, &None);
    client.cancel(&user);

    env.ledger().with_mut(|l| { l.timestamp += interval + 1; });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Inactive);
}

// ─────────────────────────────────────────────
// subscription_count tests
// ─────────────────────────────────────────────

#[test]
fn test_active_count_increments_on_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_active_count(), 0);
    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    assert_eq!(client.get_active_count(), 1);
}

#[test]
fn test_active_count_decrements_on_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    assert_eq!(client.get_active_count(), 1);
    client.cancel(&user);
    assert_eq!(client.get_active_count(), 0);
}

#[test]
fn test_active_count_multiple_users() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    client.subscribe(&user_a, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.subscribe(&user_b, &merchant, &1_0000000, &86400, &token_addr, &None);
    assert_eq!(client.get_active_count(), 2);

    client.cancel(&user_a);
    assert_eq!(client.get_active_count(), 1);
}

// ─────────────────────────────────────────────
// merchant_stats tests
// ─────────────────────────────────────────────

#[test]
fn test_merchant_revenue_from_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;
    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None);

    assert_eq!(client.get_merchant_revenue(&merchant), 0);

    env.ledger().with_mut(|l| { l.timestamp += interval + 1; });
    client.charge(&user);

    assert_eq!(client.get_merchant_revenue(&merchant), amount);
}

#[test]
fn test_merchant_revenue_from_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.pay_per_use(&user, &3_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 3_0000000);
}

#[test]
fn test_merchant_revenue_accumulates() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 2_0000000;
    let interval: u64 = 86400;
    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None);

    env.ledger().with_mut(|l| { l.timestamp += interval + 1; });
    client.charge(&user);

    client.pay_per_use(&user, &1_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 3_0000000);
}

// ─────────────────────────────────────────────
// spending_limit tests
// ─────────────────────────────────────────────

#[test]
fn test_daily_limit_allows_spend_within_limit() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.set_daily_limit(&user, &10_0000000);
    // Should not panic
    client.pay_per_use(&user, &5_0000000);
}

#[test]
#[should_panic(expected = "daily spending limit exceeded")]
fn test_daily_limit_blocks_overspend() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.set_daily_limit(&user, &3_0000000);
    client.pay_per_use(&user, &5_0000000);
}

#[test]
fn test_daily_limit_accumulates_across_calls() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &2_0000000);
    client.pay_per_use(&user, &2_0000000);
    // 4 total, limit is 5 — should pass
}

#[test]
#[should_panic(expected = "daily spending limit exceeded")]
fn test_daily_limit_blocks_cumulative_overspend() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None);
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &3_0000000);
    client.pay_per_use(&user, &3_0000000); // 6 total > 5 limit
}
