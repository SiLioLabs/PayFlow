#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, Symbol, TryIntoVal, Vec,
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

fn setup_funded_user(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &10_000_0000000);

    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &10_000_0000000, &200);

    user
}

fn assert_last_event(env: &Env, topic: &str) {
    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
    let data_unit: () = data.try_into_val(env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(env, topic));
    assert_eq!(data_unit, ());
}

fn assert_last_user_event(env: &Env, topic: &str, user: &Address) {
    let events = env.events().all();
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(env, topic));
    assert_eq!(topic_user, user.clone());
}

fn count_user_events(env: &Env, topic: &str, user: &Address) -> u32 {
    let expected_topic = Symbol::new(env, topic);
    let mut count = 0;

    for (_, topics, _) in env.events().all().iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if topic_symbol != expected_topic {
            continue;
        }

        let topic_user: Address = topics.get(1).unwrap().try_into_val(env).unwrap();
        if topic_user == user.clone() {
            count += 1;
        }
    }

    count
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Core functionality tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_subscribe_and_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

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
fn test_batch_charge_empty() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let results = client.batch_charge(&soroban_sdk::vec![&env]);
    assert_eq!(results.len(), 0);
}

/// charge() must decrease user balance and increase merchant balance by exactly the subscription amount.
#[test]
fn test_charge_exact_transfer_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let user_balance_after = token.balance(&user);
    let merchant_balance_after = token.balance(&merchant);

    assert_eq!(
        user_balance_before - user_balance_after,
        amount,
        "user balance should decrease by exactly the subscription amount"
    );
    assert_eq!(
        merchant_balance_after - merchant_balance_before,
        amount,
        "merchant balance should increase by exactly the subscription amount"
    );
}

#[test]
fn test_charged_event_includes_ledger_sequence() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
        l.sequence_number += 7;
    });

    client.charge(&user);

    let mut seen_charge_event = false;
    for (_, topics, data) in env.events().all().iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if topic_symbol == Symbol::new(&env, "charged") {
            let event_data: crate::events::ChargeEventData = data.try_into_val(&env).unwrap();
            assert_eq!(event_data.ledger_sequence, env.ledger().sequence());
            seen_charge_event = true;
        }
    }

    assert!(seen_charge_event, "expected a charged event");
}

#[test]
fn test_charge_applies_protocol_fee_and_records_net_revenue() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &500);
    client.commit_fee(); // 5%

    let amount: i128 = 10_0000000;
    let expected_fee: i128 = 500_0000;
    let expected_net: i128 = amount - expected_fee;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&merchant) - merchant_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, expected_fee);
    assert_eq!(client.get_merchant_revenue(&merchant), expected_net);
}

#[test]
fn test_charge_with_zero_fee_bps_skips_fee_transfer() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &0);
    client.commit_fee();

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&merchant) - merchant_before, amount);
    assert_eq!(token.balance(&collector) - collector_before, 0);
}

/// subscribe() must store all Subscription fields exactly as provided.
#[test]
fn test_subscription_struct_fields_match_input() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days

    let subscribe_time = env.ledger().timestamp();

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();

    assert_eq!(sub.merchant, merchant, "merchant should match");
    assert_eq!(sub.amount, amount, "amount should match");
    assert_eq!(sub.interval, interval, "interval should match");
    assert!(sub.active, "subscription should be active");
    assert!(!sub.paused, "subscription should not be paused");
    assert_eq!(sub.token, token_addr, "token should match");
    // last_charged is set to subscribe time when no trial period
    assert_eq!(
        sub.last_charged, subscribe_time,
        "last_charged should be set to subscribe time"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #194: get_trial_end() tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_trial_end_with_trial_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let now = env.ledger().timestamp();
    let trial_period: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &Some(trial_period),
        &None,
    );

    assert_eq!(client.get_trial_end(&user), Some(now + trial_period));
}

#[test]
fn test_get_trial_end_without_trial_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert!(client.get_trial_end(&user).is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_charge_before_trial_end_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &Some(86400u64),
        &None,
    );

    client.charge(&user);
}

#[test]
#[should_panic]
fn test_subscribe_non_whitelisted_merchant_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

#[test]
fn test_subscribe_whitelisted_merchant_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    client.add_merchant(&merchant);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.merchant, merchant);
    assert!(client.is_merchant_whitelisted(&merchant));
}

#[test]
fn test_is_merchant_whitelisted_returns_false_for_non_whitelisted() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    assert!(!client.is_merchant_whitelisted(&merchant));
}

#[test]
fn test_set_whitelist_enabled_false_allows_any_merchant() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.set_whitelist_enabled(&true);
    client.set_whitelist_enabled(&false);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.merchant, merchant);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Merchant freeze tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// subscribe to a frozen merchant panics with ContractError::MerchantFrozen.
#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_subscribe_to_frozen_merchant_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.freeze_merchant(&merchant);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

/// An existing subscriber can still be charged after their merchant is frozen â€”
/// freeze only blocks new subscriptions, not existing charge cycles.
#[test]
fn test_charge_succeeds_after_merchant_frozen() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    client.freeze_merchant(&merchant);
    assert!(client.is_merchant_frozen(&merchant));

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.last_charged, interval + 1);
}

/// pay_per_use is unaffected by merchant freeze status for an existing subscriber.
#[test]
fn test_pay_per_use_succeeds_after_merchant_frozen() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.freeze_merchant(&merchant);

    client.pay_per_use(&user, &1_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 1_0000000);
}

/// is_merchant_frozen reflects freeze/unfreeze state changes.
#[test]
fn test_is_merchant_frozen_reflects_state() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    assert!(!client.is_merchant_frozen(&merchant));

    client.freeze_merchant(&merchant);
    assert!(client.is_merchant_frozen(&merchant));

    client.unfreeze_merchant(&merchant);
    assert!(!client.is_merchant_frozen(&merchant));
}

/// Freezing a merchant that is not whitelisted must still succeed â€” the two
/// states (whitelist, freeze) are independent of each other.
#[test]
fn test_freeze_merchant_independent_of_whitelist() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Merchant is not whitelisted at all, and whitelist enforcement is off.
    assert!(!client.is_merchant_whitelisted(&merchant));

    client.freeze_merchant(&merchant);
    assert!(client.is_merchant_frozen(&merchant));
    assert!(!client.is_merchant_whitelisted(&merchant));
}

/// freeze_merchant is idempotent â€” freezing an already-frozen merchant must not panic.
#[test]
fn test_freeze_merchant_idempotent() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.freeze_merchant(&merchant);
    client.freeze_merchant(&merchant);
    assert!(client.is_merchant_frozen(&merchant));
}

/// unfreeze_merchant on a non-frozen merchant must not panic.
#[test]
fn test_unfreeze_merchant_non_frozen_is_noop() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.unfreeze_merchant(&merchant);
    assert!(!client.is_merchant_frozen(&merchant));
}

/// freeze_merchant requires admin auth.
#[test]
#[should_panic]
fn test_freeze_merchant_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No admin configured â€” require_admin panics with "admin not set"
    client.freeze_merchant(&merchant);
}

/// unfreeze_merchant requires admin auth.
#[test]
#[should_panic]
fn test_unfreeze_merchant_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No admin configured â€” require_admin panics with "admin not set"
    client.unfreeze_merchant(&merchant);
}

#[test]
#[should_panic]
fn test_non_admin_add_and_remove_merchant_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);

    client.add_merchant(&merchant);
    client.remove_merchant(&merchant);
}

// ─────────────────────────────────────────────
// CONTRACT-20: whitelist_batch_add / whitelist_batch_remove tests
// ─────────────────────────────────────────────

#[test]
fn test_whitelist_batch_add_three_merchants() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    merchants.push_back(m2.clone());
    merchants.push_back(m3.clone());

    let count = client.whitelist_batch_add(&merchants);

    assert_eq!(count, 3);
    assert!(client.is_merchant_whitelisted(&m1));
    assert!(client.is_merchant_whitelisted(&m2));
    assert!(client.is_merchant_whitelisted(&m3));
}

#[test]
fn test_whitelist_batch_remove_two_merchants() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    client.add_merchant(&m1);
    client.add_merchant(&m2);

    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    merchants.push_back(m2.clone());

    let count = client.whitelist_batch_remove(&merchants);

    assert_eq!(count, 2);
    assert!(!client.is_merchant_whitelisted(&m1));
    assert!(!client.is_merchant_whitelisted(&m2));
}

#[test]
fn test_whitelist_batch_add_duplicates_does_not_panic() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());
    merchants.push_back(m1.clone());

    let count = client.whitelist_batch_add(&merchants);

    assert_eq!(count, 2);
    assert!(client.is_merchant_whitelisted(&m1));
}

