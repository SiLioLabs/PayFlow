//! Tests for subscription lifecycle limits and merchant subscriber listing.
//!
//! - Issue #1399: `get_merchant_subscribers(merchant, offset, limit)`.
//! - Issue #1400: fixed-term subscriptions (`max_cycles` / `end_at`).
//! - Issue #1401: admin cap on `pause` / `pause_until` duration.
#![cfg(test)]

use super::*;
use crate::errors::ContractErrorExt;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

const START: u64 = 1_000_000;
const AMOUNT: i128 = 1_0000000;
const INTERVAL: u64 = 86_400;

/// Initialised contract (admin + token), whitelist disabled, clock at `START`.
/// Returns (env, contract_id, token_addr, merchant).
fn limits_setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let contract_id = env.register_contract(None, FlowPay);
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);

    FlowPayClient::new(&env, &contract_id).initialize(&token_addr, &admin);
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false)
    });
    env.ledger().with_mut(|l| l.timestamp = START);

    (env, contract_id, token_addr, merchant)
}

fn funded_subscriber(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    StellarAssetClient::new(env, token_addr).mint(&user, &10_000_0000000i128);
    TokenClient::new(env, token_addr).approve(&user, contract_id, &10_000_0000000i128, &200_000u32);
    user
}

fn advance_to(env: &Env, ts: u64) {
    env.ledger().with_mut(|l| l.timestamp = ts);
}

fn contract_err(code: u32) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(code)
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1400: fixed-term subscriptions
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_max_cycles_completes_after_last_charge() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);

    client.subscribe_with_end_conditions(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &Some(2u32),
        &None,
    );
    assert_eq!(client.get_active_count(), 1);
    assert_eq!(
        client.get_subscription_health(&user).remaining_cycles,
        Some(2)
    );

    advance_to(&env, START + INTERVAL);
    client.charge(&user);
    assert!(
        client.get_subscription(&user).unwrap().active,
        "one cycle left"
    );
    assert_eq!(
        client.get_subscription_health(&user).remaining_cycles,
        Some(1)
    );

    advance_to(&env, START + 2 * INTERVAL);
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(
        !sub.active,
        "the max_cycles-th charge completes the subscription"
    );
    let terms = client.get_subscription_terms(&user).unwrap();
    assert_eq!(terms.charges_made, 2);
    assert_eq!(
        client.get_subscription_health(&user).remaining_cycles,
        Some(0)
    );

    // Counters move exactly as on cancel.
    assert_eq!(client.get_active_count(), 0);
    assert_eq!(client.get_merchant_subscriber_count(&merchant), 0);
    assert_eq!(client.get_merchant_subscribers(&merchant, &0, &10).len(), 0);

    // No further charge is collected.
    advance_to(&env, START + 3 * INTERVAL);
    assert_eq!(
        client.try_charge(&user),
        Err(Ok(contract_err(ContractError::SubscriptionInactive as u32)))
    );
    let token = TokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&merchant), 2 * AMOUNT);
}

#[test]
fn test_end_at_rejects_charges_after_end() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);

    // Ends half-way through the second cycle: one charge, then no more.
    let end_at = START + INTERVAL + INTERVAL / 2;
    client.subscribe_with_end_conditions(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &None,
        &Some(end_at),
    );
    assert_eq!(client.get_subscription_health(&user).remaining_cycles, None);

    advance_to(&env, START + INTERVAL);
    client.charge(&user);
    assert!(client.get_subscription(&user).unwrap().active);

    advance_to(&env, START + 2 * INTERVAL);
    assert_eq!(client.simulate_charge(&user), ChargeSimResult::Inactive);
    assert_eq!(
        client.try_charge(&user),
        Err(Ok(contract_err(ContractError::SubscriptionInactive as u32)))
    );

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    assert_eq!(
        client.get_batch_charge_estimate(&users).get(0),
        Some(ChargeResult::Inactive)
    );
    assert_eq!(
        client.batch_charge(&users).get(0),
        Some(ChargeResult::Inactive)
    );
}

#[test]
fn test_charge_at_end_at_completes_subscription() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);

    let end_at = START + INTERVAL;
    client.subscribe_with_end_conditions(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &None,
        &Some(end_at),
    );

    advance_to(&env, end_at);
    client.charge(&user);
    assert!(!client.get_subscription(&user).unwrap().active);
    assert_eq!(client.get_active_count(), 0);
}

