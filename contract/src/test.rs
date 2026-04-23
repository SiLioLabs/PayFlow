#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy a test token (Stellar Asset Contract)
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    // Deploy FlowPay contract
    let contract_id = env.register_contract(None, FlowPay);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Mint tokens to user
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000); // 10,000 tokens

    // Approve FlowPay to spend on behalf of user
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200);

    // Initialize FlowPay
    let client = FlowPayClient::new(&env, &contract_id);
    client.initialize(&token_addr);

    (env, contract_id, token_addr, user, merchant)
}

#[test]
fn test_subscribe_and_charge() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000; // 5 tokens
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days in seconds

    client.subscribe(&user, &merchant, &amount, &interval);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);

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
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400);
    client.cancel(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
fn test_merchant_balance_after_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000; // 5 tokens
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days in seconds

    client.subscribe(&user, &merchant, &amount, &interval);

    // Record merchant balance before charge
    let merchant_balance_before = token.balance(&merchant);

    // Advance ledger time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    // Assert the exact amount was transferred to the merchant
    let merchant_balance_after = token.balance(&merchant);
    assert_eq!(
        merchant_balance_after,
        merchant_balance_before + amount,
        "merchant balance should increase by exactly the subscription amount"
    );
}

#[test]
fn test_multiple_charges() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000; // 5 tokens
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days in seconds

    // Record the ledger timestamp at subscription time — this becomes last_charged
    let subscribe_ts = env.ledger().timestamp();
    client.subscribe(&user, &merchant, &amount, &interval);

    // ── Charge 1 ──────────────────────────────────────────────────────────────
    let charge1_ts = subscribe_ts + interval + 1;
    env.ledger().with_mut(|l| l.timestamp = charge1_ts);
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(
        sub.last_charged, charge1_ts,
        "last_charged should equal the ledger timestamp of charge 1"
    );

    // ── Charge 2 ──────────────────────────────────────────────────────────────
    let charge2_ts = charge1_ts + interval + 1;
    env.ledger().with_mut(|l| l.timestamp = charge2_ts);
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(
        sub.last_charged, charge2_ts,
        "last_charged should equal the ledger timestamp of charge 2"
    );

    // ── Charge 3 ──────────────────────────────────────────────────────────────
    let charge3_ts = charge2_ts + interval + 1;
    env.ledger().with_mut(|l| l.timestamp = charge3_ts);
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(
        sub.last_charged, charge3_ts,
        "last_charged should equal the ledger timestamp of charge 3"
    );

    // Subscription should still be active after all three charges
    assert!(sub.active, "subscription should remain active after multiple charges");
}

#[test]
fn test_large_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let sac = StellarAssetClient::new(&env, &token_addr);
    let token = TokenClient::new(&env, &token_addr);

    // Use a large amount safely below i128::MAX to avoid any internal
    // balance arithmetic overflow (e.g. existing minted balance + large_amount).
    // setup() already minted 10_000_0000000 to the user, so we pick a value
    // that fits within i128::MAX when added to that existing balance.
    let large_amount: i128 = i128::MAX - 10_000_0000000;

    // Mint the additional tokens needed to cover the large subscription charge
    sac.mint(&user, &large_amount);

    // Extend the allowance to cover the large amount
    token.approve(&user, &contract_id, &i128::MAX, &200);

    let interval: u64 = 30 * 24 * 60 * 60; // 30 days in seconds

    client.subscribe(&user, &merchant, &large_amount, &interval);

    // Verify the subscription was stored with the exact large amount
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active, "subscription should be active");
    assert_eq!(
        sub.amount, large_amount,
        "subscription amount should match the large value without overflow"
    );
    assert_eq!(sub.interval, interval);

    // Also exercise charge() to confirm the token transfer handles large values
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let sub_after = client.get_subscription(&user).unwrap();
    assert!(sub_after.last_charged > 0, "last_charged should be updated after charge");

    // Merchant should have received exactly the large amount
    assert_eq!(
        token.balance(&merchant),
        large_amount,
        "merchant balance should equal the large subscription amount"
    );
}

#[test]
fn test_user_balance_decreases_after_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000; // 5 tokens
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days in seconds

    client.subscribe(&user, &merchant, &amount, &interval);

    // Record user balance before charge
    let user_balance_before = token.balance(&user);

    // Advance ledger time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    // Assert the exact amount was debited from the user
    let user_balance_after = token.balance(&user);
    assert_eq!(
        user_balance_after,
        user_balance_before - amount,
        "user balance should decrease by exactly the subscription amount"
    );
}

#[test]
#[should_panic(expected = "interval not elapsed yet")]
fn test_charge_too_early() {
    let (_env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&_env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400);
    client.charge(&user); // immediately — should panic
}