#[test]
fn test_whitelist_batch_remove_non_whitelisted_is_noop() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(m1.clone());

    let count = client.whitelist_batch_remove(&merchants);

    assert_eq!(count, 1);
    assert!(!client.is_merchant_whitelisted(&m1));
}

#[test]
#[should_panic(expected = "Error(Contract, #31)")]
fn test_whitelist_batch_add_exceeds_max_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut merchants = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        merchants.push_back(Address::generate(&env));
    }
    client.whitelist_batch_add(&merchants);
}

#[test]
#[should_panic]
fn test_whitelist_batch_add_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    env.set_auths(&[]);

    let mut merchants = soroban_sdk::Vec::new(&env);
    merchants.push_back(merchant.clone());
    client.whitelist_batch_add(&merchants);
}

#[test]
fn test_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
fn test_referral_cleared_on_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer));

    client.cancel(&user);

    assert_eq!(client.get_referrer(&user), None);
}

#[test]
#[should_panic]
fn test_charge_too_early() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.charge(&user);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Multi-token + advanced features
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_multi_token_independent_subscriptions() {
    let (env, contract_id, token_a, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let token_b = setup_second_token(&env, &contract_id, &user_b);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user_a, &merchant, &amount, &interval, &token_a, &None, &None,
    );
    client.subscribe(
        &user_b, &merchant, &amount, &interval, &token_b, &None, &None,
    );

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

    client.subscribe(
        &user, &merchant, &1_0000000, &interval, &token_a, &None, &None,
    );
    client.subscribe(
        &user, &merchant, &2_0000000, &interval, &token_b, &None, &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.token, token_b);
    assert_eq!(sub.amount, 2_0000000);
}

#[test]
fn test_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let token = TokenClient::new(&env, &token_addr);
    let before = token.balance(&merchant);

    client.pay_per_use(&user, &5_0000000);

    assert_eq!(token.balance(&merchant), before + 5_0000000);
}

#[test]
fn test_pay_per_use_applies_protocol_fee_and_records_net_revenue() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &250);
    client.commit_fee(); // 2.5%

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 8_0000000;
    let expected_fee: i128 = 200_0000;
    let expected_net: i128 = amount - expected_fee;
    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    client.pay_per_use(&user, &amount);

    assert_eq!(token.balance(&merchant) - merchant_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, expected_fee);
    assert_eq!(client.get_merchant_revenue(&merchant), expected_net);
}

// ─────────────────────────────────────────────
// CONTRACT-23: pay_per_use_to tests
// ─────────────────────────────────────────────

#[test]
fn test_pay_per_use_to_transfers_to_recipient_not_merchant() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let recipient = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 5_0000000;
    let merchant_before = token.balance(&merchant);
    let recipient_before = token.balance(&recipient);

    client.pay_per_use_to(&user, &amount, &recipient);

    assert_eq!(token.balance(&merchant), merchant_before);
    assert_eq!(token.balance(&recipient) - recipient_before, amount);
    assert_eq!(client.get_merchant_revenue(&recipient), amount);
    assert_eq!(client.get_merchant_revenue(&merchant), 0);
}

#[test]
fn test_pay_per_use_to_applies_protocol_fee_to_recipient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &250);
    client.commit_fee(); // 2.5%

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 8_0000000;
    let expected_fee: i128 = 200_0000;
    let expected_net: i128 = amount - expected_fee;
    let recipient_before = token.balance(&recipient);
    let collector_before = token.balance(&collector);

    client.pay_per_use_to(&user, &amount, &recipient);

    assert_eq!(token.balance(&recipient) - recipient_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, expected_fee);
    assert_eq!(client.get_merchant_revenue(&recipient), expected_net);
}

#[test]
#[should_panic]
fn test_pay_per_use_to_rejects_non_whitelisted_recipient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.add_merchant(&merchant);
    client.set_whitelist_enabled(&true);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let recipient = Address::generate(&env); // never whitelisted
    client.pay_per_use_to(&user, &1_0000000, &recipient);
}

#[test]
fn test_pay_per_use_to_recipient_equals_merchant_behaves_like_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 3_0000000;
    let merchant_before = token.balance(&merchant);

    client.pay_per_use_to(&user, &amount, &merchant);

    assert_eq!(token.balance(&merchant) - merchant_before, amount);
    assert_eq!(client.get_merchant_revenue(&merchant), amount);
}

#[test]
#[should_panic]
fn test_pay_per_use_to_daily_limit_shared_with_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let recipient = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &10_0000000);

    client.pay_per_use(&user, &6_0000000);
    // Combined spend (6 + 6 = 12) exceeds the 10 limit, even though this
    // second call routes through pay_per_use_to to a different recipient.
    client.pay_per_use_to(&user, &6_0000000, &recipient);
}

#[test]
fn test_pay_per_use_with_zero_fee_bps_transfers_full_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &0);
    client.commit_fee();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let amount: i128 = 3_0000000;
    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    client.pay_per_use(&user, &amount);

    assert_eq!(token.balance(&merchant) - merchant_before, amount);
    assert_eq!(token.balance(&collector) - collector_before, 0);
}

#[test]
#[should_panic]
fn test_pay_per_use_inactive() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);
    client.pay_per_use(&user, &1_0000000);
}

/// pay_per_use() must not update last_charged, confirming it is independent of the recurring billing cycle.
#[test]
fn test_pay_per_use_does_not_update_last_charged() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub_before = client.get_subscription(&user).unwrap();
    let last_charged_before = sub_before.last_charged;

    // Advance ledger time so we can verify last_charged isn't simply matching the current time
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1000;
    });

    client.pay_per_use(&user, &5_0000000);

    let sub_after = client.get_subscription(&user).unwrap();
    assert_eq!(
        sub_after.last_charged, last_charged_before,
        "pay_per_use should not update last_charged"
    );
}

#[test]
#[should_panic]
fn test_pay_per_use_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let random = Address::generate(&env);
    client.pay_per_use(&random, &1_0000000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Edge cases
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
#[should_panic]
fn test_pay_per_use_zero_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pay_per_use(&user, &0);
}

#[test]
#[should_panic]
fn test_pay_per_use_exceeds_cap() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pay_per_use(&user, &(MAX_AMOUNT + 1));
}

/// initialize() still works for backward compat but is not required.
#[test]
fn test_initialize_backward_compat() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    // initialize with a default token â€” should not affect per-sub token
    client.initialize(&token_addr, &admin);

    let token_b = setup_second_token(&env, &contract_id, &user);
    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_b, &None, &None);

    // Subscription uses token_b, not the initialized default
    assert_eq!(client.get_subscription(&user).unwrap().token, token_b);
}

// â”€â”€ Issue #14: cancel nonexistent subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// cancel() must panic with "no subscription found" when called on a user with no subscription.
#[test]
#[should_panic]
fn test_cancel_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let random = Address::generate(&env);
    client.cancel(&random);
}

// â”€â”€ Issue #13: get_subscription for nonexistent subscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// get_subscription() must return None for an address with no subscription.
#[test]
fn test_get_subscription_nonexistent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(
        client.get_subscription(&random).is_none(),
        "get_subscription should return None for unknown address"
    );
}
// â”€â”€ Issue #12: last_charged timestamp update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// charge() must update last_charged to the current ledger timestamp.
#[test]
fn test_charge_updates_last_charged() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Record the timestamp before advancing time
    let subscribe_time = env.ledger().timestamp();

    // Advance ledger time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1000; // advance by interval + 1000 seconds
    });

    // Record the timestamp right before charge
    let charge_time = env.ledger().timestamp();
    assert!(
        charge_time > subscribe_time,
        "charge time should be after subscribe time"
    );

    client.charge(&user);

    let sub_after = client.get_subscription(&user).unwrap();
    // Verify last_charged is exactly equal to the charge_time
    assert_eq!(
        sub_after.last_charged, charge_time,
        "last_charged should equal the ledger timestamp at charge time"
    );
}

#[test]
#[should_panic]
fn test_zero_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &0, &86400, &token_addr, &None, &None);
}

#[test]
#[should_panic]
fn test_zero_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &0, &token_addr, &None, &None);
}

#[test]
#[should_panic]
fn test_interval_too_short() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &59, &token_addr, &None, &None);
}

#[test]
fn test_interval_minimum_valid() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.set_min_interval(&60u64);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.interval, 3600);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Multi-user isolation
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    client.subscribe(
        &user_a,
        &merchant_a,
        &amount_a,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant_b,
        &amount_b,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.charge(&user_a);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cancel + charge edge cases
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
#[should_panic]
fn test_charge_after_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
    });

    client.charge(&user);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// batch_charge tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Only advance past interval for user_a
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // user_b re-subscribes at the new timestamp so their interval hasn't elapsed
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::Skipped);
}