#[test]
fn test_batch_charge_respects_max_cycles() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);

    client.subscribe_with_end_conditions(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &Some(1u32),
        &None,
    );
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    advance_to(&env, START + INTERVAL);
    assert_eq!(
        client.batch_charge(&users).get(0),
        Some(ChargeResult::Charged)
    );
    assert!(!client.get_subscription(&user).unwrap().active);

    advance_to(&env, START + 2 * INTERVAL);
    assert_eq!(
        client.batch_charge(&users).get(0),
        Some(ChargeResult::Inactive)
    );
}

#[test]
fn test_plain_subscribe_is_open_ended_and_clears_old_terms() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);

    client.subscribe(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscription_terms(&user), None);

    client.subscribe_with_end_conditions(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &Some(3u32),
        &None,
    );
    assert!(client.get_subscription_terms(&user).is_some());

    client.subscribe(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscription_terms(&user), None);

    // Open-ended subscriptions keep charging past any former limit.
    for cycle in 1..=4u64 {
        advance_to(&env, START + cycle * INTERVAL);
        client.charge(&user);
    }
    assert!(client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_invalid_end_conditions_rejected() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);
    let invalid = Err(Ok(contract_err(
        ContractErrorExt::InvalidEndCondition as u32,
    )));

    assert_eq!(
        client.try_subscribe_with_end_conditions(
            &user,
            &merchant,
            &AMOUNT,
            &INTERVAL,
            &token_addr,
            &None,
            &None,
            &Some(0u32),
            &None,
        ),
        invalid
    );
    assert_eq!(
        client.try_subscribe_with_end_conditions(
            &user,
            &merchant,
            &AMOUNT,
            &INTERVAL,
            &token_addr,
            &None,
            &None,
            &None,
            &Some(START),
        ),
        invalid
    );
    assert!(client.get_subscription(&user).is_none());
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1401: pause duration cap
// ─────────────────────────────────────────────────────────────────────────────

fn pause_expiry(env: &Env, contract_id: &Address, user: &Address) -> Option<u64> {
    env.as_contract(contract_id, || storage::get_pause_expiry(env, user))
}

#[test]
fn test_pause_unlimited_by_default() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_max_pause_seconds(), 0);
    client.pause(&user);
    assert_eq!(pause_expiry(&env, &contract_id, &user), Some(u64::MAX));

    client.resume(&user);
    client.pause_until(&user, &(START + 10 * 365 * INTERVAL));
}

#[test]
fn test_pause_until_rejects_expiry_beyond_cap() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );

    let cap = 7 * INTERVAL;
    client.set_max_pause_seconds(&cap);
    assert_eq!(client.get_max_pause_seconds(), cap);
    assert_eq!(client.get_contract_config().max_pause_seconds, cap);

    assert_eq!(
        client.try_pause_until(&user, &(START + cap + 1)),
        Err(Ok(contract_err(
            ContractErrorExt::PauseExceedsMaxDuration as u32
        )))
    );
    assert!(!client.get_subscription(&user).unwrap().paused);

    client.pause_until(&user, &(START + cap));
    assert!(client.get_subscription(&user).unwrap().paused);
}

#[test]
fn test_capped_pause_auto_resumes_at_cap() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );

    let cap = 3 * INTERVAL;
    client.set_max_pause_seconds(&cap);
    client.pause(&user);
    assert_eq!(pause_expiry(&env, &contract_id, &user), Some(START + cap));

    // Before the cap the pause holds; at the cap the next charge resumes it.
    advance_to(&env, START + cap - 1);
    assert_eq!(
        client.try_charge(&user),
        Err(Ok(contract_err(ContractError::SubscriptionPaused as u32)))
    );
    advance_to(&env, START + cap);
    client.charge(&user);
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active && !sub.paused);
}

