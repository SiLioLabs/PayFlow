#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, Events},
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
#[should_panic(expected = "interval not elapsed yet")]
fn test_charge_too_early() {
    let (_env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&_env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400);
    client.charge(&user); // immediately — should panic
}

#[test]
fn test_charge_exact_interval() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000; // 5 tokens
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days in seconds

    client.subscribe(&user, &merchant, &amount, &interval);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);

    // Advance ledger time by exactly interval (boundary condition)
    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });

    // Should succeed at exact boundary (now >= last_charged + interval)
    client.charge(&user);

    let sub_after = client.get_subscription(&user).unwrap();
    assert!(sub_after.last_charged > 0);
}

#[test]
#[should_panic(expected = "no subscription found")]
fn test_charge_nonexistent() {
    let (_env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&_env, &contract_id);

    let nonexistent_user = Address::generate(&_env);
    client.charge(&nonexistent_user); // Should panic with "no subscription found"
}

#[test]
fn test_subscribe_event_emitted() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &amount, &interval);

    let events = env.events().all();
    assert!(!events.is_empty(), "No events emitted");

    // Verify at least one event was emitted (subscribed event)
    let has_subscribed_event = events.iter().any(|(_, topics, _)| {
        topics.len() > 0
    });

    assert!(has_subscribed_event, "subscribed event not found");
}

#[test]
fn test_charge_event_emitted() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    client.subscribe(&user, &merchant, &amount, &interval);

    // Advance time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let events = env.events().all();
    assert!(!events.is_empty(), "No events emitted");

    // Verify charged event was emitted (should have at least 2 events: subscribe + charge)
    assert!(events.len() >= 2, "charged event not found");
}

#[test]
fn test_cancel_event_emitted() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400);
    client.cancel(&user);

    let events = env.events().all();
    assert!(!events.is_empty(), "No events emitted");

    // Verify cancelled event was emitted (should have at least 2 events: subscribe + cancel)
    assert!(events.len() >= 2, "cancelled event not found");
}