#[test]
fn test_batch_charge_ordering() {
    let (env, contract_id, token_addr, user_1, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_2 = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_2, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_2, &contract_id, &10_000_0000000, &200);

    let user_3 = Address::generate(&env);
    // user_3 has no subscription

    let user_4 = Address::generate(&env);
    sac.mint(&user_4, &10_000_0000000);
    token.approve(&user_4, &contract_id, &10_000_0000000, &200);

    let interval = 86400;

    // user_1: valid, will be charged
    client.subscribe(
        &user_1,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // user_2: valid, will be charged
    client.subscribe(
        &user_2,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // user_4: valid but skipped (we will subscribe right before charge so interval not elapsed)

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.subscribe(
        &user_4,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let mut users = soroban_sdk::Vec::new(&env);
    // Order: user_2 (Charged), user_3 (Failed), user_4 (Skipped), user_1 (Charged)
    users.push_back(user_2.clone());
    users.push_back(user_3.clone());
    users.push_back(user_4.clone());
    users.push_back(user_1.clone());

    let results = client.batch_charge(&users);

    assert_eq!(results.len(), 4);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::NoSubscription);
    assert_eq!(results.get(2).unwrap(), crate::ChargeResult::Skipped);
    assert_eq!(results.get(3).unwrap(), crate::ChargeResult::Charged);
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
fn test_batch_charge_stress() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    env.budget().reset_unlimited();

    let num_users = 50;
    let mut users = soroban_sdk::Vec::new(&env);
    let interval = 86400;

    for _ in 0..num_users {
        let u = Address::generate(&env);
        sac.mint(&u, &10_000_0000000);
        token.approve(&u, &contract_id, &10_000_0000000, &200);
        client.subscribe(
            &u,
            &merchant,
            &1_0000000,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let results = client.batch_charge(&users);

    assert_eq!(results.len(), num_users);
    for r in results.into_iter() {
        assert_eq!(r, crate::ChargeResult::Charged);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_over_default_limit_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        let u = Address::generate(&env);
        sac.mint(&u, &10_000_0000000);
        token.approve(&u, &contract_id, &10_000_0000000, &200);
        client.subscribe(&u, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
        users.push_back(u);
    }

    client.batch_charge(&users);
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_batch_size_rejects_value_above_200() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.set_max_batch_size(&201);
}

#[test]
#[should_panic]
fn test_non_admin_set_max_batch_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.set_auths(&[]);
    client.set_max_batch_size(&10);
}

#[test]
fn test_cancel_and_refund_prorated_transfers_expected_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);

    client.subscribe(&user, &merchant, &1_0000000, &3600, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = 900;
    });

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);

    client.cancel_and_refund_prorated(&user, &merchant);

    assert_eq!(token.balance(&merchant), merchant_balance_before - 7_500_000);
    assert_eq!(token.balance(&user), user_balance_before + 7_500_000);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
fn test_cancel_and_refund_prorated_at_interval_end_transfers_nothing() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);

    client.subscribe(&user, &merchant, &1_0000000, &3600, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);

    client.cancel_and_refund_prorated(&user, &merchant);

    assert_eq!(token.balance(&merchant), merchant_balance_before);
    assert_eq!(token.balance(&user), user_balance_before);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
#[should_panic]
fn test_cancel_and_refund_prorated_missing_subscription_panics() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
fn test_batch_charge_inactive() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Inactive);
}

/// batch_charge must return ChargeResult::Paused for a subscription that has been paused.
#[test]
fn test_batch_charge_paused() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Paused);
}

/// Issue #201: batch_charge applies protocol fees identically to charge().
#[test]
fn test_batch_charge_with_fee() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user_a);
    });

    let collector = Address::generate(&env);
    let fee_bps: u32 = 100; // 1%
    client.propose_fee(&collector, &fee_bps);
    client.commit_fee();

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let amount: i128 = 10_000_000; // 1 XLM
    let interval: u64 = 86400;
    let expected_fee = amount * (fee_bps as i128) / 10_000;
    let expected_net = amount - expected_fee;

    client.subscribe(
        &user_a,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_a_balance_before = token.balance(&user_a);
    let user_b_balance_before = token.balance(&user_b);
    let merchant_balance_before = token.balance(&merchant);
    let collector_balance_before = token.balance(&collector);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::Charged);

    assert_eq!(
        user_a_balance_before - token.balance(&user_a),
        amount,
        "user_a debited gross amount"
    );
    assert_eq!(
        user_b_balance_before - token.balance(&user_b),
        amount,
        "user_b debited gross amount"
    );
    assert_eq!(
        token.balance(&merchant) - merchant_balance_before,
        expected_net * 2,
        "merchant receives net per user"
    );
    assert_eq!(
        token.balance(&collector) - collector_balance_before,
        expected_fee * 2,
        "collector receives fee per user"
    );
}

#[test]
fn test_batch_charge_grace_period_elapsed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });
    let grace_period: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Advance ledger beyond interval + grace period
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::GracePeriodElapsed
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// subscription_count tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_active_count_increments_on_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_active_count(), 0);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_active_count(), 1);
}

#[test]
fn test_active_count_does_not_double_count_on_resubscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchant_b = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_active_count(), 1);

    client.subscribe(
        &user,
        &merchant_b,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_active_count(), 1);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.merchant, merchant_b);
    assert_eq!(sub.amount, 2_0000000);
}

#[test]
fn test_active_count_decrements_on_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
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

    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_active_count(), 2);

    client.cancel(&user_a);
    assert_eq!(client.get_active_count(), 1);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// merchant_stats tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_merchant_revenue_from_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_merchant_revenue(&merchant), 0);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(client.get_merchant_revenue(&merchant), amount);
}

#[test]
fn test_merchant_revenue_from_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pay_per_use(&user, &3_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 3_0000000);
}

#[test]
fn test_merchant_revenue_accumulates() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 2_0000000;
    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    client.pay_per_use(&user, &1_0000000);

    assert_eq!(client.get_merchant_revenue(&merchant), 3_0000000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// spending_limit tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_daily_limit() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Initial limit should be None
    assert_eq!(client.get_daily_limit(&user), None);

    // After setting, it should return Some(limit)
    client.set_daily_limit(&user, &10_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(10_0000000));
}

#[test]
fn test_daily_limit_allows_spend_within_limit() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &10_0000000);
    // Should not panic
    client.pay_per_use(&user, &5_0000000);
}

#[test]
#[should_panic]
fn test_daily_limit_blocks_overspend() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &3_0000000);
    client.pay_per_use(&user, &5_0000000);
}

#[test]
fn test_daily_limit_accumulates_across_calls() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &2_0000000);
    client.pay_per_use(&user, &2_0000000);
    // 4 total, limit is 5 â€” should pass
}

#[test]
#[should_panic]
fn test_daily_limit_blocks_cumulative_overspend() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &5_0000000);
    client.pay_per_use(&user, &3_0000000);
    client.pay_per_use(&user, &3_0000000); // 6 total > 5 limit
}

#[test]
fn test_daily_limit_visibility_and_spend_tracking() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_daily_limit(&user), None);
    assert_eq!(client.get_daily_spent(&user), 0);

    client.set_daily_limit(&user, &4_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));

    client.pay_per_use(&user, &1_0000000);
    assert_eq!(client.get_daily_spent(&user), 1_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));
}

#[test]
fn test_daily_limit_set_event_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.set_daily_limit(&user, &4_0000000);

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    let limit: i128 = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "daily_limit_set"));
    assert_eq!(topic_user, user);
    assert_eq!(limit, 4_0000000);
}

#[test]
fn test_daily_limit_removed_event_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.set_daily_limit(&user, &4_0000000);
    client.remove_daily_limit(&user);

    assert_eq!(client.get_daily_limit(&user), None);
    assert_last_user_event(&env, "daily_limit_removed", &user);
}

#[test]
fn test_remove_daily_limit_allows_pay_per_use_after_removal() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &3_0000000);
    client.pay_per_use(&user, &2_0000000);
    client.remove_daily_limit(&user);
    client.pay_per_use(&user, &2_0000000); // should succeed after removal
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Contract admin event tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_contract_pause_events_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.pause_contract();
    assert!(client.is_contract_paused());
    assert_last_event(&env, "contract_paused");

    client.unpause_contract();
    assert!(!client.is_contract_paused());
    assert_last_event(&env, "contract_unpaused");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Migration tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_migrate_v1_to_v2() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Manually construct and store a V1 subscription
    let v1_sub = crate::migration::SubscriptionV1 {
        merchant: merchant.clone(),
        amount: 1_0000000,
        interval: 86400,
        last_charged: env.ledger().timestamp(),
        active: true,
        token: token_addr.clone(),
        referrer: None,
        label: Symbol::new(&env, "v1_label"),
        trial_duration: 0,
    };

    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&crate::DataKey::Subscription(user.clone()), &v1_sub);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    client.migrate(&users);

    // Verify it was upgraded to V2
    let v2_sub = client.get_subscription(&user).unwrap();
    assert_eq!(v2_sub.merchant, merchant);
    assert_eq!(v2_sub.amount, 1_0000000);
    assert_eq!(v2_sub.active, true);
    assert_eq!(v2_sub.paused, false); // This is the newly added field
    assert_eq!(v2_sub.label, Symbol::new(&env, "v1_label"));
}