#[test]
fn test_clearing_cap_restores_unlimited_pause() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );

    client.set_max_pause_seconds(&INTERVAL);
    client.set_max_pause_seconds(&0);
    client.pause_until(&user, &(START + 100 * INTERVAL));
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1399: get_merchant_subscribers
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_merchant_subscribers_lists_and_pages() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let users: [Address; 3] =
        core::array::from_fn(|_| funded_subscriber(&env, &contract_id, &token_addr));
    for user in users.iter() {
        client.subscribe(
            user,
            &merchant,
            &AMOUNT,
            &INTERVAL,
            &token_addr,
            &None,
            &None,
        );
    }

    let all = client.get_merchant_subscribers(&merchant, &0, &10);
    assert_eq!(all.len(), 3);
    assert_eq!(
        all.len() as u64,
        client.get_merchant_subscriber_count(&merchant)
    );
    for user in users.iter() {
        assert!(all.contains(user));
    }

    let first = client.get_merchant_subscribers(&merchant, &0, &2);
    let rest = client.get_merchant_subscribers(&merchant, &2, &2);
    assert_eq!(first.len(), 2);
    assert_eq!(rest.len(), 1);
    assert!(!first.contains(rest.get(0).unwrap()));

    assert_eq!(client.get_merchant_subscribers(&merchant, &3, &10).len(), 0);
    assert_eq!(client.get_merchant_subscribers(&merchant, &0, &0).len(), 0);
    assert_eq!(
        client
            .get_merchant_subscribers(&Address::generate(&env), &0, &10)
            .len(),
        0
    );
}

#[test]
fn test_merchant_subscribers_tracks_cancel_and_merchant_switch() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let other_merchant = Address::generate(&env);
    let users: [Address; 3] =
        core::array::from_fn(|_| funded_subscriber(&env, &contract_id, &token_addr));
    for user in users.iter() {
        client.subscribe(
            user,
            &merchant,
            &AMOUNT,
            &INTERVAL,
            &token_addr,
            &None,
            &None,
        );
    }

    // Cancelling the first entry swaps the last one into its slot.
    client.cancel(&users[0]);
    let remaining = client.get_merchant_subscribers(&merchant, &0, &10);
    assert_eq!(remaining.len(), 2);
    assert!(!remaining.contains(&users[0]));
    assert!(remaining.contains(&users[1]) && remaining.contains(&users[2]));

    // Cancelling twice must not disturb the index.
    client.cancel(&users[0]);
    assert_eq!(client.get_merchant_subscribers(&merchant, &0, &10).len(), 2);

    // Re-subscribing to another merchant moves the subscriber between lists.
    client.subscribe(
        &users[1],
        &other_merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );
    let left = client.get_merchant_subscribers(&merchant, &0, &10);
    assert_eq!(left.len(), 1);
    assert_eq!(left.get(0), Some(users[2].clone()));
    assert_eq!(
        client
            .get_merchant_subscribers(&other_merchant, &0, &10)
            .get(0),
        Some(users[1].clone())
    );

    // Re-subscribing to the same merchant does not duplicate the entry.
    client.subscribe(
        &users[2],
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_subscribers(&merchant, &0, &10).len(), 1);
    assert_eq!(client.get_merchant_subscriber_count(&merchant), 1);
}

#[test]
fn test_transfer_moves_terms_and_merchant_index_entry() {
    let (env, contract_id, token_addr, merchant) = limits_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user = funded_subscriber(&env, &contract_id, &token_addr);
    let new_user = funded_subscriber(&env, &contract_id, &token_addr);

    client.subscribe_with_end_conditions(
        &user,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &Some(2u32),
        &None,
    );
    advance_to(&env, START + INTERVAL);
    client.charge(&user);

    client.transfer_subscription(&user, &new_user);

    // The merchant listing follows the subscription.
    let listed = client.get_merchant_subscribers(&merchant, &0, &10);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed.get(0), Some(new_user.clone()));
    assert_eq!(client.get_merchant_subscriber_count(&merchant), 1);

    // So do the end conditions, including the charges already collected.
    assert_eq!(client.get_subscription_terms(&user), None);
    let terms = client.get_subscription_terms(&new_user).unwrap();
    assert_eq!((terms.max_cycles, terms.charges_made), (Some(2), 1));

    advance_to(&env, START + 2 * INTERVAL);
    client.charge(&new_user);
    assert!(!client.get_subscription(&new_user).unwrap().active);
    assert_eq!(client.get_merchant_subscribers(&merchant, &0, &10).len(), 0);
}