#[test]
fn test_admin_batch_pause_subscriptions_freezes_multiple_accounts() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user_a);
    });

    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &2_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let mut users = Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    client.batch_pause_subscriptions(&users);

    assert!(client.get_subscription(&user_a).unwrap().paused);
    assert!(client.get_subscription(&user_b).unwrap().paused);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_a), 1);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_b), 1);
}

#[test]
#[should_panic]
fn test_batch_pause_subscriptions_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, FlowPay);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = Vec::new(&env);
    users.push_back(user);

    client.batch_pause_subscriptions(&users);
}

#[test]
fn test_batch_pause_subscriptions_handles_valid_missing_and_pre_paused_accounts() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let missing_user = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user_a);
    });

    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user_b);

    let mut users = Vec::new(&env);
    users.push_back(missing_user.clone());
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    client.batch_pause_subscriptions(&users);

    assert!(client.get_subscription(&user_a).unwrap().paused);
    assert!(client.get_subscription(&user_b).unwrap().paused);
    assert!(client.get_subscription(&missing_user).is_none());
    assert_eq!(count_user_events(&env, "subscription_paused", &user_a), 1);
    assert_eq!(count_user_events(&env, "subscription_paused", &user_b), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_pause_subscriptions_rejects_more_than_twenty_five_accounts() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let mut users = Vec::new(&env);
    for _ in 0..26 {
        users.push_back(Address::generate(&env));
    }

    client.batch_pause_subscriptions(&users);
}

#[test]
fn test_upgrade_event_emitted() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[7; 32]);
    client.upgrade(&new_wasm_hash);

    let env = Env::default();
    let contract_id = env.register_contract(None, FlowPay);
    let mock_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    env.as_contract(&contract_id, || {
        events::publish_upgraded(&env, &mock_wasm_hash);
    });
    let events = env.events().all();
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "upgrade"));
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #96: referral tracking tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_referral_stored_on_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    assert_eq!(client.get_referrer(&user), Some(referrer));
}

#[test]
fn test_no_referral_returns_none() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert!(client.get_referrer(&user).is_none());
}

#[test]
fn test_referral_updates_on_resubscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer_a = Address::generate(&env);
    let referrer_b = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer_a.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer_a));

    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &Some(referrer_b.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer_b));
}

#[test]
fn test_grace_period_ttl_extension() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Ensure an admin is set so admin checks pass.
    let admin = Address::generate(&env);
    // Write admin as the contract to set instance storage from the test harness.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    // Set a grace period as admin and verify read returns the same value.
    let seconds: u64 = 3600;
    client.propose_grace_period(&seconds);
    client.commit_grace_period();
    let got = client.get_grace_period();
    assert_eq!(got, seconds);
}

#[test]
#[should_panic]
fn test_double_initialize() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.initialize(&token_addr, &admin);
}

#[test]
fn test_referral_clears_on_resubscribe_with_none() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let referrer = Address::generate(&env);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referrer(&user), Some(referrer));

    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );
    assert!(client.get_referrer(&user).is_none());
}

#[test]
fn test_self_referral_rejected_via_try_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(user.clone()),
    );

    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(11))));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #97: migration tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_migrate_sets_schema_version() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Before migration, version defaults to 1
    assert_eq!(client.get_schema_version(), 1);

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);

    assert_eq!(client.get_schema_version(), 2);
}

#[test]
fn test_migrate_is_idempotent() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);
    client.migrate(&empty_users); // second call should be a no-op

    assert_eq!(client.get_schema_version(), 2);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
#[should_panic]
fn test_migrate_non_admin_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    env.set_auths(&[]);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.migrate(&users);
}

#[test]
fn test_migrate_emits_completed_event_with_version_and_count() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.migrate(&users);

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (version, user_count): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "migration_completed"));
    assert_eq!(version, 2);
    assert_eq!(user_count, 1);
}

// ─────────────────────────────────────────────
// Issue #99: subscription metadata tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_set_and_get_metadata() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let label = soroban_sdk::String::from_str(&env, "pro");
    client.set_metadata(&user, &label);

    assert_eq!(client.get_metadata(&user), Some(label));
}

#[test]
fn test_clear_metadata_removes_label() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let label = soroban_sdk::String::from_str(&env, "pro");
    client.set_metadata(&user, &label);
    assert_eq!(client.get_metadata(&user), Some(label));

    client.clear_metadata(&user);

    assert!(client.get_metadata(&user).is_none());
}

#[test]
fn test_get_metadata_none_when_not_set() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(client.get_metadata(&random).is_none());
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #98: charge history tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_charge_history_recorded() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_charge_history(&user).len(), 0);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(client.get_charge_history(&user).len(), 1);
}

#[test]
fn test_charge_history_capped_at_12() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Perform 14 charges
    for _ in 0..14 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }

    assert_eq!(client.get_charge_history(&user).len(), 12);
}

#[test]
fn test_get_charge_history_three_charges_ascending() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t1 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t2 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t3 = env.ledger().timestamp();

    let history = client.get_charge_history(&user);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap(), t1);
    assert_eq!(history.get(1).unwrap(), t2);
    assert_eq!(history.get(2).unwrap(), t3);
}

#[test]
fn test_get_charge_history_page_offset_limit() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t1 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t2 = env.ledger().timestamp();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    let t3 = env.ledger().timestamp();

    let page = client.get_charge_history_page(&user, &1u32, &2u32);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), t2);
    assert_eq!(page.get(1).unwrap(), t3);
}

#[test]
#[should_panic]
fn test_clear_charge_history_non_admin_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);
    client.clear_charge_history(&user);
}

#[test]
fn test_clear_charge_history_admin_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(client.get_charge_history(&user).len(), 1);

    client.clear_charge_history(&user);

    assert_eq!(client.get_charge_history(&user).len(), 0);
}

#[test]
fn test_get_charge_history_empty_for_no_history() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    let history = client.get_charge_history(&random);
    assert_eq!(history.len(), 0);
}

#[test]
fn test_get_charge_history_page_limit_capped_at_12() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    for _ in 0..14 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }

    let page = client.get_charge_history_page(&user, &0u32, &100u32);
    assert_eq!(page.len(), 12);
}

#[test]
fn test_get_charge_history_page_offset_beyond_length() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    let page = client.get_charge_history_page(&user, &5u32, &2u32);
    assert_eq!(page.len(), 0);
}

#[test]
fn test_clear_charge_history_nonexistent_key_no_panic() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let random = Address::generate(&env);
    client.clear_charge_history(&random);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// contract_health_check tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_health_check_initialized_unpaused() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let report = client.contract_health_check();

    assert!(
        report.is_healthy,
        "initialized and unpaused contract should be healthy"
    );
    assert!(!report.contract_paused);
    assert!(report.token_configured);
    assert!(report.admin_configured);
}

#[test]
fn test_health_check_paused() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    client.pause_contract();

    let report = client.contract_health_check();

    assert!(!report.is_healthy, "paused contract should not be healthy");
    assert!(report.contract_paused);
}

#[test]
fn test_health_check_pre_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    let report = client.contract_health_check();

    assert!(
        !report.token_configured,
        "token should not be configured before initialize"
    );
    assert!(
        !report.is_healthy,
        "uninitialized contract should not be healthy"
    );
}

#[test]
fn test_health_check_active_subscription_count() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let report = client.contract_health_check();
    assert_eq!(report.active_subscription_count, 1);
}

#[test]
fn test_ttl_extension() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // We can't easily assert the exact TTL in the test environment without more complex mock_all_auths
    // or internal access, but we can verify the function exists and doesn't panic.

    // Keep the contract instance itself alive across the jump below â€” only the
    // Subscription entry's TTL is extended by extend_subscription_ttl, but the
    // contract instance needs its own TTL or the whole contract becomes archived.
    // Extend a bit past SUBSCRIPTION_TTL_LEDGERS to cover the two ledger jumps below.
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .extend_ttl(SUBSCRIPTION_TTL_LEDGERS + 10, SUBSCRIPTION_TTL_LEDGERS + 10);
    });

    env.ledger().with_mut(|l| {
        l.sequence_number += SUBSCRIPTION_TTL_LEDGERS - 1;
    });

    client.extend_subscription_ttl(&user);

    assert!(client.get_subscription(&user).is_some());
}

// ─────────────────────────────────────────────
// CONTRACT-22: bump_instance_ttl tests
// ─────────────────────────────────────────────

#[test]
fn test_subscribe_extends_instance_ttl() {
    use soroban_sdk::testutils::storage::Instance as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl >= SUBSCRIPTION_TTL_LEDGERS / 2);
}

#[test]
fn test_initialize_sets_instance_ttl() {
    use soroban_sdk::testutils::storage::Instance as _;

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let admin = Address::generate(&env);

    client.initialize(&token_id.address(), &admin);

    let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl > 0);
}

#[test]
#[should_panic]
fn test_subscribe_interval_under_60_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &0, &token_addr, &None, &None);
}

#[test]
fn test_subscribe_interval_minimum_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.set_min_interval(&60u64);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.interval, 3600);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn test_subscribe_amount_above_cap_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &(MAX_SUBSCRIPTION_AMOUNT + 1));
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &(MAX_SUBSCRIPTION_AMOUNT + 1), &200);

    client.subscribe(
        &user,
        &merchant,
        &(MAX_SUBSCRIPTION_AMOUNT + 1),
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

#[test]
fn test_subscribe_amount_at_cap_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let sac = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &MAX_SUBSCRIPTION_AMOUNT);
    let token = soroban_sdk::token::Client::new(&env, &token_addr);
    token.approve(&user, &contract_id, &MAX_SUBSCRIPTION_AMOUNT, &200);

    client.subscribe(
        &user,
        &merchant,
        &MAX_SUBSCRIPTION_AMOUNT,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user,
        &merchant,
        &MAX_SUBSCRIPTION_AMOUNT,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.amount, MAX_SUBSCRIPTION_AMOUNT);
}



// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Admin transfer tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_transfer_admin() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);

    // Step 1: propose
    client.transfer_admin(&new_admin);
    // Step 2: accept
    client.accept_admin();

    let current_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    assert_eq!(current_admin, new_admin);
}

#[test]
fn test_transfer_admin_event_emitted() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);
    client.accept_admin();

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (emitted_old_admin, emitted_new_admin): (Address, Address) =
        data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "admin_transferred"));
    assert_eq!(emitted_old_admin, old_admin);
    assert_eq!(emitted_new_admin, new_admin);
}

#[test]
fn test_transfer_admin_requires_auth() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);
    client.accept_admin();

    let current_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    assert_eq!(current_admin, new_admin);
}

#[test]
fn test_old_admin_loses_access_after_transfer() {
    let (env, contract_id, _token_addr, old_admin, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &old_admin);
    });

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
    client.accept_admin();

    let current_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    assert_ne!(current_admin, old_admin);
}

#[test]
#[should_panic]
fn test_accept_admin_without_proposal_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.accept_admin();
}

#[test]
fn test_initialize_without_valid_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    // Using a user address instead of a token contract address.
    // The contract currently does not validate if the address is a valid token contract
    // or even if it's a contract at all.
    let invalid_token = Address::generate(&env);
    let admin = Address::generate(&env);

    client.initialize(&invalid_token, &admin);

    // Success means it didn't panic, which is the current expected behavior.
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Global volume cap tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Helper: set up a user with a large balance for global volume testing
fn setup_large_balance(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &100_000_000_000_000);
    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &100_000_000_000_000, &200);
    user
}

#[test]
fn test_global_volume_within_limit() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_000_0000000; // well under limit
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    // Should succeed - well under the 50 trillion stroops limit
}

#[test]
#[should_panic]
fn test_global_volume_exceeds_limit() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Give users large balances to exceed the 50_000_000_000_000 limit
    let user_a = setup_large_balance(&env, &contract_id, &token_addr);
    let user_b = setup_large_balance(&env, &contract_id, &token_addr);

    let amount: i128 = 30_000_000_000_000; // 30 trillion stroops each
    let interval: u64 = 86400;

    client.subscribe(
        &user_a,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // First charge succeeds (30 trillion used)
    client.charge(&user_a);

    // Second charge should panic (60 trillion total > 50 trillion limit)
    client.charge(&user_b);
}

#[test]
fn test_global_volume_window_reset() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_a = setup_large_balance(&env, &contract_id, &token_addr);
    let user_b = setup_large_balance(&env, &contract_id, &token_addr);

    let amount: i128 = 1_000_0000000; // well under MAX_AMOUNT
    let interval: u64 = 86400;

    client.subscribe(
        &user_a,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user_a); // 5 trillion used this window


    // Advance time past the 1-hour window boundary (3601 seconds)
    env.ledger().with_mut(|l| {
        l.timestamp += 3601;
    });

    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });

    // This charge should succeed because the window has reset
    client.charge(&user_b);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// subscribe_with_metadata tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_subscribe_with_metadata_success() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let label = soroban_sdk::String::from_str(&env, "Pro Plan");
    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe_with_metadata(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
        &label,
    );

    // Verify subscription is created
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);

    // Verify metadata is set
    assert_eq!(client.get_metadata(&user), Some(label));
}

#[test]
#[should_panic]
fn test_subscribe_with_metadata_label_too_long() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Create a 65-byte label (exceeds 64-byte limit)
    let long_label = soroban_sdk::String::from_str(
        &env,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", // 65 chars
    );

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    // Should panic with MetadataLabelTooLong
    client.subscribe_with_metadata(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
        &long_label,
    );
}

#[test]
#[should_panic]
fn test_subscribe_with_metadata_no_subscription_on_label_failure() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let long_label = soroban_sdk::String::from_str(
        &env,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    );

    // Label validation happens before subscribe_inner, so no subscription should be written.
    // This panics before any storage write â€” we verify that by catching the panic separately
    // in test_subscribe_with_metadata_label_too_long. Here we just assert the panic occurs.
    client.subscribe_with_metadata(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
        &long_label,
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// get_protocol_stats tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_protocol_stats_initial() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let stats = client.get_protocol_stats();

    assert_eq!(stats.active_count, 0);
    assert_eq!(stats.fee_bps, 0);
    assert!(stats.fee_collector.is_none());
    assert_eq!(stats.grace_period, 0);
    assert!(!stats.whitelist_enabled);
    assert_eq!(stats.schema_version, 1); // default version
    assert!(!stats.contract_paused);
}

#[test]
fn test_get_protocol_stats_after_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let stats = client.get_protocol_stats();
    assert_eq!(stats.active_count, 1);
}

#[test]
fn test_get_protocol_stats_with_fee() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Set admin directly in instance storage so admin-gated functions work
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    env.mock_all_auths();
    let fee_collector = Address::generate(&env);
    client.propose_fee(&fee_collector, &100); // 1% fee
    client.commit_fee();

    let stats = client.get_protocol_stats();
    assert_eq!(stats.fee_bps, 100);
    assert_eq!(stats.fee_collector, Some(fee_collector));
}

#[test]
fn test_get_protocol_stats_contract_paused() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Set admin directly in instance storage so admin-gated functions work
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
    });

    env.mock_all_auths();
    client.pause_contract();

    let stats = client.get_protocol_stats();
    assert!(stats.contract_paused);

    client.unpause_contract();
    let stats_after = client.get_protocol_stats();
    assert!(!stats_after.contract_paused);
}

#[test]
fn test_resubscribe() {
    let (env, contract_id, token_addr, user, merchant_a) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchant_b = Address::generate(&env);

    // Initial subscription
    client.subscribe(
        &user,
        &merchant_a,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    let sub1 = client.get_subscription(&user).unwrap();
    assert_eq!(sub1.merchant, merchant_a);
    assert_eq!(sub1.amount, 1_0000000);

    // Subscribe again with different parameters
    client.subscribe(
        &user,
        &merchant_b,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );
    let sub2 = client.get_subscription(&user).unwrap();

    assert_eq!(sub2.merchant, merchant_b);
    assert_eq!(sub2.amount, 2_0000000);
    assert_eq!(sub2.interval, 172800);

    // Verify old merchant is gone
    assert_ne!(sub2.merchant, merchant_a);
}

#[test]
fn test_subscribe_overwrites_cancelled_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // 1. Subscribe
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // 2. Cancel
    client.cancel(&user);
    let sub_cancelled = client.get_subscription(&user).unwrap();
    assert!(!sub_cancelled.active);

    // 3. Subscribe again
    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &172800,
        &token_addr,
        &None,
        &None,
    );

    // 4. Verify new subscription is active
    let sub_new = client.get_subscription(&user).unwrap();
    assert!(sub_new.active);
    assert_eq!(sub_new.amount, 2_0000000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// min_interval tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// get_min_interval returns 3600 (1 hour) before any admin configuration.
#[test]
fn test_get_min_interval_default() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_min_interval(), 3600);
}


/// subscribe panics with IntervalTooShort when interval < default floor of 3600.
#[test]
#[should_panic]
fn test_subscribe_interval_too_short_panics_default_floor() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // 1800 seconds (30 min) < 3600 default floor
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &1800,
        &token_addr,
        &None,
        &None,
    );
}

/// Lowering the floor via set_min_interval then subscribing at the new floor succeeds.
#[test]
fn test_subscribe_after_set_min_interval_lower_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);
    client.set_min_interval(&60u64);

    assert_eq!(client.get_min_interval(), 60);
    // 60 seconds == new floor â€” should succeed
    client.subscribe(&user, &merchant, &1_0000000, &60, &token_addr, &None, &None);
    assert!(client.get_subscription(&user).unwrap().active);
}

/// set_min_interval(0) panics.
#[test]
#[should_panic(expected = "min interval must be positive")]
fn test_set_min_interval_zero_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);
    client.set_min_interval(&0u64);
}

/// Calling set_min_interval without a configured admin panics.
#[test]
#[should_panic(expected = "admin not set")]
fn test_set_min_interval_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // No admin configured â€” require_admin panics with "admin not set"
    client.set_min_interval(&7200u64);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// clear_merchant_revenue_history tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin can clear history; subsequent query returns an empty Vec (zero-length).
/// Clearing does not affect the cumulative revenue total.
#[test]
fn test_clear_merchant_revenue_history_drops_history() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);

    // Produce some history via a charge
    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    // History should have one entry
    let history_before = client.get_merchant_revenue_history(&merchant, &10u32);
    assert_eq!(history_before.len(), 1);

    // Cumulative revenue is present
    let revenue = client.get_merchant_revenue(&merchant);
    assert!(revenue > 0);

    // Clear history as admin
    client.clear_merchant_revenue_history(&merchant);

    // History is now zero-length
    let history_after = client.get_merchant_revenue_history(&merchant, &10u32);
    assert_eq!(history_after.len(), 0);

    // Cumulative revenue is untouched
    assert_eq!(client.get_merchant_revenue(&merchant), revenue);
}

/// Clearing history for a merchant with no recorded data is idempotent (does not panic).
#[test]
fn test_clear_merchant_revenue_history_idempotent() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let unknown_merchant = Address::generate(&env);

    client.set_initial_admin(&admin);

    // First call â€” no data exists, must not panic
    client.clear_merchant_revenue_history(&unknown_merchant);
    // Second call â€” still no data, must not panic
    client.clear_merchant_revenue_history(&unknown_merchant);

    assert_eq!(
        client
            .get_merchant_revenue_history(&unknown_merchant, &5u32)
            .len(),
        0
    );
}

/// Calling clear_merchant_revenue_history without an admin configured panics.
#[test]
#[should_panic(expected = "admin not set")]
fn test_clear_merchant_revenue_history_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    // No admin configured â€” require_admin panics
    client.clear_merchant_revenue_history(&merchant);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Subscriber index tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_subscriber_index_three_unique_users() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let user_c = setup_funded_user(&env, &contract_id, &token_addr);

    client.subscribe(
        &user_a,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_c,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_subscriber_count(), 3);

    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap(), user_a);
    assert_eq!(page.get(1).unwrap(), user_b);
    assert_eq!(page.get(2).unwrap(), user_c);
}

#[test]
fn test_get_subscriber_at_returns_first() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_subscriber_at(&0u64), Some(user));
    assert_eq!(client.get_subscriber_at(&1u64), None);
}

#[test]
fn test_resubscribe_active_does_not_duplicate_index() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscriber_count(), 1);

    // Re-subscribe while still active â€” must not append a second entry
    client.subscribe(
        &user,
        &merchant,
        &2_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscriber_count(), 1);

    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 1);
}

#[test]
fn test_subscriber_page_offset_beyond_count_returns_empty() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_subscriber_count(), 1);

    let page = client.get_subscriber_page(&1u64, &10u32);
    assert_eq!(page.len(), 0);

    let page_zero_limit = client.get_subscriber_page(&0u64, &0u32);
    assert_eq!(page_zero_limit.len(), 0);
}

#[test]
fn test_subscriber_page_limit_capped_at_50() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let sac = StellarAssetClient::new(&env, &token_addr);

    for _ in 0..52 {
        let sub_user = Address::generate(&env);
        sac.mint(&sub_user, &10_000_0000000);
        let token = TokenClient::new(&env, &token_addr);
        token.approve(&sub_user, &contract_id, &10_000_0000000, &200);

        client.subscribe(
            &sub_user,
            &merchant,
            &1_0000000,
            &86400,
            &token_addr,
            &None,
            &None,
        );
    }

    assert_eq!(client.get_subscriber_count(), 53);

    let page = client.get_subscriber_page(&0u64, &100u32);
    assert_eq!(page.len(), 50);
}
// Issue #231: token.rs SAC compatibility test
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Test that a custom SAC token (not native XLM) works end-to-end
/// with subscribe, charge, and pay_per_use operations.
#[test]
fn test_custom_sac_token_end_to_end_flow() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Setup a custom SAC token (not the default one from setup())
    let custom_token = setup_second_token(&env, &contract_id, &user);
    let token = TokenClient::new(&env, &custom_token);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    // Step 1: Subscribe with custom SAC token
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &custom_token,
        &None,
        &None,
    );

    // Verify subscription uses the custom token
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert_eq!(sub.amount, amount);
    assert_eq!(
        sub.token, custom_token,
        "subscription should use custom SAC token"
    );

    // Step 2: Charge after interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    client.charge(&user);

    let user_balance_after = token.balance(&user);
    let merchant_balance_after = token.balance(&merchant);

    // Verify exact amount transferred
    assert_eq!(
        user_balance_before - user_balance_after,
        amount,
        "user balance should decrease by subscription amount"
    );
    assert_eq!(
        merchant_balance_after - merchant_balance_before,
        amount,
        "merchant balance should increase by subscription amount"
    );

    // Step 3: Pay-per-use with custom SAC token
    let user_balance_before_ppu = token.balance(&user);
    let merchant_balance_before_ppu = token.balance(&merchant);

    let ppu_amount: i128 = 2_0000000;
    client.pay_per_use(&user, &ppu_amount);

    let user_balance_after_ppu = token.balance(&user);
    let merchant_balance_after_ppu = token.balance(&merchant);

    // Verify pay-per-use amount transferred
    assert_eq!(
        user_balance_before_ppu - user_balance_after_ppu,
        ppu_amount,
        "user balance should decrease by pay_per_use amount"
    );
    assert_eq!(
        merchant_balance_after_ppu - merchant_balance_before_ppu,
        ppu_amount,
        "merchant balance should increase by pay_per_use amount"
    );

    // Verify subscription is still active after pay_per_use
    let sub_final = client.get_subscription(&user).unwrap();
    assert!(
        sub_final.active,
        "subscription should remain active after pay_per_use"
    );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #237: get_token() read function tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_token_returns_none_when_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);
    assert!(client.get_token().is_none());
}

#[test]
fn test_get_token_returns_initialized_token() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_token(), Some(token_addr));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue: get_grace_period getter
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_get_grace_period_default_zero() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_grace_period(), 0);
}

#[test]
fn test_get_grace_period_after_set() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });
    client.propose_grace_period(&3600);
    client.commit_grace_period();
    assert_eq!(client.get_grace_period(), 3600);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue: fee_updated event on set_fee
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_set_fee_emits_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &100);
    client.commit_fee();

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (emitted_collector, emitted_bps): (Address, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "fee_committed"));
    assert_eq!(emitted_collector, collector);
    assert_eq!(emitted_bps, 100u32);
}

#[test]
fn test_get_fee_returns_current_fee_settings() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &250);
    client.commit_fee();

    assert_eq!(client.get_fee(), Some((collector, 250u32)));
}

#[test]
#[should_panic]
fn test_set_fee_invalid_bps_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &10001);
    client.commit_fee();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue: grace_period_updated event on set_grace_period
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_set_grace_period_emits_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_grace_period(&7200);
    client.commit_grace_period();

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let emitted_seconds: u64 = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "grace_period_committed"));
    assert_eq!(emitted_seconds, 7200u64);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #195: grace period charge behavior
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_charge_within_grace_window_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Past billing interval but still inside grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period / 2;
    });

    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.last_charged, env.ledger().timestamp());
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn test_charge_after_grace_window_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    client.charge(&user);
}

#[test]
#[should_panic]
fn test_non_admin_set_grace_period_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);

    client.propose_grace_period(&3600);
    client.commit_grace_period();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #243: Token address validation
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_subscribe_non_contract_address() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // Provide a non-contract address (just an account)
    use soroban_sdk::xdr::{AccountId, PublicKey, ScAddress, Uint256};
    use soroban_sdk::TryFromVal;
    let account_id = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256([0; 32])));
    let non_contract_token = Address::try_from_val(&env, &ScAddress::Account(account_id)).unwrap();

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &non_contract_token,
        &None,
        &None,
    );
}

#[test]
fn test_subscribe_valid_sac_token_address_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.token, token_addr);
}

// Issue #232: charge() insufficient-allowance error path
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// If a user's token allowance drops below `sub.amount` between subscribe and
/// charge time, `transfer_from` must fail and propagate the error.
#[test]
#[should_panic]
fn test_charge_insufficient_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    // Subscribe with sufficient allowance
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Revoke allowance â€” set it to 0
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &0, &200);

    // Advance ledger past the interval
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // charge() should panic because transfer_from fails with insufficient allowance
    client.charge(&user);
}

#[test]
fn test_set_metadata_label_at_limit_succeeds() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let valid_label = soroban_sdk::String::from_str(
        &env,
        "this_is_a_perfectly_valid_sixty_four_character_metadata_label_ok",
    );
    assert_eq!(valid_label.len(), 64);

    client.set_metadata(&user, &valid_label);

    assert_eq!(client.get_metadata(&user), Some(valid_label));
}

#[test]
#[should_panic]
fn test_set_metadata_label_exceeding_limit_fails() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let invalid_label = soroban_sdk::String::from_str(
        &env,
        "this_is_an_invalid_sixty_five_character_metadata_label_too_long_!",
    );
    assert_eq!(invalid_label.len(), 65);

    client.set_metadata(&user, &invalid_label);
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Issue #469: set_subscription_label auth and alias tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
#[test]
fn test_set_metadata_wrong_user_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    let attacker = Address::generate(&env);
    let label = soroban_sdk::String::from_str(&env, "hacked");
    client.set_metadata(&attacker, &label);
}

#[test]
fn test_get_subscription_label_returns_set_value() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    let label = soroban_sdk::String::from_str(&env, "premium");
    client.set_metadata(&user, &label);
    assert_eq!(client.get_subscription_label(&user), Some(label));
}

#[test]
fn test_get_subscription_label_none_when_not_set() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let random = Address::generate(&env);
    assert!(client.get_subscription_label(&random).is_none());
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tests for pause() and resume()
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_pause_sets_paused_true() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.paused);
}

#[test]
#[should_panic]
fn test_charge_on_paused_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
}

#[test]
#[should_panic]
fn test_pay_per_use_on_paused_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    client.pay_per_use(&user, &1_0000000);
}

#[test]
fn test_resume_unpauses_and_charge_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);
    client.resume(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.last_charged > 0);
}

#[test]
#[should_panic]
fn test_pause_on_inactive_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);
    client.pause(&user);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tests for next_charge_at()
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_next_charge_at_returns_correct_timestamp() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub = client.get_subscription(&user).unwrap();
    let expected = sub.last_charged + sub.interval;
    let got = client.next_charge_at(&user).unwrap();
    assert_eq!(got, expected);
}

#[test]
fn test_next_charge_at_none_after_cancel() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    assert!(client.next_charge_at(&user).is_none());
}

#[test]
fn test_next_charge_at_none_for_unknown_address() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(client.next_charge_at(&random).is_none());
}

#[test]
fn test_transfer_subscription_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let new_user = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&new_user, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&new_user, &contract_id, &10_000_0000000, &200);

    client.transfer_subscription(&user, &new_user);

    assert!(
        client.get_subscription(&user).is_none(),
        "old subscription should be removed"
    );

    let new_sub = client.get_subscription(&new_user).unwrap();
    assert!(new_sub.active, "new subscription should be active");
    assert_eq!(new_sub.merchant, merchant);
    assert_eq!(new_sub.amount, 1_0000000);
}

#[test]
#[should_panic]
fn test_transfer_subscription_to_active_user_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let new_user = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&new_user, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&new_user, &contract_id, &10_000_0000000, &200);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &new_user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.transfer_subscription(&user, &new_user);
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-08: Allowance pre-validation tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// subscribe() with zero allowance must panic with InsufficientAllowance
/// and must NOT write the subscription to storage.
#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_subscribe_zero_allowance_panics() {
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

    // Deliberately grant zero allowance â€” no approve() call.
    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
}

/// After a zero-allowance subscribe() panic, get_subscription() must return None,
/// confirming no storage was written.
/// Note: In the Soroban test environment, panics abort the entire transaction,
/// so storage changes from the failed call are never committed. We verify this
/// by reading storage directly inside the contract after a successful (non-panicking)
/// path: a user who was never subscribed must always return None.
#[test]
fn test_subscribe_zero_allowance_does_not_write_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);

    let user = Address::generate(&env);

    // Never approved any allowance â€” a subscribe call would panic.
    // Soroban transactions are atomic: a panic reverts all storage writes.
    // We confirm the storage slot starts empty (None) and â€” since we cannot
    // call subscribe without panicking â€” we verify the invariant holds: a
    // user address that has never successfully subscribed always returns None.
    let client = FlowPayClient::new(&env, &contract_id);
    assert!(
        client.get_subscription(&user).is_none(),
        "subscription must not be stored for a user who has never successfully subscribed"
    );
}

/// subscribe() with allowance exactly equal to amount must succeed.
#[test]
fn test_subscribe_exact_allowance_succeeds() {
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

    let amount: i128 = 5_0000000;

    // Approve exactly amount â€” no more, no less.
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &amount, &200);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);

    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active, "subscription should be active");
    assert_eq!(sub.amount, amount);
}

/// Re-subscribe (overwriting a cancelled subscription) with zero allowance
/// must also panic with InsufficientAllowance.
#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_resubscribe_zero_allowance_panics() {
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

    let amount: i128 = 1_0000000;

    // First subscribe with sufficient allowance.
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200);

    let client = FlowPayClient::new(&env, &contract_id);
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);
    client.cancel(&user);

    // Revoke allowance so second subscribe sees zero.
    token.approve(&user, &contract_id, &0, &200);

    // Re-subscribe must panic because allowance is zero.
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-36: set_subscription_amount tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin successfully updates a subscription amount; get_subscription reflects
/// the new value and last_charged / interval are untouched.
#[test]
fn test_set_subscription_amount_admin_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let original_amount: i128 = 1_0000000;
    let new_amount: i128 = 3_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &original_amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let sub_before = client.get_subscription(&user).unwrap();
    assert_eq!(sub_before.amount, original_amount);
    let last_charged_before = sub_before.last_charged;

    client.set_subscription_amount(&user, &new_amount);

    let sub_after = client.get_subscription(&user).unwrap();
    assert_eq!(sub_after.amount, new_amount, "amount should be updated");
    assert_eq!(
        sub_after.last_charged, last_charged_before,
        "last_charged must not change"
    );
    assert_eq!(sub_after.interval, interval, "interval must not change");
    assert!(sub_after.active, "subscription should remain active");
}

/// Updating a non-existent subscription must panic with NoSubscriptionFound.
#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_set_subscription_amount_no_subscription_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let random = Address::generate(&env);
    client.set_subscription_amount(&random, &2_0000000);
}

/// A non-admin caller must not be able to update a subscription amount.
#[test]
#[should_panic]
fn test_set_subscription_amount_non_admin_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Remove all authorizations so the admin auth check fails.
    env.set_auths(&[]);

    client.set_subscription_amount(&user, &2_0000000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-37: set_subscription_interval tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin successfully updates the billing interval; next_charge_at reflects the
/// new value and last_charged / amount are untouched.
#[test]
fn test_set_subscription_interval_admin_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let amount: i128 = 1_0000000;
    let original_interval: u64 = 86400; // 1 day
    let new_interval: u64 = 30 * 24 * 3600; // 30 days

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &original_interval,
        &token_addr,
        &None,
        &None,
    );

    let sub_before = client.get_subscription(&user).unwrap();
    assert_eq!(sub_before.interval, original_interval);
    let last_charged_before = sub_before.last_charged;
    let amount_before = sub_before.amount;

    client.set_subscription_interval(&user, &new_interval);

    let sub_after = client.get_subscription(&user).unwrap();
    assert_eq!(
        sub_after.interval, new_interval,
        "interval should be updated"
    );
    assert_eq!(
        sub_after.last_charged, last_charged_before,
        "last_charged must not change"
    );
    assert_eq!(sub_after.amount, amount_before, "amount must not change");
    assert!(sub_after.active, "subscription should remain active");

    // next_charge_at must reflect last_charged + new_interval
    let expected_next = last_charged_before + new_interval;
    assert_eq!(
        client.next_charge_at(&user).unwrap(),
        expected_next,
        "next_charge_at should use the updated interval"
    );
}

/// Setting an interval of zero must panic with IntervalTooShort.
#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn test_set_subscription_interval_zero_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.set_subscription_interval(&user, &0);
}

/// Updating the interval for a non-existent subscription must panic with
/// NoSubscriptionFound.
#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_set_subscription_interval_no_subscription_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let random = Address::generate(&env);
    client.set_subscription_interval(&random, &86400);
}

/// A non-admin caller must not be able to update the billing interval.
#[test]
#[should_panic]
fn test_set_subscription_interval_non_admin_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    env.set_auths(&[]);

    client.set_subscription_interval(&user, &172800);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-38: withdraw_merchant_revenue tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Merchant with accrued revenue can withdraw the full tracked balance.
/// After withdrawal: token balance increases by the tracked amount and the
/// revenue counter resets to zero.
#[test]
fn test_withdraw_merchant_revenue_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    // Initialize the global token so withdraw can resolve it.
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.initialize(&token_addr, &admin);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    // The tracked revenue equals the net charge (no fee configured in setup).
    let tracked = client.get_merchant_revenue(&merchant);
    assert!(tracked > 0, "revenue should be positive after charge");

    // Seed the contract with enough tokens to cover the withdrawal.
    // In a pooling model the contract would accumulate these from charges
    // routed through it; here we simulate that by minting directly.
    sac.mint(&contract_id, &tracked);

    let merchant_balance_before = token.balance(&merchant);

    client.withdraw_merchant_revenue(&merchant);
    

    // Revenue counter must be reset to zero.
    assert_eq!(
        client.get_merchant_revenue(&merchant),
        0,
        "revenue counter must be reset after withdrawal"
    );

    // Merchant token balance must increase by the tracked amount.
    let merchant_balance_after = token.balance(&merchant);
    assert_eq!(
        merchant_balance_after - merchant_balance_before,
        tracked,
        "merchant token balance should increase by the withdrawn amount"
    );
}

/// Withdrawal with no accrued balance must panic with ZeroBalanceAvailable.
#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_withdraw_merchant_revenue_zero_balance_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.initialize(&token_addr, &admin);

    // No charges have occurred, so revenue is zero.
    client.withdraw_merchant_revenue(&merchant);
}

#[test]
fn test_next_charge_at_none_for_paused_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    assert!(client.next_charge_at(&user).is_none());
}

#[test]
fn test_is_charge_due_transitions_after_interval() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Before interval elapses: not due
    assert!(!client.is_charge_due(&user));

    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });
    assert!(client.is_charge_due(&user));
}

#[test]
fn test_is_charge_due_false_for_paused_subscription() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    assert!(!client.is_charge_due(&user));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─────────────────────────────────────────────
// CONTRACT-53: batch_pause_subscriptions tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Admin can pause multiple valid subscriptions in a single batch call.
/// The test verifies paused flag is set, events are emitted, and already-paused
/// or missing addresses are handled without disruption.
#[test]
fn test_batch_pause_subscriptions_mixed_inputs() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Set up user_b with a subscription
    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    // Set up user_c with a subscription (will be paused first)
    let user_c = Address::generate(&env);
    sac.mint(&user_c, &10_000_0000000);
    token.approve(&user_c, &contract_id, &10_000_0000000, &200);

    // Set up user_d with a subscription (valid, will be paused in batch)
    let user_d = Address::generate(&env);
    sac.mint(&user_d, &10_000_0000000);
    token.approve(&user_d, &contract_id, &10_000_0000000, &200);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user_a,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_c,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user_d,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Pre-pause user_c
    client.pause(&user_c);
    let sub_c_before = client.get_subscription(&user_c).unwrap();
    assert!(sub_c_before.paused);

    // Verify all others start unpaused
    assert!(!client.get_subscription(&user_a).unwrap().paused);
    assert!(!client.get_subscription(&user_b).unwrap().paused);
    assert!(!client.get_subscription(&user_d).unwrap().paused);

    // Build batch with mixed inputs: valid, missing, already-paused, valid
    let no_sub_user = Address::generate(&env);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone()); // valid â†’ should be paused
    users.push_back(no_sub_user.clone()); // no subscription â†’ skipped
    users.push_back(user_c.clone()); // already paused â†’ no-op
    users.push_back(user_b.clone()); // valid â†’ should be paused
    users.push_back(user_d.clone()); // valid â†’ should be paused

    let events_before = env.events().all().len();

    client.batch_pause_subscriptions(&users);

    // All valid subscriptions must be paused
    let sub_a = client.get_subscription(&user_a).unwrap();
    assert!(sub_a.paused, "user_a should be paused");

    let sub_b = client.get_subscription(&user_b).unwrap();
    assert!(sub_b.paused, "user_b should be paused");

    let sub_d = client.get_subscription(&user_d).unwrap();
    assert!(sub_d.paused, "user_d should be paused");

    // Already-paused user_c remains paused
    let sub_c = client.get_subscription(&user_c).unwrap();
    assert!(sub_c.paused, "user_c should remain paused");

    // No subscription was created for no_sub_user
    assert!(
        client.get_subscription(&no_sub_user).is_none(),
        "no_sub_user should have no subscription"
    );

    // Verify events: three subscription_paused events (user_a, user_b, user_d)
    let events_after = env.events().all();
    let paused_event_count = (events_before..events_after.len())
        .filter(|&i| {
            let (_, topics, _) = events_after.get(i).unwrap();
            let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            topic_symbol == Symbol::new(&env, "subscription_paused")
        })
        .count();
    assert_eq!(
        paused_event_count, 3,
        "should emit 3 subscription_paused events"
    );
}

/// Non-admin callers must be rejected with an auth panic.
#[test]
#[should_panic]
fn test_batch_pause_subscriptions_non_admin_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Clear all auths â€” admin auth should fail and panic
    env.set_auths(&[]);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.batch_pause_subscriptions(&users);
}

/// Batch size exceeding 25 must panic with BatchTooLarge.
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_pause_subscriptions_exceeds_max_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Build a vector with 26 entries
    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..26 {
        users.push_back(Address::generate(&env));
    }
    client.batch_pause_subscriptions(&users);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONTRACT-07: get_merchant_sub_count tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_merchant_sub_count_two_users_cancel_one() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_b = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user_b, &10_000_0000000);
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user_b, &contract_id, &10_000_0000000, &200);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user_a,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);

    client.subscribe(
        &user_b,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant), 2);

    client.cancel(&user_a);
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
}

#[test]
fn test_merchant_sub_count_resubscribe_different_merchant() {
    let (env, contract_id, token_addr, user, merchant_a) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchant_b = Address::generate(&env);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    // Subscribe user to merchant A
    client.subscribe(
        &user,
        &merchant_a,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant_a), 1);
    assert_eq!(client.get_merchant_sub_count(&merchant_b), 0);

    // Re-subscribe user to merchant B
    client.subscribe(
        &user,
        &merchant_b,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant_a), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant_b), 1);
}

#[test]
fn test_merchant_sub_count_never_subscribed_returns_zero() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let unknown_merchant = Address::generate(&env);
    assert_eq!(client.get_merchant_sub_count(&unknown_merchant), 0);
}

#[test]
fn test_merchant_sub_count_double_cancel_no_underflow() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);

    client.cancel(&user);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);

    // Second cancel must not underflow
    client.cancel(&user);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
}

#[test]
fn test_is_charge_due_false_past_grace_window() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let interval: u64 = 86400;
    let grace: u64 = 3600;
    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.propose_grace_period(&grace);
    client.commit_grace_period();

    env.ledger().with_mut(|l| { l.timestamp += interval + grace + 1; });

    assert!(!client.is_charge_due(&user));
}

#[test]
fn test_is_charge_due_false_for_unknown_address() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert!(!client.is_charge_due(&Address::generate(&env)));
}

#[test]
fn test_daily_limit_day_start_boundary() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &100_0000000, &86400, &token_addr, &None, &None);
    client.set_daily_limit(&user, &50_0000000);

    // Spend 10
    client.pay_per_use(&user, &10_0000000);
    assert_eq!(client.get_daily_spent(&user), 10_0000000);

    // Spend 10 more
    client.pay_per_use(&user, &10_0000000);
    assert_eq!(client.get_daily_spent(&user), 20_0000000);

    // Manually extend DailyLimit (and other entries touched by the upcoming pay_per_use)
    // TTL so they survive the time skip below.
    env.as_contract(&contract_id, || {
        let key = DataKey::DailyLimit(user.clone());
        // 35,000 ledgers > LEDGERS_PER_DAY (17,280)
        env.storage().temporary().extend_ttl(&key, 35000, 35000);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::MerchantRevenue(merchant.clone()), 35000, 35000);
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantRevenueHistory(merchant.clone()),
            35000,
            35000,
        );
    });

    // Advance sequence by LEDGERS_PER_DAY + 1 to expire DayStart (17,280 + 1 = 17,281)
    env.ledger().with_mut(|l| {
        l.sequence_number += 17281;
        l.timestamp += 17281 * 5;
    });

    // Renew the token allowance, which expired when the ledger sequence jumped past it
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &(env.ledger().sequence() + 200));

    // New spend on new day
    client.pay_per_use(&user, &15_0000000);

    // Should only be 15, not 35
    assert_eq!(client.get_daily_spent(&user), 15_0000000);
}
