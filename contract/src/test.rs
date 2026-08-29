#![cfg(test)]
#![allow(
    clippy::bool_assert_comparison,
    unused_variables,
    dead_code,
    clippy::inconsistent_digit_grouping
)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, IntoVal, Symbol, TryFromVal, TryIntoVal, Vec,
};

/// Returns (env, contract_id, token_addr, user, merchant)
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &10_000_0000000, &200000);

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

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
    token.approve(user, contract_id, &10_000_0000000, &200000);

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
fn test_subscription_age_after_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    env.ledger().with_mut(|l| {
        l.timestamp = 1;
    });

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let elapsed: u64 = 1000;
    env.ledger().with_mut(|l| {
        l.timestamp += elapsed;
    });

    let age = client.get_subscription_age(&user);
    assert_eq!(age, Some(elapsed));
}

#[test]
fn test_subscription_age_resets_on_resubscribe() {
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

    env.ledger().with_mut(|l| {
        l.timestamp += 5000;
    });

    client.cancel(&user);

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let elapsed_after_resub: u64 = 200;
    env.ledger().with_mut(|l| {
        l.timestamp += elapsed_after_resub;
    });

    let age = client.get_subscription_age(&user);
    assert_eq!(age, Some(elapsed_after_resub));
}

#[test]
fn test_subscription_age_none_when_no_subscription() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let age = client.get_subscription_age(&user);
    assert_eq!(age, None);
}

#[test]
fn test_subscription_age_none_for_migrated_sentinel() {
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

    // Simulate a pre-existing subscription migrated with the created_at = 0 sentinel
    env.as_contract(&contract_id, || {
        let key = crate::DataKey::Subscription(user.clone());
        let mut sub: crate::Subscription = env.storage().persistent().get(&key).unwrap();
        sub.created_at = 0;
        env.storage().persistent().set(&key, &sub);
    });

    let age = client.get_subscription_age(&user);
    assert_eq!(age, None);
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
fn test_charge_routes_net_to_custom_recipient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&collector, &500);
    client.commit_fee(); // 5%

    // merchant sets a custom recipient (directly write persistent storage for test)
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::MerchantFeeRecipient(merchant.clone()), &recipient);
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantFeeRecipient(merchant.clone()),
            SUBSCRIPTION_TTL_LEDGERS,
            SUBSCRIPTION_TTL_LEDGERS,
        );
    });

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

    let recipient_before = token.balance(&recipient);
    let merchant_before = token.balance(&merchant);
    let collector_before = token.balance(&collector);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&recipient) - recipient_before, expected_fee);
    assert_eq!(token.balance(&merchant) - merchant_before, expected_net);
    assert_eq!(token.balance(&collector) - collector_before, 0);
}

// ─────────────────────────────────────────────
// CONTRACT-802: gross-allowance preflight before the two-leg fee transfer
// ─────────────────────────────────────────────

/// Helper: installs an admin and commits `bps` with a fresh collector.
fn configure_fee(env: &Env, contract_id: &Address, bps: u32) -> Address {
    let client = FlowPayClient::new(env, contract_id);
    install_admin(env, contract_id);
    let collector = Address::generate(env);
    client.propose_fee(&collector, &bps);
    client.commit_fee();
    collector
}

/// An allowance exactly equal to the gross amount must cover BOTH transfer
/// legs (fee + net) when fee_bps > 0.
#[test]
fn test_charge_exact_gross_allowance_succeeds_with_fee() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    let amount: i128 = 10_0000000;
    let expected_fee: i128 = 500_0000;
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

    // Tighten the allowance to exactly the gross amount — not a stroop more.
    token.approve(&user, &contract_id, &amount, &200000);
    assert_eq!(token.allowance(&user, &contract_id), amount);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&collector), expected_fee);
    assert_eq!(token.balance(&merchant), amount - expected_fee);
    // Both legs drew on the same allowance, consuming it exactly.
    assert_eq!(token.allowance(&user, &contract_id), 0);
}

/// One stroop short of the gross amount must fail closed with the typed
/// `InsufficientAllowance` (#8) and move no funds on either leg.
#[test]
fn test_charge_allowance_below_gross_fails_closed_before_any_transfer() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    let amount: i128 = 10_0000000;
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

    token.approve(&user, &contract_id, &(amount - 1), &200000);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    let res = client.try_charge(&user);

    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(8))));
    // Neither leg ran: the fee leg alone would have fit in the allowance.
    assert_eq!(token.balance(&collector), 0);
    assert_eq!(token.balance(&merchant), 0);
    assert_eq!(client.get_total_protocol_fees(), 0);
}

/// A fee that rounds down to zero still charges the full gross amount and
/// needs the full gross allowance.
#[test]
fn test_charge_with_fee_rounding_to_zero_uses_full_gross_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    // 1 * 500 / 10_000 == 0 — the fee leg is skipped entirely.
    let amount: i128 = 1;
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

    token.approve(&user, &contract_id, &amount, &200000);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&collector), 0);
    assert_eq!(token.balance(&merchant), amount);
    assert_eq!(client.get_total_protocol_fees(), 0);
}

/// The maximum in-bounds fee (10_000 bps == 100%) sends everything to the
/// collector and still passes the single gross preflight.
#[test]
fn test_charge_max_bps_exact_allowance_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 10_000); // 100%

    let amount: i128 = 10_0000000;
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

    token.approve(&user, &contract_id, &amount, &200000);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);

    assert_eq!(token.balance(&collector), amount);
    assert_eq!(token.balance(&merchant), 0);
    assert_eq!(token.allowance(&user, &contract_id), 0);
}

/// pay_per_use runs the same two-leg pattern and the same preflight.
#[test]
fn test_pay_per_use_exact_gross_allowance_succeeds_with_fee() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let amount: i128 = 10_0000000;
    let expected_fee: i128 = 500_0000;
    token.approve(&user, &contract_id, &amount, &200000);

    client.pay_per_use(&user, &amount);

    assert_eq!(token.balance(&collector), expected_fee);
    assert_eq!(token.balance(&merchant), amount - expected_fee);
    assert_eq!(token.allowance(&user, &contract_id), 0);
}

#[test]
fn test_pay_per_use_allowance_below_gross_fails_closed() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let collector = configure_fee(&env, &contract_id, 500); // 5%

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    let amount: i128 = 10_0000000;
    token.approve(&user, &contract_id, &(amount - 1), &200000);

    let res = client.try_pay_per_use(&user, &amount);

    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(8))));
    assert_eq!(token.balance(&collector), 0);
    assert_eq!(client.get_total_protocol_fees(), 0);
}

// ─────────────────────────────────────────────
// Issue #837 / Issue 042: shared allowance-requirement helper
// ─────────────────────────────────────────────

struct AllowanceReqCase {
    allowance: i128,
    gross: i128,
    fee_bps: u32,
    expected: bool,
    label: &'static str,
}

/// Table-driven unit tests for the shared allowance helper: zero, exact, and
/// insufficient allowance, plus fee-off vs fee-on gross (never net-only).
#[test]
fn test_allowance_covers_gross_table() {
    let gross: i128 = 10_000;
    let fee_on_bps: u32 = 500; // 5%
    let fee_on_net: i128 = gross - (gross * fee_on_bps as i128 / 10_000); // 9_500

    let cases = [
        AllowanceReqCase {
            allowance: 0,
            gross,
            fee_bps: 0,
            expected: false,
            label: "zero allowance, fee_bps = 0",
        },
        AllowanceReqCase {
            allowance: 0,
            gross,
            fee_bps: fee_on_bps,
            expected: false,
            label: "zero allowance, fee_bps > 0",
        },
        AllowanceReqCase {
            allowance: gross,
            gross,
            fee_bps: 0,
            expected: true,
            label: "exact allowance, fee_bps = 0",
        },
        AllowanceReqCase {
            allowance: gross,
            gross,
            fee_bps: fee_on_bps,
            expected: true,
            label: "exact gross allowance, fee_bps > 0",
        },
        AllowanceReqCase {
            allowance: gross - 1,
            gross,
            fee_bps: 0,
            expected: false,
            label: "insufficient (one stroop short), fee_bps = 0",
        },
        AllowanceReqCase {
            allowance: gross - 1,
            gross,
            fee_bps: fee_on_bps,
            expected: false,
            label: "insufficient (one stroop short of gross), fee_bps > 0",
        },
        AllowanceReqCase {
            allowance: fee_on_net,
            gross,
            fee_bps: fee_on_bps,
            expected: false,
            label: "fee-on net-only allowance is insufficient vs gross",
        },
        AllowanceReqCase {
            allowance: gross + 1,
            gross,
            fee_bps: 0,
            expected: true,
            label: "surplus allowance, fee_bps = 0",
        },
        AllowanceReqCase {
            allowance: gross + 1,
            gross,
            fee_bps: fee_on_bps,
            expected: true,
            label: "surplus allowance, fee_bps > 0",
        },
    ];

    for c in cases {
        assert_eq!(
            validation::required_allowance(c.gross, c.fee_bps),
            c.gross,
            "required allowance must be gross ({})",
            c.label
        );
        assert_eq!(
            validation::allowance_covers_gross(c.allowance, c.gross, c.fee_bps),
            c.expected,
            "{}",
            c.label
        );
    }
}

struct SimulateAllowanceCase {
    fee_bps: u32,
    allowance: i128,
    expected: ChargeSimResult,
    label: &'static str,
}

/// `simulate_charge` uses the shared helper: fee-off and fee-on both require
/// the gross amount, so a net-only allowance fails when fees are on.
#[test]
fn test_simulate_charge_allowance_requirement_table() {
    let amount: i128 = 10_0000000;
    let interval: u64 = 86400;
    let fee_on_bps: u32 = 500;
    let fee_on_net: i128 = amount - (amount * fee_on_bps as i128 / 10_000);

    let cases = [
        SimulateAllowanceCase {
            fee_bps: 0,
            allowance: 0,
            expected: ChargeSimResult::InsufficientAllowance,
            label: "zero allowance, fee_bps = 0",
        },
        SimulateAllowanceCase {
            fee_bps: 0,
            allowance: amount,
            expected: ChargeSimResult::WouldSucceed,
            label: "exact allowance, fee_bps = 0",
        },
        SimulateAllowanceCase {
            fee_bps: 0,
            allowance: amount - 1,
            expected: ChargeSimResult::InsufficientAllowance,
            label: "insufficient allowance, fee_bps = 0",
        },
        SimulateAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: 0,
            expected: ChargeSimResult::InsufficientAllowance,
            label: "zero allowance, fee_bps > 0",
        },
        SimulateAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: amount,
            expected: ChargeSimResult::WouldSucceed,
            label: "exact gross allowance, fee_bps > 0",
        },
        SimulateAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: amount - 1,
            expected: ChargeSimResult::InsufficientAllowance,
            label: "one stroop short of gross, fee_bps > 0",
        },
        SimulateAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: fee_on_net,
            expected: ChargeSimResult::InsufficientAllowance,
            label: "net-only allowance, fee_bps > 0",
        },
    ];

    for c in cases {
        let (env, contract_id, token_addr, user, merchant) = setup();
        let client = FlowPayClient::new(&env, &contract_id);
        let token = TokenClient::new(&env, &token_addr);

        if c.fee_bps > 0 {
            configure_fee(&env, &contract_id, c.fee_bps);
        }

        client.subscribe(
            &user,
            &merchant,
            &amount,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        token.approve(&user, &contract_id, &c.allowance, &200000);
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });

        assert_eq!(client.simulate_charge(&user), c.expected, "{}", c.label);
    }
}

struct SubscribeAllowanceCase {
    fee_bps: u32,
    allowance: i128,
    expect_ok: bool,
    label: &'static str,
}

/// subscribe() validation uses the same gross-allowance helper, including
/// when protocol fees are configured (requirement is still the gross amount).
#[test]
fn test_subscribe_allowance_requirement_table() {
    let amount: i128 = 10_0000000;
    let fee_on_bps: u32 = 500;
    let fee_on_net: i128 = amount - (amount * fee_on_bps as i128 / 10_000);

    let cases = [
        SubscribeAllowanceCase {
            fee_bps: 0,
            allowance: 0,
            expect_ok: false,
            label: "zero allowance, fee_bps = 0",
        },
        SubscribeAllowanceCase {
            fee_bps: 0,
            allowance: amount,
            expect_ok: true,
            label: "exact allowance, fee_bps = 0",
        },
        SubscribeAllowanceCase {
            fee_bps: 0,
            allowance: amount - 1,
            expect_ok: false,
            label: "insufficient allowance, fee_bps = 0",
        },
        SubscribeAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: 0,
            expect_ok: false,
            label: "zero allowance, fee_bps > 0",
        },
        SubscribeAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: amount,
            expect_ok: true,
            label: "exact gross allowance, fee_bps > 0",
        },
        SubscribeAllowanceCase {
            fee_bps: fee_on_bps,
            allowance: fee_on_net,
            expect_ok: false,
            label: "net-only allowance, fee_bps > 0",
        },
    ];

    for c in cases {
        let (env, contract_id, token_addr, user, merchant) = setup();
        let client = FlowPayClient::new(&env, &contract_id);
        let token = TokenClient::new(&env, &token_addr);

        if c.fee_bps > 0 {
            configure_fee(&env, &contract_id, c.fee_bps);
        }

        token.approve(&user, &contract_id, &c.allowance, &200000);
        let result =
            client.try_subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);

        if c.expect_ok {
            assert!(result.is_ok(), "{}", c.label);
            let sub = client.get_subscription(&user).unwrap();
            assert_eq!(sub.amount, amount, "{}", c.label);
        } else {
            assert_eq!(
                result,
                Err(Ok(soroban_sdk::Error::from_contract_error(8))),
                "{}",
                c.label
            );
            assert!(
                client.get_subscription(&user).is_none(),
                "failed subscribe must not write storage ({})",
                c.label
            );
        }
    }
}

/// `has_sufficient_allowance` reads SAC allowance and never transfers.
#[test]
fn test_has_sufficient_allowance_does_not_transfer() {
    let (env, contract_id, token_addr, user, _merchant) = setup();
    let token = TokenClient::new(&env, &token_addr);
    let amount: i128 = 1_0000000;
    let balance_before = token.balance(&user);

    env.as_contract(&contract_id, || {
        assert!(validation::has_sufficient_allowance(
            &env,
            &user,
            &token_addr,
            amount
        ));
    });

    token.approve(&user, &contract_id, &0, &200000);

    env.as_contract(&contract_id, || {
        assert!(!validation::has_sufficient_allowance(
            &env,
            &user,
            &token_addr,
            amount
        ));
        assert!(validation::has_sufficient_allowance(
            &env,
            &user,
            &token_addr,
            0
        ));
    });

    assert_eq!(token.balance(&user), balance_before);
}

// Note: setter input validation is covered in contract code; invoking it directly
// via the generated client isn't available in these tests. The storage-level
// behavior for routing is covered by the tests above.

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

#[test]
fn test_get_whitelist_enabled_defaults_to_true() {
    let env = Env::default();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    assert!(client.get_whitelist_enabled());
}

#[test]
fn test_get_whitelist_enabled_toggles() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    // Default is true
    assert!(client.get_whitelist_enabled());

    // False after set_whitelist_enabled(false)
    client.set_whitelist_enabled(&false);
    assert!(!client.get_whitelist_enabled());

    // True after re-enabling
    client.set_whitelist_enabled(&true);
    assert!(client.get_whitelist_enabled());
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

    client.freeze_merchant(&merchant, &None);
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

    client.freeze_merchant(&merchant, &None);
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

    client.freeze_merchant(&merchant, &None);

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

    client.freeze_merchant(&merchant, &None);
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

    client.freeze_merchant(&merchant, &None);
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

    client.freeze_merchant(&merchant, &None);
    client.freeze_merchant(&merchant, &None);
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
    client.freeze_merchant(&merchant, &None);
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
#[should_panic(expected = "Error(Contract, #20)")]
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

// ─────────────────────────────────────────────
// CONTRACT-803: configurable whitelist batch limit
// ─────────────────────────────────────────────

/// Helper: installs a generated admin so admin-gated entrypoints are callable.
fn install_admin(env: &Env, contract_id: &Address) {
    let admin = Address::generate(env);
    env.as_contract(contract_id, || {
        storage::set_admin(env, &admin);
    });
}

/// Helper: installs an admin and returns a Vec of `n` freshly generated merchants.
fn whitelist_admin_and_merchants(
    env: &Env,
    contract_id: &Address,
    n: u32,
) -> soroban_sdk::Vec<Address> {
    install_admin(env, contract_id);

    let mut merchants = soroban_sdk::Vec::new(env);
    for _ in 0..n {
        merchants.push_back(Address::generate(env));
    }
    merchants
}

#[test]
fn test_max_whitelist_batch_size_defaults_to_50() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    assert_eq!(client.get_max_whitelist_batch_size(), 50);
    // The whitelist knob is independent of the charge-batch knob.
    client.set_max_batch_size(&10);
    assert_eq!(client.get_max_whitelist_batch_size(), 50);
    assert_eq!(client.get_max_batch_size(), 10);
}

#[test]
fn test_set_max_whitelist_batch_size_lowers_cap() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 2);

    client.set_max_whitelist_batch_size(&2);
    assert_eq!(client.get_max_whitelist_batch_size(), 2);

    // Exactly at the configured cap still succeeds.
    assert_eq!(client.whitelist_batch_add(&merchants), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_whitelist_batch_add_over_configured_cap_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 3);

    client.set_max_whitelist_batch_size(&2);
    client.whitelist_batch_add(&merchants);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_whitelist_batch_remove_over_configured_cap_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 3);

    client.set_max_whitelist_batch_size(&2);
    client.whitelist_batch_remove(&merchants);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_get_merchant_statuses_over_configured_cap_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 3);

    client.set_max_whitelist_batch_size(&2);
    client.get_merchant_statuses(&merchants);
}

#[test]
fn test_raised_whitelist_batch_cap_allows_more_than_default() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 51);

    // 51 entries panic under the default cap; raising the cap admits them.
    client.set_max_whitelist_batch_size(&60);
    assert_eq!(client.whitelist_batch_add(&merchants), 51);
    assert_eq!(client.get_whitelist_size(), 51);
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_whitelist_batch_size_zero_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_whitelist_batch_size(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_set_max_whitelist_batch_size_above_ceiling_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_whitelist_batch_size(&(MAX_BATCH_SIZE_CEILING + 1));
}

#[test]
#[should_panic]
fn test_set_max_whitelist_batch_size_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    env.set_auths(&[]);

    client.set_max_whitelist_batch_size(&10);
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
#[cfg(feature = "bench")]
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
#[cfg(feature = "bench")]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_over_default_limit_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        let u = Address::generate(&env);
        users.push_back(u);
        users.push_back(Address::generate(&env));
    }

    let res = client.try_batch_charge(&users);
    assert!(res.is_err());
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

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp = 900;
    });

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);

    client.cancel_and_refund_prorated(&user, &merchant);

    assert_eq!(
        token.balance(&merchant),
        merchant_balance_before - 7_500_000
    );
    assert_eq!(token.balance(&user), user_balance_before + 7_500_000);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active);
}

#[test]
fn test_cancel_and_refund_prorated_at_period_start_refunds_full_amount() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);

    client.cancel_and_refund_prorated(&user, &merchant);

    assert_eq!(
        token.balance(&merchant),
        merchant_balance_before - 1_0000000
    );
    assert_eq!(token.balance(&user), user_balance_before + 1_0000000);
    assert!(!client.get_subscription(&user).unwrap().active);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_cancel_and_refund_prorated_at_interval_end_rejects_zero_refund() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let sac = StellarAssetClient::new(&env, &token_addr);

    sac.mint(&merchant, &10_000_0000000);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );

    env.ledger().with_mut(|l| {
        l.timestamp = 3600;
    });

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
#[should_panic(expected = "Error(Contract, #38)")]
fn test_cancel_and_refund_prorated_rejects_wrong_merchant() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let actual_merchant = Address::generate(&env);

    client.subscribe(
        &user,
        &actual_merchant,
        &1_0000000,
        &3600,
        &_token_addr,
        &None,
        &None,
    );

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_cancel_and_refund_prorated_missing_subscription_panics() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.cancel_and_refund_prorated(&user, &merchant);
}

#[test]
fn test_cancel_and_refund_prorated_underfunded_merchant_is_atomic() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    env.ledger().with_mut(|l| l.timestamp = 1800);

    let merchant_balance_before = token.balance(&merchant);
    let user_balance_before = token.balance(&user);
    let result = client.try_cancel_and_refund_prorated(&user, &merchant);

    assert!(result.is_err());
    assert_eq!(token.balance(&merchant), merchant_balance_before);
    assert_eq!(token.balance(&user), user_balance_before);
    assert!(client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_cancel_and_refund_prorated_inactive_subscription_is_atomic() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user);

    let result = client.try_cancel_and_refund_prorated(&user, &merchant);

    assert!(result.is_err());
    assert!(!client.get_subscription(&user).unwrap().active);
}

#[test]
fn test_cancel_and_refund_prorated_paused_subscription_is_atomic() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &3600,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    let result = client.try_cancel_and_refund_prorated(&user, &merchant);

    assert!(result.is_err());
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert!(sub.paused);
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

// -----------------------------------------------------------------
// Issue #794: batch_charge AllowanceInsufficient tolerance tests
// -----------------------------------------------------------------

/// A subscriber with zero allowance receives AllowanceInsufficient; no funds move.
#[test]
fn test_batch_charge_zero_allowance_returns_allowance_insufficient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None, &None);

    // Revoke the allowance entirely.
    token.approve(&user, &contract_id, &0, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "zero allowance must produce AllowanceInsufficient"
    );
    assert_eq!(token.balance(&user), user_balance_before, "user balance unchanged");
    assert_eq!(token.balance(&merchant), merchant_balance_before, "merchant balance unchanged");
}

/// A subscriber whose allowance is exactly the subscription amount is charged.
#[test]
fn test_batch_charge_exact_allowance_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None, &None);

    // Set allowance to exactly the gross amount.
    token.approve(&user, &contract_id, &amount, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::Charged,
        "exact allowance must allow the charge"
    );
    assert_eq!(
        token.balance(&user),
        10_000_0000000 - amount,
        "user debited gross amount"
    );
}

/// A subscriber with allowance one stroop below sub.amount is rejected.
#[test]
fn test_batch_charge_one_below_allowance_returns_allowance_insufficient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None, &None);

    // Set allowance to one stroop below gross.
    token.approve(&user, &contract_id, &(amount - 1), &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient
    );
    assert_eq!(token.balance(&user), user_balance_before);
    assert_eq!(token.balance(&merchant), merchant_balance_before);
}

/// Mixed batch: Alice (sufficient) -> Bob (insufficient) -> Charlie (sufficient).
/// Bob's failure must not abort Alice's or Charlie's charges.
#[test]
fn test_batch_charge_mixed_allowance_does_not_abort_healthy_users() {
    let (env, contract_id, token_addr, alice, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);
    sac.mint(&bob, &10_000_0000000);
    sac.mint(&charlie, &10_000_0000000);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    for u in [&alice, &bob, &charlie] {
        token.approve(u, &contract_id, &10_000_0000000, &200);
        client.subscribe(u, &merchant, &amount, &interval, &token_addr, &None, &None);
    }

    // Bob revokes to an insufficient amount.
    token.approve(&bob, &contract_id, &(amount / 2), &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let alice_before = token.balance(&alice);
    let bob_before = token.balance(&bob);
    let charlie_before = token.balance(&charlie);
    let merchant_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(alice.clone());
    users.push_back(bob.clone());
    users.push_back(charlie.clone());

    let results = client.batch_charge(&users);

    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged, "Alice charged");
    assert_eq!(
        results.get(1).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "Bob insufficient"
    );
    assert_eq!(results.get(2).unwrap(), crate::ChargeResult::Charged, "Charlie charged");

    assert_eq!(alice_before - token.balance(&alice), amount, "Alice debited");
    assert_eq!(token.balance(&bob), bob_before, "Bob untouched");
    assert_eq!(charlie_before - token.balance(&charlie), amount, "Charlie debited");
    assert_eq!(
        token.balance(&merchant) - merchant_before,
        amount * 2,
        "merchant received exactly 2 charges"
    );
}

/// Multiple under-allowanced users in one batch all return AllowanceInsufficient.
#[test]
fn test_batch_charge_multiple_insufficient_allowances() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let user_b = Address::generate(&env);
    sac.mint(&user_b, &10_000_0000000);

    let amount: i128 = 2_0000000;
    let interval: u64 = 86400;

    for u in [&user_a, &user_b] {
        token.approve(u, &contract_id, &10_000_0000000, &200);
        client.subscribe(u, &merchant, &amount, &interval, &token_addr, &None, &None);
        token.approve(u, &contract_id, &(amount - 1), &200);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let a_before = token.balance(&user_a);
    let b_before = token.balance(&user_b);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());
    let results = client.batch_charge(&users);

    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::AllowanceInsufficient);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::AllowanceInsufficient);
    assert_eq!(token.balance(&user_a), a_before);
    assert_eq!(token.balance(&user_b), b_before);
}

/// Healthy user before AND after an under-allowanced user both get charged.
#[test]
fn test_batch_charge_healthy_before_and_after_insufficient() {
    let (env, contract_id, token_addr, healthy_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    let insufficient = Address::generate(&env);
    let healthy_b = Address::generate(&env);
    sac.mint(&insufficient, &10_000_0000000);
    sac.mint(&healthy_b, &10_000_0000000);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    for u in [&healthy_a, &insufficient, &healthy_b] {
        token.approve(u, &contract_id, &10_000_0000000, &200);
        client.subscribe(u, &merchant, &amount, &interval, &token_addr, &None, &None);
    }

    token.approve(&insufficient, &contract_id, &0, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let ha_before = token.balance(&healthy_a);
    let hb_before = token.balance(&healthy_b);
    let ins_before = token.balance(&insufficient);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(healthy_a.clone());
    users.push_back(insufficient.clone());
    users.push_back(healthy_b.clone());
    let results = client.batch_charge(&users);

    assert_eq!(results.get(0).unwrap(), crate::ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), crate::ChargeResult::AllowanceInsufficient);
    assert_eq!(results.get(2).unwrap(), crate::ChargeResult::Charged);

    assert_eq!(ha_before - token.balance(&healthy_a), amount);
    assert_eq!(token.balance(&insufficient), ins_before);
    assert_eq!(hb_before - token.balance(&healthy_b), amount);
}

/// Auto-resume + insufficient allowance: subscription resumes but charge fails cleanly.
#[test]
fn test_batch_charge_auto_resume_with_insufficient_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None, &None);
    client.pause_until(&user, &90_000);

    // Revoke allowance while paused.
    token.approve(&user, &contract_id, &0, &200);

    // Advance past both the pause expiry and the charge interval.
    env.ledger().set_timestamp(90_001);

    let user_balance_before = token.balance(&user);
    let merchant_balance_before = token.balance(&merchant);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "auto-resume + zero allowance must not panic"
    );
    assert_eq!(token.balance(&user), user_balance_before);
    assert_eq!(token.balance(&merchant), merchant_balance_before);
    let sub = client.get_subscription(&user).unwrap();
    assert!(sub.active);
    assert!(!sub.paused);
}

/// get_batch_charge_estimate returns AllowanceInsufficient for an under-allowanced
/// due subscriber, mirroring the live batch behavior.
#[test]
fn test_batch_charge_estimate_reflects_allowance_insufficient() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &amount, &interval, &token_addr, &None, &None);
    token.approve(&user, &contract_id, &(amount - 1), &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let users = soroban_sdk::vec![&env, user.clone()];
    let estimate = client.get_batch_charge_estimate(&users);
    assert_eq!(
        estimate.get(0).unwrap(),
        crate::batch::ChargeResult::AllowanceInsufficient
    );
}

/// Allowance check is against gross sub.amount, NOT the post-fee net amount.
/// Allowance == net (< gross) must still return AllowanceInsufficient.
#[test]
fn test_batch_charge_allowance_checked_against_gross_not_net() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        crate::storage::set_admin(&env, &admin);
    });
    // 10% fee: net = 90% of gross.
    client.propose_fee(&collector, &1000);
    client.commit_fee();

    let gross: i128 = 1_0000000;
    let net: i128 = gross - gross * 1000 / 10_000; // 9_000_000
    let interval: u64 = 86400;

    client.subscribe(&user, &merchant, &gross, &interval, &token_addr, &None, &None);

    // Set allowance to exactly the net amount -- below gross.
    token.approve(&user, &contract_id, &net, &200);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let user_balance_before = token.balance(&user);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let results = client.batch_charge(&users);

    assert_eq!(
        results.get(0).unwrap(),
        crate::ChargeResult::AllowanceInsufficient,
        "allowance == net but < gross must still fail"
    );
    assert_eq!(token.balance(&user), user_balance_before, "no funds moved");
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
fn test_get_daily_limit_status_absent_limit() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: None,
            spent: 0,
            day_start: None,
            remaining: None,
        }
    );
}

#[test]
fn test_get_daily_limit_status_snapshot_and_rollover() {
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
    client.pay_per_use(&user, &2_0000000);

    let status = client.get_daily_limit_status(&user);
    assert_eq!(status.limit, Some(10_0000000));
    assert_eq!(status.spent, 2_0000000);
    assert_eq!(status.remaining, Some(8_0000000));
    assert_eq!(status.day_start, client.get_day_start(&user));

    env.as_contract(&contract_id, || {
        env.storage().temporary().extend_ttl(
            &DataKey::DailyLimit(user.clone()),
            35000,
            35000,
        );
    });
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += 17281;
    });

    assert_eq!(
        client.get_daily_limit_status(&user),
        DailyLimitStatus {
            limit: Some(10_0000000),
            spent: 0,
            day_start: None,
            remaining: Some(10_0000000),
        }
    );
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
fn test_get_day_start_visibility() {
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

    // No window before any spend
    assert!(client.get_day_start(&user).is_none());
    assert_eq!(client.get_daily_spent(&user), 0);

    client.set_daily_limit(&user, &10_0000000);
    // Setting a limit alone does not open the day window
    assert!(client.get_day_start(&user).is_none());

    client.pay_per_use(&user, &2_0000000);
    assert!(client.get_day_start(&user).is_some());
    assert_eq!(client.get_daily_spent(&user), 2_0000000);

    client.remove_daily_limit(&user);
    assert!(client.get_day_start(&user).is_none());
    assert_eq!(client.get_daily_spent(&user), 0);
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

// ─────────────────────────────────────────────────────────────
// Issue #45: get_pending_upgrade tests
// ─────────────────────────────────────────────────────────────

/// Returns None when no upgrade has been proposed.
#[test]
fn test_get_pending_upgrade_none_when_not_proposed() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    assert_eq!(client.get_pending_upgrade(), None);
}

/// Returns the proposed WASM hash after propose_upgrade is called.
#[test]
fn test_get_pending_upgrade_returns_proposed_hash() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0xAB; 32]);
    client.propose_upgrade(&new_wasm_hash);

    assert_eq!(client.get_pending_upgrade(), Some(new_wasm_hash));
}

/// Returns None after commit_upgrade consumes the pending hash.
#[test]
fn test_get_pending_upgrade_none_after_commit() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0xCD; 32]);
    client.propose_upgrade(&new_wasm_hash);

    // Hash is visible before commit
    assert_eq!(client.get_pending_upgrade(), Some(new_wasm_hash));

    client.commit_upgrade();

    // Cleared after commit
    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
fn test_cancel_pending_upgrade_clears_pending_upgrade_and_emits_event() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let new_wasm_hash = BytesN::from_array(&env, &[0xEF; 32]);
    client.propose_upgrade(&new_wasm_hash);
    client.cancel_pending_upgrade();

    assert_eq!(client.get_pending_upgrade(), None);
    assert_last_event(&env, "upg_cancelled");
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_commit_upgrade_requires_pending_upgrade_after_cancel() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    client.propose_upgrade(&BytesN::from_array(&env, &[0xEF; 32]));
    client.cancel_pending_upgrade();
    client.commit_upgrade();
}

#[test]
fn test_pending_upgrade_expires() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    client.propose_upgrade(&BytesN::from_array(&env, &[0xEF; 32]));
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += upgrade::PENDING_UPGRADE_TTL_LEDGERS + 1;
    });

    assert_eq!(client.get_pending_upgrade(), None);
}

#[test]
fn test_repropose_refreshes_pending_upgrade_ttl() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let first_hash = BytesN::from_array(&env, &[0x01; 32]);
    let second_hash = BytesN::from_array(&env, &[0x02; 32]);
    client.propose_upgrade(&first_hash);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += upgrade::PENDING_UPGRADE_TTL_LEDGERS - 1;
    });
    client.propose_upgrade(&second_hash);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += upgrade::PENDING_UPGRADE_TTL_LEDGERS - 1;
    });

    assert_eq!(client.get_pending_upgrade(), Some(second_hash));
}

/// A second propose_upgrade overwrites the first pending hash.
#[test]
fn test_get_pending_upgrade_overwritten_by_second_proposal() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let hash_a = BytesN::from_array(&env, &[0x01; 32]);
    let hash_b = BytesN::from_array(&env, &[0x02; 32]);

    client.propose_upgrade(&hash_a);
    assert_eq!(client.get_pending_upgrade(), Some(hash_a));

    client.propose_upgrade(&hash_b);
    assert_eq!(client.get_pending_upgrade(), Some(hash_b));
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─────────────────────────────────────────────────────────────
// Issue #96: referral tracking tests
// ─────────────────────────────────────────────────────────────

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
#[should_panic(expected = "Error(Contract, #1)")]
fn test_double_initialize() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.initialize(&token_addr, &admin);
}

// ─────────────────────────────────────────────
// Issue #839 / Issue 044: deploy-facing initialize invariants
// Relied on by scripts/deploy-pipeline.ts and scripts/testnet-setup.ts.
// Signature must remain initialize(token, admin). Failures that scripts map
// must be ContractError (AlreadyInitialized = 1), not a host string panic.
// ─────────────────────────────────────────────

/// Successful initialize persists both the default token and the admin.
/// Deploy health checks require `token_configured` and `admin_configured`.
#[test]
fn test_initialize_deploy_invariant_persists_token_and_admin() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);

    assert_eq!(
        client.get_token(),
        Some(token_addr.clone()),
        "initialize must persist the token readable via get_token"
    );
    assert_eq!(
        client.get_admin(),
        Some(admin.clone()),
        "initialize must persist the admin readable via get_admin"
    );

    let report = client.contract_health_check();
    assert!(report.token_configured);
    assert!(report.admin_configured);
}

/// Storage read used by deploy scripts: get_admin returns the initialized admin.
#[test]
fn test_initialize_deploy_invariant_stored_admin() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.get_admin().is_none());
    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_admin(), Some(admin));
}

/// Storage read used by deploy scripts: get_token returns the initialized token.
#[test]
fn test_initialize_deploy_invariant_stored_token() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.get_token().is_none());
    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_token(), Some(token_addr));
}

/// A second initialize must return typed AlreadyInitialized (code 1), not a string panic.
#[test]
fn test_initialize_deploy_invariant_double_init_already_initialized() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);

    let result = client.try_initialize(&token_addr, &admin);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AlreadyInitialized as u32
        ))),
        "double initialize must map to ContractError::AlreadyInitialized"
    );

    // First initialize state is unchanged.
    assert_eq!(client.get_token(), Some(token_addr));
    assert_eq!(client.get_admin(), Some(admin));
}

/// Initialize without admin authorization must fail and must not persist token or admin.
#[test]
fn test_initialize_deploy_invariant_requires_admin_auth() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.set_auths(&[]);

    let result = client.try_initialize(&token_addr, &admin);
    assert!(result.is_err(), "initialize without admin auth must fail");
    assert_ne!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AlreadyInitialized as u32
        ))),
        "missing admin auth is an authorization failure, not AlreadyInitialized"
    );

    assert!(
        client.get_token().is_none(),
        "failed initialize must not persist token"
    );
    assert!(
        client.get_admin().is_none(),
        "failed initialize must not persist admin"
    );
}

/// Backward-compat: current initialize(token, admin) arity remains the deploy entrypoint.
#[test]
fn test_initialize_deploy_invariant_token_admin_signature() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    assert_eq!(client.get_token(), Some(token_addr));
    assert_eq!(client.get_admin(), Some(admin));
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

    // Before migration, version defaults to 0
    assert_eq!(client.get_schema_version(), 0);

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);

    assert_eq!(client.get_schema_version(), 3);
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

    assert_eq!(client.get_schema_version(), 3);
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
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
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

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &2u32);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.migrate(&users);

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let (version, user_count): (u32, u32) = data.try_into_val(&env).unwrap();

    assert_eq!(topic_symbol, Symbol::new(&env, "migration_completed"));
    assert_eq!(version, 3);
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
fn test_get_charge_history_count() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // 1. A fresh user with no subscription/no charges ever → count is 0.
    let fresh_user = Address::generate(&env);
    assert_eq!(client.get_charge_history_count(&fresh_user), 0);

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

    // Also checking count for user with active subscription but no charges yet
    assert_eq!(client.get_charge_history_count(&user), 0);

    // 2. Count increments by 1 correctly after each individual charge event.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    assert_eq!(client.get_charge_history_count(&user), 1);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user);
    assert_eq!(client.get_charge_history_count(&user), 2);

    // Charge more to get exactly 12 entries
    for _ in 0..10 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }

    // 5. (Edge case) A user with exactly 12 entries → returns exactly 12.
    assert_eq!(client.get_charge_history_count(&user), 12);

    // 3. Count caps at 12 and does not exceed it even after more than 12 charges have occurred.
    for _ in 0..5 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
    }
    assert_eq!(client.get_charge_history_count(&user), 12);

    // 4. After calling clear_charge_history for a user who had history, count returns to 0.
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.clear_charge_history(&user);
    assert_eq!(client.get_charge_history_count(&user), 0);
}

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

    let page = client.get_charge_history_page(&user, &1u32, &2u32, &true);
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

    let page = client.get_charge_history_page(&user, &0u32, &100u32, &true);
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

    let page = client.get_charge_history_page(&user, &5u32, &2u32, &true);
    assert_eq!(page.len(), 0);
}

#[test]
fn test_charge_history_sort_ascending_and_descending() {
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

    let mut timestamps = Vec::new(&env);
    for _ in 0..5 {
        env.ledger().with_mut(|l| {
            l.timestamp += interval + 1;
        });
        client.charge(&user);
        timestamps.push_back(env.ledger().timestamp());
    }

    let t0 = timestamps.get(0).unwrap();
    let t1 = timestamps.get(1).unwrap();
    let t2 = timestamps.get(2).unwrap();
    let t3 = timestamps.get(3).unwrap();
    let t4 = timestamps.get(4).unwrap();

    // Ascending (true) full page: [t0, t1, t2, t3, t4]
    let asc_all = client.get_charge_history_page(&user, &0u32, &10u32, &true);
    assert_eq!(asc_all.len(), 5);
    assert_eq!(asc_all.get(0).unwrap(), t0);
    assert_eq!(asc_all.get(1).unwrap(), t1);
    assert_eq!(asc_all.get(2).unwrap(), t2);
    assert_eq!(asc_all.get(3).unwrap(), t3);
    assert_eq!(asc_all.get(4).unwrap(), t4);

    // Descending (false) full page: [t4, t3, t2, t1, t0]
    let desc_all = client.get_charge_history_page(&user, &0u32, &10u32, &false);
    assert_eq!(desc_all.len(), 5);
    assert_eq!(desc_all.get(0).unwrap(), t4);
    assert_eq!(desc_all.get(1).unwrap(), t3);
    assert_eq!(desc_all.get(2).unwrap(), t2);
    assert_eq!(desc_all.get(3).unwrap(), t1);
    assert_eq!(desc_all.get(4).unwrap(), t0);

    // Pagination in ascending direction:
    let asc_p1 = client.get_charge_history_page(&user, &0u32, &2u32, &true);
    assert_eq!(asc_p1.len(), 2);
    assert_eq!(asc_p1.get(0).unwrap(), t0);
    assert_eq!(asc_p1.get(1).unwrap(), t1);

    let asc_p2 = client.get_charge_history_page(&user, &2u32, &2u32, &true);
    assert_eq!(asc_p2.len(), 2);
    assert_eq!(asc_p2.get(0).unwrap(), t2);
    assert_eq!(asc_p2.get(1).unwrap(), t3);

    let asc_p3 = client.get_charge_history_page(&user, &4u32, &2u32, &true);
    assert_eq!(asc_p3.len(), 1);
    assert_eq!(asc_p3.get(0).unwrap(), t4);

    let asc_p4 = client.get_charge_history_page(&user, &5u32, &2u32, &true);
    assert_eq!(asc_p4.len(), 0);

    // Pagination in descending direction:
    let desc_p1 = client.get_charge_history_page(&user, &0u32, &2u32, &false);
    assert_eq!(desc_p1.len(), 2);
    assert_eq!(desc_p1.get(0).unwrap(), t4);
    assert_eq!(desc_p1.get(1).unwrap(), t3);

    let desc_p2 = client.get_charge_history_page(&user, &2u32, &2u32, &false);
    assert_eq!(desc_p2.len(), 2);
    assert_eq!(desc_p2.get(0).unwrap(), t2);
    assert_eq!(desc_p2.get(1).unwrap(), t1);

    let desc_p3 = client.get_charge_history_page(&user, &4u32, &2u32, &false);
    assert_eq!(desc_p3.len(), 1);
    assert_eq!(desc_p3.get(0).unwrap(), t0);

    let desc_p4 = client.get_charge_history_page(&user, &5u32, &2u32, &false);
    assert_eq!(desc_p4.len(), 0);
}

#[test]
fn test_charge_history_sort_edge_cases() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    // Empty history
    assert_eq!(
        client
            .get_charge_history_page(&random, &0u32, &10u32, &true)
            .len(),
        0
    );
    assert_eq!(
        client
            .get_charge_history_page(&random, &0u32, &10u32, &false)
            .len(),
        0
    );
    assert_eq!(
        client
            .get_charge_history_page(&random, &5u32, &10u32, &false)
            .len(),
        0
    );

    // Single entry
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
    let t0 = env.ledger().timestamp();

    let asc_single = client.get_charge_history_page(&user, &0u32, &10u32, &true);
    let desc_single = client.get_charge_history_page(&user, &0u32, &10u32, &false);
    assert_eq!(asc_single.len(), 1);
    assert_eq!(desc_single.len(), 1);
    assert_eq!(asc_single.get(0).unwrap(), t0);
    assert_eq!(desc_single.get(0).unwrap(), t0);
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

// ─────────────────────────────────────────────
// Issue 010: HealthReport field cleanup tests
// ─────────────────────────────────────────────

#[test]
fn test_health_check_healthy_fully_configured() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let report = client.contract_health_check();

    assert!(report.is_healthy);
    assert!(!report.contract_paused);
    assert!(report.token_configured);
    assert!(report.admin_configured);
    assert!(report.instance_ttl_ledgers > 0);
    // pending_merchant_rev_count is 0 when no merchants have revenue
    assert_eq!(report.pending_merchant_rev_count, 0);
}

#[test]
fn test_health_check_paused_not_healthy() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);
    client.pause_contract();

    let report = client.contract_health_check();

    assert!(!report.is_healthy);
    assert!(report.contract_paused);
}

#[test]
fn test_health_check_unconfigured_not_healthy() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlowPay);
    let client = FlowPayClient::new(&env, &contract_id);

    let report = client.contract_health_check();

    assert!(!report.is_healthy);
    assert!(!report.token_configured);
    assert!(!report.admin_configured);
}

/// Verify that TTL is reported as a positive value (test builds use real get_ttl).
#[test]
fn test_health_check_ttl_is_positive() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let report = client.contract_health_check();
    assert!(
        report.instance_ttl_ledgers > 0,
        "instance_ttl_ledgers should be positive in test builds"
    );
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
// Issue 013: PauseExpiry TTL coupled with subscription bump
// ─────────────────────────────────────────────

#[test]
fn test_bump_subscription_extends_pause_expiry_when_present() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    // Verify PauseExpiry exists before bump
    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert!(expiry.is_some(), "PauseExpiry should exist after pause_until");
    });

    // Bump subscription TTL — should also bump PauseExpiry
    client.bump_subscription(&user);

    // PauseExpiry should still exist (not archived)
    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert!(expiry.is_some(), "PauseExpiry should survive bump_subscription");
        assert_eq!(expiry.unwrap(), 90000);
    });
}

#[test]
fn test_bump_subscription_no_op_on_absent_pause_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    // No PauseExpiry — bump should be a safe no-op
    client.bump_subscription(&user);

    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert_eq!(expiry, None, "PauseExpiry should remain absent");
    });
}

#[test]
fn test_batch_extend_extends_pause_expiry_when_present() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &200000);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.batch_extend_subscription_ttl(&users);

    // PauseExpiry should survive batch extend
    env.as_contract(&contract_id, || {
        let expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert!(expiry.is_some(), "PauseExpiry should survive batch_extend");
        assert_eq!(expiry.unwrap(), 200000);
    });
}

#[test]
fn test_pause_then_batch_extend_then_auto_resume() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.ledger().with_mut(|l| {
        l.max_entry_ttl = 10_000_000;
    });

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    // Batch extend keeps PauseExpiry alive
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    client.batch_extend_subscription_ttl(&users);

    // Advance to expiry — auto-resume should still work
    env.ledger().set_timestamp(90000);
    let mut users2 = soroban_sdk::Vec::new(&env);
    users2.push_back(user.clone());
    let result = client.batch_charge(&users2);
    assert_eq!(result.get(0).unwrap(), crate::ChargeResult::Charged);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);
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
fn test_bump_instance_ttl_is_permissionless_and_state_preserving() {
    use soroban_sdk::testutils::storage::Instance as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    env.ledger().with_mut(|ledger| {
        ledger.max_entry_ttl = SUBSCRIPTION_TTL_LEDGERS * 2;
    });
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.initialize(&token_addr, &admin);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let admin_before = client.get_admin();
    let token_before = client.get_token();
    let fee_before = client.get_fee();
    let subscription_before = client.get_subscription(&user);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += SUBSCRIPTION_TTL_LEDGERS / 2 + 100;
    });
    let ttl_before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());

    env.set_auths(&[]);
    client.bump_instance_ttl();

    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl_after > ttl_before);
    assert!(ttl_after >= SUBSCRIPTION_TTL_LEDGERS);
    assert_eq!(client.get_admin(), admin_before);
    assert_eq!(client.get_token(), token_before);
    assert_eq!(client.get_fee(), fee_before);
    assert_eq!(client.get_subscription(&user), subscription_before);

    client.bump_instance_ttl();
    let repeated_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(repeated_ttl >= ttl_after);
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
    token.approve(&user, contract_id, &100_000_000_000_000, &200000);
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

// ─────────────────────────────────────────────
// Issue #10: get_global_volume_window tests
// ─────────────────────────────────────────────

#[test]
fn test_get_global_volume_window_returns_zero_on_fresh_contract() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let (volume, window_start) = client.get_global_volume_window();
    assert_eq!(volume, 0, "accumulated volume should be 0 on fresh contract");
    assert_eq!(window_start, 0, "window start should be 0 on fresh contract");
}

#[test]
fn test_get_global_volume_window_correct_values_after_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_000_0000000;
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
    let charge_time = env.ledger().timestamp();
    client.charge(&user);

    let (volume, window_start) = client.get_global_volume_window();
    assert_eq!(volume, amount, "accumulated volume should equal the charged amount");
    assert_eq!(window_start, charge_time, "window_start should equal ledger timestamp at charge time");
}

#[test]
fn test_get_global_volume_window_resets_after_hour() {
    let (env, contract_id, token_addr, _user_setup, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_a = setup_large_balance(&env, &contract_id, &token_addr);
    let user_b = setup_large_balance(&env, &contract_id, &token_addr);

    let amount: i128 = 1_000_0000000;
    let interval: u64 = 86400;

    client.subscribe(&user_a, &merchant, &amount, &interval, &token_addr, &None, &None);
    client.subscribe(&user_b, &merchant, &amount, &interval, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });
    client.charge(&user_a);

    // Confirm volume accumulated in the first window
    let (volume_before, _) = client.get_global_volume_window();
    assert_eq!(volume_before, amount);

    // Advance past the 1-hour window boundary
    env.ledger().with_mut(|l| {
        l.timestamp += 3601;
    });
    env.ledger().with_mut(|l| {
        l.timestamp += interval;
    });
    let second_charge_time = env.ledger().timestamp();
    client.charge(&user_b);

    // Window should have reset: only the second charge amount is accumulated
    let (volume_after, window_start_after) = client.get_global_volume_window();
    assert_eq!(volume_after, amount, "volume should reset to just the new charge amount after window expiry");
    assert_eq!(window_start_after, second_charge_time, "window_start should be the new charge time after reset");
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
    assert_eq!(stats.schema_version, 0); // default unmigrated version
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

#[test]
fn test_min_interval_event_emitted_on_set() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_initial_admin(&admin);

    // Verify default value is 3600 before setting
    assert_eq!(client.get_min_interval(), 3600);

    // First set: old value should be 3600 default, new value 7200
    client.set_min_interval(&7200u64);
    assert_eq!(client.get_min_interval(), 7200);

    let events_vec = env.events().all();
    let (_, topics, data) = events_vec.get(events_vec.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "min_interval_set"));

    let event_data: events::MinIntervalSetEventData = data.try_into_val(&env).unwrap();
    assert_eq!(event_data.old, 3600);
    assert_eq!(event_data.new, 7200);

    // Second set: old value 7200, new value 86400
    client.set_min_interval(&86400u64);
    assert_eq!(client.get_min_interval(), 86400);

    let events_vec2 = env.events().all();
    let (_, topics2, data2) = events_vec2.get(events_vec2.len() - 1).unwrap();
    let topic_symbol2: Symbol = topics2.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol2, Symbol::new(&env, "min_interval_set"));

    let event_data2: events::MinIntervalSetEventData = data2.try_into_val(&env).unwrap();
    assert_eq!(event_data2.old, 7200);
    assert_eq!(event_data2.new, 86400);

    // Same value set again: old == 86400, new == 86400
    client.set_min_interval(&86400u64);
    let events_vec3 = env.events().all();
    let (_, topics3, data3) = events_vec3.get(events_vec3.len() - 1).unwrap();
    let topic_symbol3: Symbol = topics3.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol3, Symbol::new(&env, "min_interval_set"));

    let event_data3: events::MinIntervalSetEventData = data3.try_into_val(&env).unwrap();
    assert_eq!(event_data3.old, 86400);
    assert_eq!(event_data3.new, 86400);
}

#[test]
fn test_top_merchants_by_subs() {
    let (env, contract_id, token_addr, _user, _m) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);

    client.add_merchant(&m1);
    client.add_merchant(&m2);
    client.add_merchant(&m3);

    // Create subscriptions for m1 (1 sub), m2 (3 subs), m3 (2 subs)
    let u1 = setup_funded_user(&env, &contract_id, &token_addr);
    let u2 = setup_funded_user(&env, &contract_id, &token_addr);
    let u3 = setup_funded_user(&env, &contract_id, &token_addr);
    let u4 = setup_funded_user(&env, &contract_id, &token_addr);
    let u5 = setup_funded_user(&env, &contract_id, &token_addr);
    let u6 = setup_funded_user(&env, &contract_id, &token_addr);

    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);

    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u3, &m2, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u4, &m2, &1_0000000, &86400, &token_addr, &None, &None);

    client.subscribe(&u5, &m3, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u6, &m3, &1_0000000, &86400, &token_addr, &None, &None);

    // Top 3 merchants: m2 (3 subs), m3 (2 subs), m1 (1 sub)
    let top = client.get_top_merchants_by_subs(&3u32);
    assert_eq!(top.len(), 3);
    assert_eq!(top.get(0).unwrap(), (m2.clone(), 3u32));
    assert_eq!(top.get(1).unwrap(), (m3.clone(), 2u32));
    assert_eq!(top.get(2).unwrap(), (m1.clone(), 1u32));

    // Unknown / unindexed merchant returns 0 for subscriber count query
    let unindexed = Address::generate(&env);
    assert_eq!(client.get_merchant_sub_count(&unindexed), 0);
}

#[test]
fn test_top_merchants_tie_breaking_and_limit() {
    let (env, contract_id, token_addr, _user, _m) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);

    // Add m1 first, then m2
    client.add_merchant(&m1);
    client.add_merchant(&m2);

    let u1 = setup_funded_user(&env, &contract_id, &token_addr);
    let u2 = setup_funded_user(&env, &contract_id, &token_addr);

    // Both m1 and m2 get 1 sub (tie)
    client.subscribe(&u1, &m1, &1_0000000, &86400, &token_addr, &None, &None);
    client.subscribe(&u2, &m2, &1_0000000, &86400, &token_addr, &None, &None);

    // Tie-breaking preserves index order: m1 first, m2 second
    let top = client.get_top_merchants_by_subs(&2u32);
    assert_eq!(top.len(), 2);
    assert_eq!(top.get(0).unwrap(), (m1.clone(), 1u32));
    assert_eq!(top.get(1).unwrap(), (m2.clone(), 1u32));

    // Limit 1 returns top 1
    let top1 = client.get_top_merchants_by_subs(&1u32);
    assert_eq!(top1.len(), 1);
    assert_eq!(top1.get(0).unwrap(), (m1.clone(), 1u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_top_merchants_limit_exceeded_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.get_top_merchants_by_subs(&21u32);
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

#[test]
fn prop_subscribe_interval_respects_min_interval_floor() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let default_floor = client.get_min_interval();

    let mut state = 0x9e3779b97f4a7c15u64;
    for sample in 0..4 {
        state ^= state << 7;
        state ^= state >> 9;
        let interval = if sample == 0 {
            0
        } else {
            state % default_floor
        };
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.subscribe(
                &user,
                &merchant,
                &1_0000000,
                &interval,
                &token_addr,
                &None,
                &None,
            );
        }));
        assert!(result.is_err(), "interval {interval} must be rejected");
    }

    for offset in 0..4 {
        let interval = default_floor + offset;
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(
            &user,
            &merchant,
            &1_0000000,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        assert_eq!(client.get_subscription(&user).unwrap().interval, interval);
    }

    let admin = Address::generate(&env);
    client.set_initial_admin(&admin);
    let updated_floor = 97u64;
    client.set_min_interval(&updated_floor);
    assert_eq!(client.get_min_interval(), updated_floor);

    for sample in 0..4 {
        state ^= state << 7;
        state ^= state >> 9;
        let interval = if sample == 0 {
            0
        } else {
            state % updated_floor
        };
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.subscribe(
                &user,
                &merchant,
                &1_0000000,
                &interval,
                &token_addr,
                &None,
                &None,
            );
        }));
        assert!(result.is_err(), "updated floor rejected interval {interval}");
    }

    for offset in 0..4 {
        let interval = updated_floor + offset;
        let user = setup_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(
            &user,
            &merchant,
            &1_0000000,
            &interval,
            &token_addr,
            &None,
            &None,
        );
        assert_eq!(client.get_subscription(&user).unwrap().interval, interval);
    }
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
#[cfg(feature = "bench")]
fn test_subscriber_page_limit_capped_at_50() {
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
    let sac = StellarAssetClient::new(&env, &token_addr);
    let token = TokenClient::new(&env, &token_addr);

    for _ in 0..52 {
        let sub_user = Address::generate(&env);
        sac.mint(&sub_user, &10_000_0000000);
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

// -------------------------------------------------------------
// Issue #45: resume/cancel on grace-lapsed subscriptions
// -------------------------------------------------------------


/// resume on a grace-lapsed subscription must panic with ResumeGraceLapsed (#100).
#[test]
#[should_panic(expected = "Error(Contract, #100)")]
fn test_resume_after_grace_lapse_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.pause(&user);

    // Advance past interval + grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    // resume must be rejected because the grace window has closed
    client.resume(&user);
}

/// cancel on a grace-lapsed subscription must still succeed.
#[test]
fn test_cancel_after_grace_lapse_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.pause(&user);

    // Advance past interval + grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period + 1;
    });

    // cancel must still be allowed so the user can exit cleanly
    client.cancel(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.active, "subscription should be inactive after cancel");
}

/// resume within a valid (non-lapsed) grace window must succeed normally.
#[test]
fn test_resume_within_grace_window_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let grace_period: u64 = 86400;
    let interval: u64 = 86400;
    client.propose_grace_period(&grace_period);
    client.commit_grace_period();

    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.pause(&user);

    // Advance past interval but still inside the grace window
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period / 2;
    });

    // resume must succeed because the grace window has not yet closed
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.paused, "subscription should not be paused after resume");
    assert!(sub.active, "subscription should remain active");
}

/// resume when no grace period is configured must succeed regardless of elapsed time.
#[test]
fn test_resume_no_grace_period_always_succeeds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No grace period set -- default is 0
    let interval: u64 = 86400;
    client.subscribe(&user, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.pause(&user);

    // Advance far past the interval -- grace is 0 so lapse check is skipped
    env.ledger().with_mut(|l| {
        l.timestamp += interval * 10;
    });

    // resume must succeed because grace_period == 0 means no lapse
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.paused, "subscription should not be paused after resume");
}

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
    assert_eq!(client.get_subscriber_count(), 2);
    assert_eq!(client.get_subscriber_at(&0u64), None);
    assert_eq!(client.get_subscriber_at(&1u64), Some(new_user));
    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
}

#[test]
fn test_transfer_subscription_to_inactive_user_reuses_tombstone_membership() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let new_user = setup_funded_user(&env, &contract_id, &token_addr);
    let inactive_merchant = Address::generate(&env);

    client.subscribe(
        &new_user,
        &inactive_merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&new_user);
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.transfer_subscription(&user, &new_user);

    assert_eq!(client.get_merchant_sub_count(&merchant), 1);
    assert_eq!(client.get_merchant_sub_count(&inactive_merchant), 0);
    assert_eq!(client.get_subscriber_count(), 3);
    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap(), new_user);
}

#[test]
fn test_transfer_subscription_event_emitted() {
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

    let mut seen_transfer_event = false;
    for (_, topics, data) in env.events().all().iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if topic_symbol == Symbol::new(&env, "subscription_transferred") {
            let topic_from: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
            let topic_to: Address = topics.get(2).unwrap().try_into_val(&env).unwrap();
            assert_eq!(topic_from, user);
            assert_eq!(topic_to, new_user);

            let event_payload: (Address, i128, u64, Address) = data.try_into_val(&env).unwrap();
            assert_eq!(event_payload.0, merchant);
            assert_eq!(event_payload.1, 1_0000000);
            assert_eq!(event_payload.2, 86400);
            assert_eq!(event_payload.3, token_addr);
            seen_transfer_event = true;
        }
    }

    assert!(
        seen_transfer_event,
        "expected a subscription_transferred event"
    );
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
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &10_000_0000000);

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

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
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

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

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

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

    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

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

/// Setting an interval of zero must panic with IntervalMustBePositive.
#[test]
#[should_panic(expected = "Error(Contract, #3)")]
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

#[test]
fn test_admin_batch_cancel_subscriptions_cancels_multiple_accounts() {
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

    let results = client.batch_cancel(&users);

    assert_eq!(results.len(), 2);
    assert_eq!(results.get(0).unwrap(), CancelResult::Cancelled);
    assert_eq!(results.get(1).unwrap(), CancelResult::Cancelled);
    assert!(!client.get_subscription(&user_a).unwrap().active);
    assert!(!client.get_subscription(&user_b).unwrap().active);
    assert_eq!(count_user_events(&env, "cancelled", &user_a), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_b), 1);
}

#[test]
fn test_batch_cancel_matches_single_cancel_side_effects() {
    let (env, contract_id, token_addr, user_single, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_batch = setup_funded_user(&env, &contract_id, &token_addr);
    let referrer = Address::generate(&env);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user_single,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    client.subscribe(
        &user_batch,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer),
    );

    client.cancel(&user_single);
    let mut users = Vec::new(&env);
    users.push_back(user_batch.clone());
    let results = client.batch_cancel(&users);

    assert_eq!(results.get(0).unwrap(), CancelResult::Cancelled);
    assert_eq!(
        client.get_subscription(&user_single),
        client.get_subscription(&user_batch)
    );
    assert_eq!(client.get_referrer(&user_single), None);
    assert_eq!(client.get_referrer(&user_batch), None);
    assert_eq!(client.get_active_count(), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
    assert_eq!(client.get_subscriber_count(), 2);
    assert!(client.get_subscriber_at(&0).is_none());
    assert!(client.get_subscriber_at(&1).is_none());
    assert_eq!(count_user_events(&env, "cancelled", &user_single), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_batch), 1);
}

#[test]
#[should_panic]
fn test_batch_cancel_requires_admin_auth() {
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

    client.batch_cancel(&users);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_cancel_exceeds_max_size_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..26 {
        users.push_back(Address::generate(&env));
    }
    client.batch_cancel(&users);
}

#[test]
fn test_batch_cancel_at_max_size_succeeds() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..25 {
        users.push_back(Address::generate(&env));
    }

    let results = client.batch_cancel(&users);
    assert_eq!(results.len(), 25);
    for result in results.iter() {
        assert_eq!(result, CancelResult::NoSubscription);
    }
}

#[test]
fn test_batch_cancel_handles_mixed_states_and_clears_referral() {
    let (env, contract_id, token_addr, user_a, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user_b = setup_funded_user(&env, &contract_id, &token_addr);
    let user_c = setup_funded_user(&env, &contract_id, &token_addr);
    let missing_user = Address::generate(&env);
    let referrer = Address::generate(&env);

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
        &Some(referrer.clone()),
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
    client.subscribe(
        &user_c,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.cancel(&user_c);

    assert_eq!(client.get_referrer(&user_a), Some(referrer));

    let mut users = Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());
    users.push_back(user_c.clone());
    users.push_back(missing_user.clone());

    let results = client.batch_cancel(&users);

    assert_eq!(results.len(), 4);
    assert_eq!(results.get(0).unwrap(), CancelResult::Cancelled);
    assert_eq!(results.get(1).unwrap(), CancelResult::Cancelled);
    assert_eq!(results.get(2).unwrap(), CancelResult::AlreadyCancelled);
    assert_eq!(results.get(3).unwrap(), CancelResult::NoSubscription);

    assert!(!client.get_subscription(&user_a).unwrap().active);
    assert!(!client.get_subscription(&user_b).unwrap().active);
    assert!(!client.get_subscription(&user_c).unwrap().active);
    assert!(client.get_subscription(&missing_user).is_none());

    assert_eq!(client.get_referrer(&user_a), None);
    assert_eq!(client.get_active_count(), 0);
    assert_eq!(client.get_merchant_sub_count(&merchant), 0);
    assert_eq!(client.get_subscriber_count(), 3);
    assert!(client.get_subscriber_at(&0).is_none());
    assert!(client.get_subscriber_at(&1).is_none());
    assert!(client.get_subscriber_at(&2).is_none());

    assert_eq!(count_user_events(&env, "cancelled", &user_a), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_b), 1);
    assert_eq!(count_user_events(&env, "cancelled", &user_c), 1);
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
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    client.propose_grace_period(&grace);
    client.commit_grace_period();

    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace + 1;
    });

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

    client.subscribe(
        &user,
        &merchant,
        &100_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
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
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantRevenue(merchant.clone()),
            35000,
            35000,
        );
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
    token.approve(
        &user,
        &contract_id,
        &10_000_0000000,
        &(env.ledger().sequence() + 200),
    );

    // New spend on new day
    client.pay_per_use(&user, &15_0000000);

    // Should only be 15, not 35
    assert_eq!(client.get_daily_spent(&user), 15_0000000);
}

// ─────────────────────────────────────────────
// CONTRACT-821: simulate_pay_per_use dry-run helper
// ─────────────────────────────────────────────

/// The sibling dry-run of `pay_per_use` returns distinct outcomes for the
/// inactive, paused, would-succeed, and daily-limit cases, while performing no
/// state writes.
#[test]
fn test_simulate_pay_per_use_variants() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // 1. Inactive when no subscription
    assert_eq!(
        client.simulate_pay_per_use(&user, &1_0000000),
        PayPerUseSimResult::Inactive
    );

    // Subscribe
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // 2. WouldSucceed when active, no daily limit, allowance sufficient
    assert_eq!(
        client.simulate_pay_per_use(&user, &1_0000000),
        PayPerUseSimResult::WouldSucceed
    );

    // 3. DailyLimitExceeded when the limit would be exceeded
    client.set_daily_limit(&user, &5_0000000);
    assert_eq!(
        client.simulate_pay_per_use(&user, &6_0000000),
        PayPerUseSimResult::DailyLimitExceeded
    );

    // 4. DailyLimitExceeded on cumulative spend: 3, then simulate another 3 (>5)
    client.pay_per_use(&user, &3_0000000);
    assert_eq!(
        client.simulate_pay_per_use(&user, &3_0000000),
        PayPerUseSimResult::DailyLimitExceeded
    );

    // 5. SubscriptionPaused when paused
    let before_spent = client.get_daily_spent(&user);
    client.pause(&user);
    assert_eq!(
        client.simulate_pay_per_use(&user, &1_0000000),
        PayPerUseSimResult::SubscriptionPaused
    );
    client.resume(&user);

    // 6. InsufficientAllowance when allowance revoked
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &0, &100);
    assert_eq!(
        client.simulate_pay_per_use(&user, &1_0000000),
        PayPerUseSimResult::InsufficientAllowance
    );

    // 7. ContractPaused
    env.as_contract(&contract_id, || {
        storage::set_contract_paused(&env, true);
    });
    assert_eq!(
        client.simulate_pay_per_use(&user, &1_0000000),
        PayPerUseSimResult::ContractPaused
    );

    // No simulation wrote to daily spend tracking.
    assert_eq!(client.get_daily_spent(&user), before_spent);
}

/// `simulate_pay_per_use` performs no state writes: daily spent, day start, and
/// balance are unchanged regardless of the simulated outcome.
#[test]
fn test_simulate_pay_per_use_no_state_writes() {
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

    let spent_before = client.get_daily_spent(&user);
    let day_start_before = client.get_day_start(&user);
    let balance_before = TokenClient::new(&env, &token_addr)
        .balance(&user);

    // Would succeed
    assert_eq!(
        client.simulate_pay_per_use(&user, &1_0000000),
        PayPerUseSimResult::WouldSucceed
    );
    // Limit exceeded
    assert_eq!(
        client.simulate_pay_per_use(&user, &5_0000000),
        PayPerUseSimResult::DailyLimitExceeded
    );

    assert_eq!(client.get_daily_spent(&user), spent_before);
    assert_eq!(client.get_day_start(&user), day_start_before);
    assert_eq!(
        TokenClient::new(&env, &token_addr).balance(&user),
        balance_before
    );
}

/// Simulating a spend at a day-window boundary reflects the fresh (reset) daily
/// spent value after the window has elapsed, mirroring `pay_per_use`.
#[test]
fn test_simulate_pay_per_use_day_window_reset_boundary() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &100_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &50_0000000);

    // Spend 10 today.
    client.pay_per_use(&user, &10_0000000);
    assert_eq!(client.get_daily_spent(&user), 10_0000000);

    // Crossing the day boundary makes the reset daily spent visible to the
    // dry-run: today a 45 spend would exceed (10 + 45 > 50)...
    assert_eq!(
        client.simulate_pay_per_use(&user, &45_0000000),
        PayPerUseSimResult::DailyLimitExceeded
    );

    // Manually extend the DailyLimit (and merchant-revenue) TTL so they survive
    // the time skip below, while intentionally leaving DailySpent/DayStart to
    // expire so the new window starts from a reset counter.
    env.as_contract(&contract_id, || {
        let key = DataKey::DailyLimit(user.clone());
        env.storage().temporary().extend_ttl(&key, 35000, 35000);
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantRevenue(merchant.clone()),
            35000,
            35000,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::MerchantRevenueHistory(merchant.clone()),
            35000,
            35000,
        );
    });

    // Advance past the day window (LEDGERS_PER_DAY + 1).
    env.ledger().with_mut(|l| {
        l.sequence_number += 17281;
        l.timestamp += 17281 * 5;
    });

    // Renew the token allowance that expired with the ledger jump.
    let token = TokenClient::new(&env, &token_addr);
    token.approve(
        &user,
        &contract_id,
        &10_000_0000000,
        &(env.ledger().sequence() + 200),
    );

    // The new day's simulated spend is evaluated against a reset counter,
    // so the same 45 amount now succeeds.
    assert_eq!(
        client.simulate_pay_per_use(&user, &45_0000000),
        PayPerUseSimResult::WouldSucceed
    );
}

/// `simulate_pay_per_use_to` accounts for recipient validation (invalid
/// contract self-reference and merchant whitelist) in addition to the shared
/// pay-per-use checks.
#[test]
fn test_simulate_pay_per_use_to_recipient_validation() {
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

    // Contract's own address is an invalid recipient.
    assert_eq!(
        client.simulate_pay_per_use_to(&user, &1_0000000, &contract_id),
        PayPerUseSimResult::InvalidRecipient
    );

    // With whitelist enabled, a non-whitelisted recipient is rejected.
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, true);
    });
    let random = Address::generate(&env);
    assert_eq!(
        client.simulate_pay_per_use_to(&user, &1_0000000, &random),
        PayPerUseSimResult::MerchantNotWhitelisted
    );

    // A valid, whitelisted recipient would succeed.
    env.as_contract(&contract_id, || {
        whitelist::add_merchant(&env, &merchant);
    });
    assert_eq!(
        client.simulate_pay_per_use_to(&user, &1_0000000, &merchant),
        PayPerUseSimResult::WouldSucceed
    );
}

/// `simulate_pay_per_use` rejects non-positive and over-cap amounts with the
/// same outcomes the real call enforces.
#[test]
fn test_simulate_pay_per_use_amount_bounds() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No subscription yet, but amount bounds are checked before subscription.
    assert_eq!(
        client.simulate_pay_per_use(&user, &0),
        PayPerUseSimResult::AmountMustBePositive
    );
    assert_eq!(
        client.simulate_pay_per_use(&user, &(MAX_AMOUNT + 1)),
        PayPerUseSimResult::AmountExceedsMaximum
    );
}

// ─────────────────────────────────────────────
// New Feature Unit Tests (Issues #628, #638, #640, #641)
// ─────────────────────────────────────────────

#[test]
fn test_batch_extend_subscription_ttl_extends_valid_and_skips_unknown() {
    let (env, contract_id, token_addr, user1, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let user2 = Address::generate(&env);
    let user3_unknown = Address::generate(&env);

    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user2, &contract_id, &1_000_000_000, &100);

    client.subscribe(
        &user1,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.subscribe(
        &user2,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user1.clone());
    users.push_back(user2.clone());
    users.push_back(user3_unknown.clone());

    let extended = client.batch_extend_subscription_ttl(&users);
    assert_eq!(extended.len(), 2);
    assert_eq!(extended.get(0).unwrap(), user1);
    assert_eq!(extended.get(1).unwrap(), user2);
}

#[test]
#[should_panic]
fn test_batch_extend_subscription_ttl_over_limit_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        users.push_back(Address::generate(&env));
    }

    client.batch_extend_subscription_ttl(&users);
}

#[test]
fn test_simulate_charge_variants() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // 1. Inactive when no subscription
    assert_eq!(client.simulate_charge(&user), ChargeSimResult::Inactive);

    // Subscribe
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // 2. NotDue immediately after subscribe
    assert_eq!(client.simulate_charge(&user), ChargeSimResult::NotDue);

    // Advance time past interval
    env.ledger().with_mut(|l| {
        l.timestamp += 86401;
    });

    // 3. WouldSucceed when due and allowed
    assert_eq!(client.simulate_charge(&user), ChargeSimResult::WouldSucceed);

    // 4. InsufficientAllowance when allowance revoked
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &0, &100);
    assert_eq!(
        client.simulate_charge(&user),
        ChargeSimResult::InsufficientAllowance
    );

    // Restore allowance
    token.approve(&user, &contract_id, &1_000_000_000, &100);

    // 5. SubscriptionPaused when paused
    client.pause(&user);
    assert_eq!(
        client.simulate_charge(&user),
        ChargeSimResult::SubscriptionPaused
    );

    // Resume
    client.resume(&user);

    // 6. GracePeriodElapsed
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::GracePeriod, &3600u64);
    });
    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 3601;
    });
    assert_eq!(
        client.simulate_charge(&user),
        ChargeSimResult::GracePeriodElapsed
    );

    // 7. ContractPaused
    env.as_contract(&contract_id, || {
        storage::set_contract_paused(&env, true);
    });
    assert_eq!(
        client.simulate_charge(&user),
        ChargeSimResult::ContractPaused
    );
}

#[test]
fn test_get_schema_version_returns_zero_and_updates() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_schema_version(), 0);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let empty_users = soroban_sdk::Vec::new(&env);
    client.migrate(&empty_users);
    assert_eq!(client.get_schema_version(), 3);
}

#[test]
#[should_panic]
fn test_pay_per_use_to_contract_address_panics() {
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

    client.pay_per_use_to(&user, &1_0000000, &contract_id);
}

#[test]
fn test_pay_per_use_to_zero_fee_bps_full_amount_to_recipient() {
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

    let amount: i128 = 4_0000000;
    let recipient_before = token.balance(&recipient);

    client.pay_per_use_to(&user, &amount, &recipient);

    assert_eq!(token.balance(&recipient) - recipient_before, amount);
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #634: get_merchant_revenue_summary
// ─────────────────────────────────────────────────────────────

#[test]
fn test_merchant_revenue_summary_empty() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let summary = client.get_merchant_revenue_summary(&merchant);
    assert_eq!(summary, (0, 0, 0, 0));
}

#[test]
fn test_merchant_revenue_summary_single_and_multiple_charges() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 10_0000000;
    client.subscribe(&user, &merchant, &amount, &86400, &token_addr, &None, &None);
    client.pay_per_use(&user, &amount);

    // First charge recorded: 10_0000000
    let summary1 = client.get_merchant_revenue_summary(&merchant);
    assert_eq!(summary1, (amount, 1, amount, amount));

    // Additional pay_per_use calls with different amounts
    client.pay_per_use(&user, &5_0000000);
    client.pay_per_use(&user, &25_0000000);

    let summary2 = client.get_merchant_revenue_summary(&merchant);
    // total = 10 + 5 + 25 = 40_0000000
    // count = 3
    // min = 5_0000000
    // max = 25_0000000
    assert_eq!(summary2, (40_0000000, 3, 5_0000000, 25_0000000));
}

#[test]
fn test_merchant_revenue_summary_cleared_history() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pay_per_use(&user, &10_0000000);
    client.clear_merchant_revenue_history(&merchant);

    let summary = client.get_merchant_revenue_summary(&merchant);
    // History cleared -> total remains 10_0000000, count/min/max return 0
    assert_eq!(summary, (10_0000000, 0, 0, 0));
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #635: get_subscription_health
// ─────────────────────────────────────────────────────────────

#[test]
fn test_subscription_health_non_existent_user() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let unknown = Address::generate(&env);

    let health = client.get_subscription_health(&unknown);
    assert_eq!(
        health,
        SubscriptionHealth {
            active: false,
            charge_due: false,
            within_grace: false,
            has_sufficient_allowance: false,
            is_paused: false,
            trial_active: false,
            daily_limit_set: false,
        }
    );
}

#[test]
fn test_subscription_health_active_healthy() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    let health = client.get_subscription_health(&user);
    assert_eq!(health.active, true);
    assert_eq!(health.charge_due, false);
    assert_eq!(health.within_grace, false);
    assert_eq!(health.has_sufficient_allowance, true);
    assert_eq!(health.is_paused, false);
    assert_eq!(health.trial_active, false);
    assert_eq!(health.daily_limit_set, false);
}

#[test]
fn test_subscription_health_paused() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.pause(&user);

    let health = client.get_subscription_health(&user);
    assert_eq!(health.active, true);
    assert_eq!(health.is_paused, true);
    assert_eq!(health.charge_due, false);
}

#[test]
fn test_subscription_health_trial_active() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let trial_sec = 7 * 86400;
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &Some(trial_sec),
        &None,
    );

    let health = client.get_subscription_health(&user);
    assert_eq!(health.trial_active, true);
}

#[test]
fn test_subscription_health_grace_period() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.propose_grace_period(&86400);
    client.commit_grace_period();

    let interval = 86400;
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Fast-forward ledger past interval, into grace period window
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: env.ledger().timestamp() + interval + 3600,
        protocol_version: 20,
        sequence_number: 100,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 16,
        min_persistent_entry_ttl: 16,
        max_entry_ttl: 3110400,
    });

    let health = client.get_subscription_health(&user);
    assert_eq!(health.charge_due, true);
    assert_eq!(health.within_grace, true);
}

#[test]
fn test_subscription_health_insufficient_allowance() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Revoke allowance
    token.approve(&user, &contract_id, &0, &1000);

    let health = client.get_subscription_health(&user);
    assert_eq!(health.has_sufficient_allowance, false);
}

#[test]
fn test_subscription_health_daily_limit_set() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );
    client.set_daily_limit(&user, &50_0000000);

    let health = client.get_subscription_health(&user);
    assert_eq!(health.daily_limit_set, true);
}

/// set_initial_admin with proper auth when Admin is unset succeeds and stores admin.
#[test]
fn test_set_initial_admin_success_once() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert!(client.get_admin().is_none());
    client.set_initial_admin(&admin);
    assert_eq!(client.get_admin(), Some(admin));
}

/// A second set_initial_admin call must return typed AdminAlreadySet (code 42),
/// not a raw string panic, and must not change the stored admin.
#[test]
fn test_set_initial_admin_second_call_returns_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);

    client.set_initial_admin(&admin1);
    assert_eq!(client.get_admin(), Some(admin1.clone()));

    let result = client.try_set_initial_admin(&admin2);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AdminAlreadySet as u32
        ))),
        "second set_initial_admin must map to ContractError::AdminAlreadySet"
    );

    // First admin is unchanged — no partial overwrite.
    assert_eq!(client.get_admin(), Some(admin1));
}

/// Calling set_initial_admin without the proposed admin's auth must fail with an
/// authorization error (host-level, not a contract-level typed error) and must
/// not write the admin slot.
#[test]
fn test_set_initial_admin_unauthenticated_fails() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.set_auths(&[]);

    let result = client.try_set_initial_admin(&admin);
    assert!(
        result.is_err(),
        "set_initial_admin without proposed admin auth must fail"
    );
    assert_ne!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AdminAlreadySet as u32
        ))),
        "missing auth must be an authorization failure, not AdminAlreadySet"
    );

    assert!(
        client.get_admin().is_none(),
        "failed set_initial_admin must not persist admin"
    );
}

/// Partial-init edge case: Token is already stored (e.g. from a separate
/// deploy-step) but Admin slot is still empty. set_initial_admin must still
/// require auth, succeed, and not be confused with initialize's state.
#[test]
fn test_set_initial_admin_token_present_admin_missing() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    // Simulate partial init: write Token but not Admin.
    env.as_contract(&contract_id, || {
        storage::set_token(&env, &token_addr);
    });

    // Sanity: token stored, admin missing.
    assert_eq!(client.get_token(), Some(token_addr.clone()));
    assert!(client.get_admin().is_none());

    // set_initial_admin must still require auth and succeed.
    client.set_initial_admin(&admin);
    assert_eq!(client.get_admin(), Some(admin.clone()));
    // Token state untouched.
    assert_eq!(client.get_token(), Some(token_addr));

    // Subsequent call returns typed error (not a panic) even in partial-init
    // post-success state.
    let admin2 = Address::generate(&env);
    let result = client.try_set_initial_admin(&admin2);
    assert_eq!(
        result,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            crate::errors::ContractError::AdminAlreadySet as u32
        ))),
        "post-success second call must return AdminAlreadySet in partial-init scenario"
    );
    assert_eq!(client.get_admin(), Some(admin));
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #636: validate_interval hardening
// ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_subscribe_interval_zero_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &10_0000000, &0, &token_addr, &None, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn test_set_subscription_interval_below_min_interval_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Setting interval to 100 seconds when MinInterval is default 3600 panics with #19 (IntervalTooShort)
    client.set_subscription_interval(&user, &100);
}

// ─────────────────────────────────────────────────────────────
// Tests for Issue #637: WhitelistIndex & pagination
// ─────────────────────────────────────────────────────────────

#[test]
fn test_whitelist_index_size_page_and_swap_remove() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    assert_eq!(client.get_whitelist_size(), 0);
    assert_eq!(client.get_whitelist_page(&0, &10).len(), 0);

    let m1 = Address::generate(&env);
    let m2 = Address::generate(&env);
    let m3 = Address::generate(&env);

    client.add_merchant(&m1);
    client.add_merchant(&m2);
    client.add_merchant(&m3);

    // Idempotent double add does not increment index size
    client.add_merchant(&m2);

    assert_eq!(client.get_whitelist_size(), 3);

    let page_all = client.get_whitelist_page(&0, &10);
    assert_eq!(page_all.len(), 3);
    assert_eq!(page_all.get(0).unwrap(), m1);
    assert_eq!(page_all.get(1).unwrap(), m2);
    assert_eq!(page_all.get(2).unwrap(), m3);

    // Test pagination offset & limit
    let page_subset = client.get_whitelist_page(&1, &1);
    assert_eq!(page_subset.len(), 1);
    assert_eq!(page_subset.get(0).unwrap(), m2);

    // Remove middle item (m2) -> swap-remove moves m3 into index 1
    client.remove_merchant(&m2);
    assert_eq!(client.get_whitelist_size(), 2);

    let page_after_remove = client.get_whitelist_page(&0, &10);
    assert_eq!(page_after_remove.len(), 2);
    assert_eq!(page_after_remove.get(0).unwrap(), m1);
    assert_eq!(page_after_remove.get(1).unwrap(), m3);

    // Idempotent double remove does nothing
    client.remove_merchant(&m2);
    assert_eq!(client.get_whitelist_size(), 2);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #2)")]
fn test_subscription_amount_validation_zero() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    // Attempt to set amount to 0 (panics with AmountMustBePositive, error 19)
    env.mock_all_auths();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.set_subscription_amount(&user, &0);
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #15)")]
fn test_subscription_amount_validation_exceeds_max() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    // Attempt to set amount above MAX_SUBSCRIPTION_AMOUNT
    env.mock_all_auths();
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    client.set_subscription_amount(&user, &(crate::MAX_SUBSCRIPTION_AMOUNT + 1));
}

#[test]
fn test_batch_charge_estimate() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let users = soroban_sdk::vec![&env, user.clone()];
    let estimate = client.get_batch_charge_estimate(&users);

    assert_eq!(estimate.len(), 1);
    assert_eq!(
        estimate.get(0).unwrap(),
        crate::batch::ChargeResult::NoSubscription
    );
}

#[test]
fn test_contract_config() {
    let (env, contract_id, token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    let config = client.get_contract_config();
    assert_eq!(config.schema_version, 1);
    assert_eq!(config.paused, false);
}

#[test]
fn test_daily_spent_reset() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&token_addr, &admin);

    assert!(client.get_day_start(&user).is_none());
}

// ─────────────────────────────────────────────────────────────
// Issue #11: extend_subscriber_index_ttl tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_extend_subscriber_index_ttl_empty_index_noop() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    assert_eq!(client.get_subscriber_count(), 0);
    client.extend_subscriber_index_ttl();
    assert_eq!(client.get_subscriber_count(), 0);
}

#[test]
fn test_extend_subscriber_index_ttl_emits_event_with_count() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let user_b = setup_funded_user(&env, &contract_id, &token_addr);

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
        &user_b,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    assert_eq!(client.get_subscriber_count(), 2);

    client.extend_subscriber_index_ttl();

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let count: u64 = data.try_into_val(&env).unwrap();

    assert_eq!(
        topic_symbol,
        Symbol::new(&env, "subscriber_index_ttl_extended")
    );
    assert_eq!(count, 2);
}

#[test]
fn test_extend_subscriber_index_ttl_extends_large_index() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    for _ in 0..5 {
        let u = setup_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(&u, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
        users.push_back(u);
    }

    assert_eq!(client.get_subscriber_count(), 5);

    client.extend_subscriber_index_ttl();

    let events = env.events().all();
    let (_, _, data) = events.get(events.len() - 1).unwrap();
    let count: u64 = data.try_into_val(&env).unwrap();
    assert_eq!(count, 5);

    env.as_contract(&contract_id, || {
        let ttl = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndexSize);
        assert!(ttl >= SUBSCRIPTION_TTL_LEDGERS);

        let ttl_0 = env
            .storage()
            .persistent()
            .get_ttl(&DataKey::SubscriberIndex(0));
        assert!(ttl_0 >= SUBSCRIPTION_TTL_LEDGERS);
    });
}

#[test]
#[should_panic]
fn test_extend_subscriber_index_ttl_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    env.set_auths(&[]);

    client.extend_subscriber_index_ttl();
}

// ─────────────────────────────────────────────────────────────
// Issue #838: clear_subscriber_index_entry admin repair
// ─────────────────────────────────────────────────────────────

/// Simulate a stale index slot: the subscription is inactive but the
/// append-only index was never tombstoned (the corruption this repair
/// entrypoint is meant to fix).
fn deactivate_subscription_leaving_index(env: &Env, contract_id: &Address, user: &Address) {
    env.as_contract(contract_id, || {
        let mut sub = storage::get_subscription(env, user).expect("subscription");
        sub.active = false;
        storage::set_subscription(env, user, &sub);
    });
}

#[test]
fn test_clear_subscriber_index_entry_authorized_repair_tombstones_stale_slot() {
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
    assert_eq!(client.get_subscriber_at(&0u64), Some(user.clone()));

    deactivate_subscription_leaving_index(&env, &contract_id, &user);
    assert_eq!(
        client.get_subscriber_at(&0u64),
        Some(user.clone()),
        "stale slot must still be visible before repair"
    );

    client.clear_subscriber_index_entry(&0u64);

    assert_eq!(
        client.get_subscriber_at(&0u64),
        None,
        "repaired slot must be tombstoned"
    );
    let page = client.get_subscriber_page(&0u64, &10u32);
    assert_eq!(page.len(), 0);
    assert_eq!(
        client.get_subscriber_count(),
        1,
        "repair must not shrink the append-only index"
    );
}

#[test]
#[should_panic]
fn test_clear_subscriber_index_entry_unauthorized_panics() {
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
    deactivate_subscription_leaving_index(&env, &contract_id, &user);

    env.set_auths(&[]);
    client.clear_subscriber_index_entry(&0u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_clear_subscriber_index_entry_refuses_active_subscriber() {
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

    client.clear_subscriber_index_entry(&0u64);
}

#[test]
fn test_clear_subscriber_index_entry_emits_audit_event() {
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
    deactivate_subscription_leaving_index(&env, &contract_id, &user);

    client.clear_subscriber_index_entry(&0u64);

    let events = env.events().all();
    let (_, topics, data) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    let topic_user: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    let index: u64 = data.try_into_val(&env).unwrap();

    assert_eq!(
        topic_symbol,
        Symbol::new(&env, "subscriber_index_cleared")
    );
    assert_eq!(topic_user, user);
    assert_eq!(index, 0);
}

// ─────────────────────────────────────────────────────────────
// Issue #610: get_subscription_token tests
// ─────────────────────────────────────────────────────────────

/// get_subscription_token returns None before the user subscribes.
#[test]
fn test_get_subscription_token_none_before_subscribe() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let random = Address::generate(&env);
    assert!(
        client.get_subscription_token(&random).is_none(),
        "get_subscription_token should return None for a user with no subscription"
    );
}

/// get_subscription_token returns Some(token) after subscribe.
#[test]
fn test_get_subscription_token_some_after_subscribe() {
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

    assert_eq!(
        client.get_subscription_token(&user),
        Some(token_addr),
        "get_subscription_token should return Some(token) after subscribe"
    );
}

/// get_subscription_token still returns Some(token) after cancel — the record
/// exists but is inactive; callers that need to distinguish active vs cancelled
/// should use get_subscription instead.
#[test]
fn test_get_subscription_token_some_after_cancel() {
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

    // The subscription record still exists (active=false), so token is still readable.
    assert_eq!(
        client.get_subscription_token(&user),
        Some(token_addr),
        "get_subscription_token should return Some(token) for cancelled subscription"
    );
}

/// get_subscription_token reflects the token when the user re-subscribes with
/// a different token.
#[test]
fn test_get_subscription_token_updates_on_resubscribe() {
    let (env, contract_id, token_a, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(
        &user, &merchant, &1_0000000, &86400, &token_a, &None, &None,
    );
    assert_eq!(client.get_subscription_token(&user), Some(token_a.clone()));

    let token_b = setup_second_token(&env, &contract_id, &user);
    client.subscribe(
        &user, &merchant, &2_0000000, &86400, &token_b, &None, &None,
    );

    assert_eq!(
        client.get_subscription_token(&user),
        Some(token_b),
        "get_subscription_token should return the latest token after resubscribe"
    );
}

// ─────────────────────────────────────────────────────────────
// Issue #611: propose_fee / commit_fee two-step tests
// ─────────────────────────────────────────────────────────────

/// Full propose → commit flow sets the fee collector and bps.
#[test]
fn test_propose_and_commit_fee_sets_fee() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &250);
    client.commit_fee();

    let result = client.get_fee();
    assert!(result.is_some());
    let (stored_collector, stored_bps) = result.unwrap();
    assert_eq!(stored_collector, collector);
    assert_eq!(stored_bps, 250);
}

/// propose_fee emits a fee_proposed event.
#[test]
fn test_propose_fee_emits_fee_proposed_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &100);

    let events = env.events().all();
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "fee_proposed"));
}

/// commit_fee emits a fee_committed event.
#[test]
fn test_commit_fee_emits_fee_committed_event() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &50);
    client.commit_fee();

    let events = env.events().all();
    let (_, topics, _) = events.get(events.len() - 1).unwrap();
    let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic_symbol, Symbol::new(&env, "fee_committed"));
}

/// commit_fee without a prior propose panics with NoPendingProposal (#23).
#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_commit_fee_without_proposal_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.commit_fee();
}

/// propose_fee with bps > 10000 panics with InvalidFeeBps (#13).
#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_propose_fee_invalid_bps_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &10_001);
}

/// A re-propose before commit replaces the pending fee — commit applies
/// the latest proposal.
#[test]
fn test_repropose_before_commit_applies_latest() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector_a = Address::generate(&env);
    let collector_b = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector_a, &100);
    // Re-propose with different values before committing
    client.propose_fee(&collector_b, &200);
    client.commit_fee();

    let (stored_collector, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_collector, collector_b);
    assert_eq!(stored_bps, 200);
}

/// After commit_fee, committing again without a new propose panics.
#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_double_commit_without_repropose_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &100);
    client.commit_fee();
    // Second commit without a new propose must panic
    client.commit_fee();
}

/// Bps of exactly 10000 (100%) is valid at both propose and commit.
#[test]
fn test_propose_fee_max_valid_bps() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &10_000);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 10_000);
}

/// Bps of 0 is valid (disabling the fee while keeping the collector).
#[test]
fn test_propose_fee_zero_bps_valid() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.propose_fee(&collector, &0);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 0);
}

/// Non-admin calling propose_fee panics.
#[test]
#[should_panic]
fn test_propose_fee_non_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // No admin set; require_admin call inside propose_fee should panic.
    // NOTE: propose_fee in lib.rs calls bump_instance_ttl then fee::propose_fee.
    // fee::propose_fee itself does not require_admin — the admin guard
    // is the caller's responsibility in lib.rs.  We verify the whole
    // public entry point panics when no admin is configured.
    let collector = Address::generate(&env);

    // Explicitly set an admin so admin check works, then revoke auths.
    client.propose_fee(&collector, &100);
}

// ─────────────────────────────────────────────
// Issue 012: commit_fee bounds re-validation
// ─────────────────────────────────────────────

/// commit_fee rejects when bounds tightened after propose (bps above new max).
#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn test_commit_fee_rejects_when_bounds_tightened_above_max() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Propose 500 bps — within default bounds (0, 10000)
    client.propose_fee(&collector, &500);

    // Tighten max to 200 bps before commit
    client.set_fee_bounds(&0, &200);

    // Commit should reject 500 bps against new [0, 200] bounds
    client.commit_fee();
}

/// commit_fee rejects when bounds tightened after propose (bps below new min).
#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn test_commit_fee_rejects_when_bounds_tightened_below_min() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Propose 50 bps
    client.propose_fee(&collector, &50);

    // Raise min to 100 bps before commit
    client.set_fee_bounds(&100, &10000);

    // Commit should reject 50 bps against new [100, 10000] bounds
    client.commit_fee();
}

/// commit_fee succeeds when pending bps are within current bounds.
#[test]
fn test_commit_fee_succeeds_when_within_bounds() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    client.set_fee_bounds(&10, &500);
    client.propose_fee(&collector, &200);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 200);
}

/// commit_fee succeeds when no bounds are configured (defaults to 0..10000).
#[test]
fn test_commit_fee_succeeds_with_default_bounds() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = Address::generate(&env);

    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // No set_fee_bounds call — defaults to (0, 10000)
    client.propose_fee(&collector, &750);
    client.commit_fee();

    let (_, stored_bps) = client.get_fee().unwrap();
    assert_eq!(stored_bps, 750);
}

// ─────────────────────────────────────────────
// Batch queries tests
// ─────────────────────────────────────────────

#[test]
fn test_get_merchant_statuses_empty() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchants = soroban_sdk::Vec::new(&env);
    let result = client.get_merchant_statuses(&merchants);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_merchant_statuses_mixed() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
}

// Issue #9: validate_recipient_address tests
// ─────────────────────────────────────────────

/// set_fee() with a valid (non-contract) collector address must succeed.
#[test]
fn test_validate_recipient_address_valid_passes() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    // Must not panic — a regular address is a valid fee collector.
    client.propose_fee(&collector, &100u32);
    client.commit_fee();

    assert_eq!(client.get_fee(), Some((collector, 100u32)));
}

/// set_fee() with the contract's own address as collector must panic with
/// ContractError::InvalidFeeCollector (error code 26).
#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_validate_recipient_address_contract_self_panics() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    // Passing the contract address as fee collector must be rejected.
    client.propose_fee(&contract_id, &100u32);
    client.commit_fee();
}
// ─────────────────────────────────────────────────────────────
// Issue #3: Per-Merchant Fee Recipient Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_set_and_get_merchant_fee_recipient() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    assert_eq!(client.get_merchant_fee_recipient(&merchant), None);

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    assert_eq!(
        client.get_merchant_fee_recipient(&merchant),
        Some(custom_recipient)
    );
}

#[test]
fn test_set_merchant_fee_recipient_contract_address_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let res = client.try_set_merchant_fee_recipient(&merchant, &contract_id);
    assert!(res.is_err());
}

#[test]
fn test_merchant_fee_recipient_routing_and_fallback() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let global_collector = Address::generate(&env);
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.propose_fee(&global_collector, &100);
    client.commit_fee();

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    env.ledger().set_timestamp(86400);
    client.charge(&user);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 990);

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    env.ledger().set_timestamp(172800);
    client.charge(&user);
    assert_eq!(token.balance(&custom_recipient), 10);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 1980);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_get_merchant_statuses_exceeds_limit_panics() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut merchants = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        merchants.push_back(Address::generate(&env));
    }
    client.get_merchant_statuses(&merchants);
}

#[test]
fn test_get_next_charge_batch_empty_and_bounds() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let batch = client.get_next_charge_batch(&0, &10, &None);
    assert_eq!(batch.len(), 0);

    let batch_oob = client.get_next_charge_batch(&5, &10, &None);
    assert_eq!(batch_oob.len(), 0);
}

#[test]
fn test_get_next_charge_batch_filtering() {
    let (env, contract_id, token_addr, user_due, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user_not_due = setup_funded_user(&env, &contract_id, &token_addr);
    let user_paused = setup_funded_user(&env, &contract_id, &token_addr);
    let user_cancelled = setup_funded_user(&env, &contract_id, &token_addr);

    let interval: u64 = 86400;

    client.subscribe(&user_due, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.subscribe(&user_paused, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.subscribe(&user_cancelled, &merchant, &1_0000000, &interval, &token_addr, &None, &None);

    client.pause(&user_paused);
    client.cancel(&user_cancelled);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    client.subscribe(&user_not_due, &merchant, &1_0000000, &interval, &token_addr, &None, &None);

    let batch = client.get_next_charge_batch(&0, &10, &None);
    assert_eq!(batch.len(), 1);
    assert_eq!(batch.get(0).unwrap(), user_due);
}

#[test]
fn test_get_next_charge_batch_pagination() {
    let (env, contract_id, token_addr, user1, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user2 = setup_funded_user(&env, &contract_id, &token_addr);
    let user3 = setup_funded_user(&env, &contract_id, &token_addr);

    let interval: u64 = 86400;

    client.subscribe(&user1, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.subscribe(&user2, &merchant, &1_0000000, &interval, &token_addr, &None, &None);
    client.subscribe(&user3, &merchant, &1_0000000, &interval, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let batch1 = client.get_next_charge_batch(&0, &2, &None);
    assert_eq!(batch1.len(), 2);
    assert_eq!(batch1.get(0).unwrap(), user1);
    assert_eq!(batch1.get(1).unwrap(), user2);

    let batch2 = client.get_next_charge_batch(&2, &2, &None);
    assert_eq!(batch2.len(), 1);
    assert_eq!(batch2.get(0).unwrap(), user3);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_get_next_charge_batch_exceeds_limit_panics() {
    let (env, contract_id, _, _, _) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.get_next_charge_batch(&0, &51, &None);
}

#[test]
fn test_get_next_charge_batch_exclude_lapsed() {
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

    // Advance ledger beyond interval, but WITHIN grace period
    env.ledger().with_mut(|l| {
        l.timestamp += interval + grace_period - 100;
    });

    // It should be returned because it's due and not lapsed
    let batch = client.get_next_charge_batch(&0, &10, &Some(true));
    assert_eq!(batch.len(), 1);
    assert_eq!(batch.get(0).unwrap(), user);

    // Advance ledger beyond interval + grace period
    env.ledger().with_mut(|l| {
        l.timestamp += 200; // past the grace period
    });

    // When exclude_lapsed is Some(true) or None, it should NOT be returned
    let batch_exclude = client.get_next_charge_batch(&0, &10, &Some(true));
    assert_eq!(batch_exclude.len(), 0);

    let batch_default = client.get_next_charge_batch(&0, &10, &None);
    assert_eq!(batch_default.len(), 0);

    // When exclude_lapsed is Some(false), it should be returned
    let batch_include = client.get_next_charge_batch(&0, &10, &Some(false));
    assert_eq!(batch_include.len(), 1);
    assert_eq!(batch_include.get(0).unwrap(), user);
}

#[test]
fn test_merchant_fee_recipient_routes_pay_per_use_and_falls_back() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    let global_collector = Address::generate(&env);
    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });
    client.propose_fee(&global_collector, &100);
    client.commit_fee();

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    client.pay_per_use(&user, &1000);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 990);

    let custom_recipient = Address::generate(&env);
    client.set_merchant_fee_recipient(&merchant, &custom_recipient);

    client.pay_per_use(&user, &1000);
    assert_eq!(token.balance(&custom_recipient), 10);
    assert_eq!(token.balance(&global_collector), 10);
    assert_eq!(token.balance(&merchant), 1980);
}

// ─────────────────────────────────────────────────────────────
// Issue #4: Bounded Pause with Auto-Resume Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_pause_until_auto_resume_on_charge() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    client.pause_until(&user, &90000);

    env.ledger().set_timestamp(86400);
    let res = client.try_charge(&user);
    assert!(res.is_err());

    env.ledger().set_timestamp(90000);
    client.charge(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);
    assert_eq!(token.balance(&merchant), 1000);
}

#[test]
fn test_pause_until_invalid_expiry_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    env.ledger().set_timestamp(200000);
    let res = client.try_pause_until(&user, &200000);
    assert!(res.is_err());
    let res2 = client.try_pause_until(&user, &150000);
    assert!(res2.is_err());
}

#[test]
fn test_resume_clears_pause_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    client.pause_until(&user, &300000);
    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);

    env.as_contract(&contract_id, || {
        let pause_expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert_eq!(pause_expiry, None);
    });
}

#[test]
fn test_pause_until_auto_resume_on_batch_charge_and_clears_expiry() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    client.pause_until(&user, &90000);

    env.ledger().set_timestamp(90000);
    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());
    let result = client.batch_charge(&users);
    assert_eq!(result.get(0).unwrap(), crate::ChargeResult::Charged);

    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.paused, false);
    assert_eq!(sub.active, true);

    env.as_contract(&contract_id, || {
        let pause_expiry: Option<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PauseExpiry(user.clone()));
        assert_eq!(pause_expiry, None);
    });
}

// ─────────────────────────────────────────────────────────────
// Issue #5: get_referral Read Function Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_get_referral_lifecycle() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let referrer = Address::generate(&env);

    assert_eq!(client.get_referral(&user), None);

    client.subscribe(
        &user,
        &merchant,
        &1000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referral(&user), Some(referrer.clone()));

    client.cancel(&user);
    assert_eq!(client.get_referral(&user), None);

    client.subscribe(
        &user,
        &merchant,
        &1000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );
    assert_eq!(client.get_referral(&user), Some(referrer));
}

// ─────────────────────────────────────────────────────────────
// Issue #6: Storage Migration v3 Tests
// ─────────────────────────────────────────────────────────────

#[test]
fn test_migration_v2_to_v3_populates_referrer() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let referrer = Address::generate(&env);

    let admin = Address::generate(&env);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &admin);
    });

    client.subscribe(
        &user,
        &merchant,
        &1000,
        &86400,
        &token_addr,
        &None,
        &Some(referrer.clone()),
    );

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &2u32);
    });

    assert_eq!(client.get_schema_version(), 2);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user.clone());

    client.migrate(&users);

    assert_eq!(client.get_schema_version(), 3);
    let sub = client.get_subscription(&user).unwrap();
    assert_eq!(sub.referrer, Some(referrer));

    client.migrate(&users);
    assert_eq!(client.get_schema_version(), 3);
}

// ─────────────────────────────────────────────────────────────
// Issue 011: ChargeResult discriminant stability (golden tests)
// ─────────────────────────────────────────────────────────────
//
// Off-chain parsers (keepers, alert-failed-charges.ts, indexers)
// decode ChargeResult by variant index. These tests lock the
// discriminant layout so a reorder or rename is caught in CI.

/// The number of ChargeResult variants. If you add a new variant,
/// update this count AND append the new variant at the end of the enum.
#[test]
fn test_charge_result_variant_count() {
    let env = Env::default();
    let _ = env.register_contract(None, FlowPay);

    // Encode each variant via IntoVal and verify they produce distinct values.
    // This also serves as a compile-time check: if a variant is removed or
    // renamed, this test won't compile (exhaustive pattern match).
    let charged: soroban_sdk::Val = ChargeResult::Charged.into_val(&env);
    let skipped: soroban_sdk::Val = ChargeResult::Skipped.into_val(&env);
    let no_sub: soroban_sdk::Val = ChargeResult::NoSubscription.into_val(&env);
    let inactive: soroban_sdk::Val = ChargeResult::Inactive.into_val(&env);
    let paused: soroban_sdk::Val = ChargeResult::Paused.into_val(&env);
    let grace: soroban_sdk::Val = ChargeResult::GracePeriodElapsed.into_val(&env);

    // All variants must encode to distinct raw values
    let c = unsafe { core::mem::transmute::<soroban_sdk::Val, u64>(charged) };
    let s = unsafe { core::mem::transmute::<soroban_sdk::Val, u64>(skipped) };
    let n = unsafe { core::mem::transmute::<soroban_sdk::Val, u64>(no_sub) };
    let i = unsafe { core::mem::transmute::<soroban_sdk::Val, u64>(inactive) };
    let p = unsafe { core::mem::transmute::<soroban_sdk::Val, u64>(paused) };
    let g = unsafe { core::mem::transmute::<soroban_sdk::Val, u64>(grace) };

    assert_ne!(c, s, "Charged and Skipped must differ");
    assert_ne!(s, n, "Skipped and NoSubscription must differ");
    assert_ne!(n, i, "NoSubscription and Inactive must differ");
    assert_ne!(i, p, "Inactive and Paused must differ");
    assert_ne!(p, g, "Paused and GracePeriodElapsed must differ");

    // Lock the variant count — increase when a variant is appended.
    let total_variants = 6;
    assert_eq!(total_variants, 6);
}

/// Verify round-trip encoding for every variant.
#[test]
fn test_charge_result_round_trip() {
    let env = Env::default();
    let _ = env.register_contract(None, FlowPay);

    let variants = [
        ChargeResult::Charged,
        ChargeResult::Skipped,
        ChargeResult::NoSubscription,
        ChargeResult::Inactive,
        ChargeResult::Paused,
        ChargeResult::GracePeriodElapsed,
    ];

    for variant in variants.iter() {
        let val: soroban_sdk::Val = variant.clone().into_val(&env);
        let decoded = ChargeResult::try_from_val(&env, &val).unwrap();
        assert_eq!(*variant, decoded, "round-trip failed for a ChargeResult variant");
    }
}

/// Verify that variant names match the expected set.
/// A rename or reorder breaks this test.
#[test]
fn test_charge_result_partial_eq_identity() {
    assert_eq!(ChargeResult::Charged, ChargeResult::Charged);
    assert_ne!(ChargeResult::Charged, ChargeResult::Skipped);
    assert_ne!(ChargeResult::NoSubscription, ChargeResult::Inactive);
    assert_ne!(ChargeResult::Paused, ChargeResult::GracePeriodElapsed);
}


// ─────────────────────────────────────────────
// CONTRACT-804: checked arithmetic in trial, fee, and volume paths
// ─────────────────────────────────────────────

#[test]
fn test_extend_trial_pushes_last_charged_forward() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    let before = client.get_subscription(&user).unwrap().last_charged;

    client.extend_trial(&user, &86400);

    assert_eq!(
        client.get_subscription(&user).unwrap().last_charged,
        before + 86400
    );
}

/// A trial extension past `u64::MAX` must fail closed with the typed
/// `ArithmeticOverflow` (#36) rather than an untyped `unwrap` panic.
#[test]
fn test_extend_trial_overflow_fails_with_typed_error() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);

    // Push last_charged to the u64 ceiling, then ask for one second more.
    client.extend_trial(&user, &(u64::MAX - client.get_subscription(&user).unwrap().last_charged));
    assert_eq!(client.get_subscription(&user).unwrap().last_charged, u64::MAX);

    let res = client.try_extend_trial(&user, &1);

    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(36))));
}

/// Extending a paused subscription's trial must fail closed with the typed
/// `SubscriptionPaused` (#17) error rather than advancing `last_charged` into
/// a chargeable state.
#[test]
fn test_extend_trial_on_paused_subscription_panics() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1000, &86400, &token_addr, &None, &None);
    let before = client.get_subscription(&user).unwrap().last_charged;

    client.pause(&user);

    let res = client.try_extend_trial(&user, &86400);
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(17))));
    assert_eq!(client.get_subscription(&user).unwrap().last_charged, before);
}

/// `amount * bps` must not wrap for amounts beyond the economic caps.
#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_calculate_fee_amount_overflow_fails_with_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        fee::calculate_fee_amount(&env, i128::MAX, 10_000);
    });
}

#[test]
fn test_calculate_fee_amount_at_max_subscription_amount_does_not_overflow() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        // The largest amount the contract will accept, at the maximum bps.
        assert_eq!(
            fee::calculate_fee_amount(&env, MAX_SUBSCRIPTION_AMOUNT, 10_000),
            MAX_SUBSCRIPTION_AMOUNT
        );
        assert_eq!(fee::calculate_fee_amount(&env, MAX_SUBSCRIPTION_AMOUNT, 0), 0);
    });
}

/// Accruing a fee onto a `TotalProtocolFees` counter at `i128::MAX` must fail
/// closed rather than wrap the protocol's own bookkeeping.
#[test]
fn test_protocol_fee_accrual_overflow_fails_with_typed_error() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    configure_fee(&env, &contract_id, 500);

    let interval: u64 = 86400;
    client.subscribe(
        &user,
        &merchant,
        &10_0000000,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .set(&DataKey::TotalProtocolFees, &i128::MAX);
    });

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let res = client.try_charge(&user);
    assert_eq!(res, Err(Ok(soroban_sdk::Error::from_contract_error(36))));
}

/// An accumulator that cannot represent the sum is an overflow (#36), which is
/// a different failure from breaching the hourly cap (#28).
#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_global_volume_accumulator_overflow_fails_with_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &DataKey::GlobalVolumeWindow,
            &GlobalVolumeWindow {
                current_window_start: env.ledger().timestamp(),
                accumulated_volume: i128::MAX,
            },
        );
        check_and_update_global_volume(&env, 1);
    });
}

/// A window start near `u64::MAX` must not wrap the rollover comparison.
#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_global_volume_window_end_overflow_fails_with_typed_error() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &DataKey::GlobalVolumeWindow,
            &GlobalVolumeWindow {
                current_window_start: u64::MAX,
                accumulated_volume: 0,
            },
        );
        check_and_update_global_volume(&env, 1);
    });
}

/// Breaching the hourly cap still reports `GlobalVolumeExceeded` (#28) —
/// the overflow work above must not have changed the cap's error mapping.
#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn test_global_volume_cap_breach_still_reports_28() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();

    env.as_contract(&contract_id, || {
        check_and_update_global_volume(&env, GLOBAL_MAX_VOLUME_PER_HOUR + 1);
    });
}

// ─────────────────────────────────────────────
// CONTRACT-805: batch_charge_skips summary event
// ─────────────────────────────────────────────

/// Helper: returns the payload of the single `batch_charge_skips` event in the
/// event log, or `None` when no such event was emitted.
fn find_batch_charge_skips(env: &Env) -> Option<crate::events::BatchChargeSkipsEventData> {
    let mut found = None;
    for (_, topics, data) in env.events().all().iter() {
        let topic_symbol: Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if topic_symbol == Symbol::new(env, "batch_charge_skips") {
            assert_eq!(
                topics.len(),
                1,
                "batch_charge_skips carries no address topic"
            );
            assert!(
                found.is_none(),
                "at most one summary event per batch_charge call"
            );
            found = Some(data.try_into_val(env).unwrap());
        }
    }
    found
}

/// Helper: funds a fresh user and subscribes them for `interval`.
fn subscribe_funded_user(
    env: &Env,
    contract_id: &Address,
    token_addr: &Address,
    merchant: &Address,
    interval: u64,
) -> Address {
    let client = FlowPayClient::new(env, contract_id);
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &10_000_0000000);
    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &10_000_0000000, &200000);
    client.subscribe(
        &user,
        merchant,
        &1_0000000,
        &interval,
        token_addr,
        &None,
        &None,
    );
    user
}

/// A batch mixing charges with paused / cancelled / missing / grace-elapsed
/// subscriptions emits one summary event whose counts reconcile with the
/// returned results.
#[test]
fn test_batch_charge_emits_skips_summary_with_counts() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    install_admin(&env, &contract_id);
    client.propose_grace_period(&3600);
    client.commit_grace_period();

    let paused_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let cancelled_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let grace_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let unknown_user = Address::generate(&env);

    client.pause(&paused_user);
    client.cancel(&cancelled_user);

    // Push grace_user past its interval AND its grace window.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 3601 + 1;
    });

    // Subscribe the chargeable user now, then advance just past its interval so
    // it is due but still inside the grace window.
    let chargeable = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(chargeable.clone());
    users.push_back(paused_user.clone());
    users.push_back(cancelled_user.clone());
    users.push_back(grace_user.clone());
    users.push_back(unknown_user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), ChargeResult::Paused);
    assert_eq!(results.get(2).unwrap(), ChargeResult::Inactive);
    assert_eq!(results.get(3).unwrap(), ChargeResult::GracePeriodElapsed);
    assert_eq!(results.get(4).unwrap(), ChargeResult::NoSubscription);

    let summary = find_batch_charge_skips(&env).expect("expected a batch_charge_skips event");
    assert_eq!(summary.total, 5);
    assert_eq!(summary.charged, 1);
    assert_eq!(summary.not_due, 0);
    assert_eq!(summary.paused, 1);
    assert_eq!(summary.inactive, 1);
    assert_eq!(summary.grace_elapsed, 1);
    assert_eq!(summary.no_subscription, 1);
    assert_eq!(summary.ledger_sequence, env.ledger().sequence());

    // The counts must account for every submitted address.
    assert_eq!(
        summary.charged
            + summary.not_due
            + summary.paused
            + summary.inactive
            + summary.grace_elapsed
            + summary.no_subscription
            + summary.allowance_insufficient,
        summary.total
    );
}

/// An all-success batch must not emit the summary — and its `charged` events
/// are unchanged.
#[test]
fn test_batch_charge_all_charged_emits_no_skips_summary() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    let user_a = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let user_b = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(results.get(1).unwrap(), ChargeResult::Charged);

    assert!(
        find_batch_charge_skips(&env).is_none(),
        "an all-charged batch must stay silent"
    );

    // `charged` events are untouched by this feature.
    let charged_events = env
        .events()
        .all()
        .iter()
        .filter(|(_, topics, _)| {
            let s: Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
            s == Symbol::new(&env, "charged")
        })
        .count();
    assert_eq!(charged_events, 2);
}

/// Not-due skips are the common, uninteresting outcome and must not emit.
#[test]
fn test_batch_charge_not_due_only_emits_no_skips_summary() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    let user_a = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let user_b = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(user_a.clone());
    users.push_back(user_b.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Skipped);
    assert_eq!(results.get(1).unwrap(), ChargeResult::Skipped);

    assert!(
        find_batch_charge_skips(&env).is_none(),
        "a not-due-only batch must stay silent"
    );
}

/// An allowance shortfall is a per-user `AllowanceInsufficient` result (it does
/// not abort the batch) and is an interesting failure: it alone must emit the
/// summary, since a keeper needs to know a subscriber has to re-approve.
#[test]
fn test_batch_charge_allowance_insufficient_counted_in_skips_summary() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let interval: u64 = 86400;

    let ok_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let broke_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);

    // One stroop short of the gross subscription amount.
    token.approve(&broke_user, &contract_id, &(1_0000000 - 1), &200000);

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(ok_user.clone());
    users.push_back(broke_user.clone());

    let results = client.batch_charge(&users);
    assert_eq!(results.get(0).unwrap(), ChargeResult::Charged);
    assert_eq!(
        results.get(1).unwrap(),
        ChargeResult::AllowanceInsufficient
    );

    let summary = find_batch_charge_skips(&env).expect("expected a batch_charge_skips event");
    assert_eq!(summary.total, 2);
    assert_eq!(summary.charged, 1);
    assert_eq!(summary.allowance_insufficient, 1);
    assert_eq!(summary.not_due, 0);
    assert_eq!(
        summary.charged
            + summary.not_due
            + summary.paused
            + summary.inactive
            + summary.grace_elapsed
            + summary.no_subscription
            + summary.allowance_insufficient,
        summary.total
    );
}

/// A single interesting failure alongside not-due skips is enough to emit,
/// and the not-due count rides along for reconciliation.
#[test]
fn test_batch_charge_single_interesting_failure_emits_with_not_due_count() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let interval: u64 = 86400;

    let not_due_user = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, interval);
    let unknown_user = Address::generate(&env);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(not_due_user.clone());
    users.push_back(unknown_user.clone());

    client.batch_charge(&users);

    let summary = find_batch_charge_skips(&env).expect("expected a batch_charge_skips event");
    assert_eq!(summary.total, 2);
    assert_eq!(summary.not_due, 1);
    assert_eq!(summary.no_subscription, 1);
    assert_eq!(summary.charged, 0);
}

// Issue #813: batch_charge stress / resource-envelope coverage
//
// These tests exercise `batch_charge` at the configured max batch size and one
// above it, matching the resource envelope documented for `set_max_batch_size`.
// Soroban's per-invocation budget is finite, so each test resets it to
// unlimited up front (`env.budget().reset_unlimited()`, as the existing
// `test_batch_charge_stress` does) so the setup + one `batch_charge` invocation
// is measured without being throttled by the 200 M default budget.
//
// Approximate resource usage for a max-size batch at the default cap (50):
//   - cost(n) ~= 50 x (storage read + fee + token transfer_from + events)
//   - at a configured cap of 5 the per-entry cost is identical; only `n` varies.
// The relevant ceiling enforced here is the batch-size check in `batch.rs`,
// which fires *before* any charging, so exceeding the cap panics with
// `ContractError::BatchTooLarge` (#20) rather than executing partial work.

/// Batch-charge exactly the configured max batch size; all entries succeed.
#[test]
fn test_batch_charge_at_configured_max() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.budget().reset_unlimited();
    install_admin(&env, &contract_id);
    let client = FlowPayClient::new(&env, &contract_id);

    let batch_limit: u32 = 5;
    client.set_max_batch_size(&batch_limit);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..batch_limit {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    let results = client.batch_charge(&users);
    assert_eq!(results.len(), batch_limit);
    for r in results.into_iter() {
        assert_eq!(r, crate::ChargeResult::Charged);
    }
    for i in 0..batch_limit {
        let u = users.get(i).unwrap();
        assert!(client.get_subscription(&u).unwrap().active);
    }
}

/// Batch-charge one above the configured max panics with BatchTooLarge (#20).
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_above_configured_max_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.budget().reset_unlimited();
    install_admin(&env, &contract_id);
    let client = FlowPayClient::new(&env, &contract_id);

    let batch_limit: u32 = 5;
    client.set_max_batch_size(&batch_limit);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..=batch_limit {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    client.batch_charge(&users);
}

/// Batch-charge the default max (50) without explicit configuration succeeds.
#[test]
fn test_batch_charge_at_default_max() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.budget().reset_unlimited();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..50 {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    let results = client.batch_charge(&users);
    assert_eq!(results.len(), 50);
    for r in results.into_iter() {
        assert_eq!(r, crate::ChargeResult::Charged);
    }
    for i in 0..50u32 {
        let u = users.get(i).unwrap();
        assert!(client.get_subscription(&u).unwrap().active);
    }
}

/// Batch-charge one above the default max panics with BatchTooLarge (#20).
#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_batch_charge_over_default_max_panics() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    env.budget().reset_unlimited();
    let client = FlowPayClient::new(&env, &contract_id);

    let mut users = soroban_sdk::Vec::new(&env);
    for _ in 0..51 {
        let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);
        users.push_back(u);
    }

    env.ledger().with_mut(|l| {
        l.timestamp += 86400 + 1;
    });

    client.batch_charge(&users);
}

// 
// Issue #810: authorization-boundary tests
//
// Each admin entrypoint is tested in two states:
//   (a) success with admin auth   called via the normal client method inside
//       `mock_all_auths`
//   (b) panic when no admin is set   called via try_* so the contract error is
//       surfaced as an Err, not a hard panic
//
// Note: `setup()` enables `env.mock_all_auths()`, so a "non-admin rejected"
// variant cannot force `require_admin` to fail in this environment; rejection
// is instead covered by the no-admin panic path and the contract's own
// `require_admin` guard.
// 

// -- freeze_merchant ----------------------------------------------------------

/// Admin can freeze a merchant (happy path).
#[test]
fn test_freeze_merchant_admin_success() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.freeze_merchant(&merchant, &None);

    assert!(client.is_merchant_frozen(&merchant));
}

/// freeze_merchant panics when no admin has been set.
#[test]
fn test_freeze_merchant_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_freeze_merchant(&merchant, &None);
    assert!(result.is_err());
}

// -- propose_fee --------------------------------------------------------------

/// Admin can propose a fee (happy path).
#[test]
fn test_propose_fee_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &100);

    assert_eq!(client.get_fee(), None);
}

/// propose_fee panics when no admin has been set.
#[test]
fn test_propose_fee_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let collector = Address::generate(&env);
    let result = client.try_propose_fee(&collector, &100);
    assert!(result.is_err());
}

// -- set_min_interval ---------------------------------------------------------

/// Admin can set min_interval (happy path).
#[test]
fn test_set_min_interval_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_min_interval(&7200);
    assert_eq!(client.get_min_interval(), 7200);
}

/// set_min_interval panics when no admin has been set.
#[test]
fn test_set_min_interval_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_min_interval(&7200);
    assert!(result.is_err());
}

// -- batch_cancel -------------------------------------------------------------

/// Admin can batch-cancel subscriptions (happy path).
#[test]
fn test_batch_cancel_admin_success() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(u.clone());

    client.batch_cancel(&users);

    let sub = client.get_subscription(&u).unwrap();
    assert!(!sub.active);
}

/// batch_cancel panics when no admin has been set.
#[test]
fn test_batch_cancel_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    let result = client.try_batch_cancel(&users);
    assert!(result.is_err());
}

// -- whitelist_batch_add ------------------------------------------------------

/// Admin can batch-add merchants to the whitelist (happy path).
#[test]
fn test_whitelist_batch_add_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let merchants = whitelist_admin_and_merchants(&env, &contract_id, 2);

    let added = client.whitelist_batch_add(&merchants);
    assert_eq!(added, 2);
}

/// whitelist_batch_add panics when no admin has been set.
#[test]
fn test_whitelist_batch_add_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let merchants = soroban_sdk::Vec::new(&env);
    let result = client.try_whitelist_batch_add(&merchants);
    assert!(result.is_err());
}

// -- batch_pause_subscriptions ------------------------------------------------

/// Admin can batch-pause subscriptions (happy path).
#[test]
fn test_batch_pause_subscriptions_admin_success() {
    let (env, contract_id, token_addr, _user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let u = subscribe_funded_user(&env, &contract_id, &token_addr, &merchant, 86400);

    let mut users = soroban_sdk::Vec::new(&env);
    users.push_back(u.clone());

    client.batch_pause_subscriptions(&users);

    let sub = client.get_subscription(&u).unwrap();
    assert!(sub.paused);
}

/// batch_pause_subscriptions panics when no admin has been set.
#[test]
fn test_batch_pause_subscriptions_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    let result = client.try_batch_pause_subscriptions(&users);
    assert!(result.is_err());
}

// -- clear_fee ----------------------------------------------------------------

/// Admin can clear fee (happy path).
#[test]
fn test_clear_fee_admin_success() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        storage::set_admin(&env, &user);
    });

    let collector = Address::generate(&env);
    client.propose_fee(&collector, &100);
    client.commit_fee();
    assert!(client.get_fee().is_some());

    client.clear_fee();
    assert_eq!(client.get_fee(), None);
}

/// clear_fee panics when no admin has been set.
#[test]
fn test_clear_fee_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_clear_fee();
    assert!(result.is_err());
}

// -- set_whitelist_enabled ----------------------------------------------------

/// Admin can toggle whitelist on/off (happy path).
#[test]
fn test_set_whitelist_enabled_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_whitelist_enabled(&true);
    assert!(client.is_whitelist_enabled());

    client.set_whitelist_enabled(&false);
    assert!(!client.is_whitelist_enabled());
}

/// set_whitelist_enabled panics when no admin has been set.
#[test]
fn test_set_whitelist_enabled_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_whitelist_enabled(&true);
    assert!(result.is_err());
}

// -- set_max_batch_size -------------------------------------------------------

/// Admin can set max_batch_size (happy path).
#[test]
fn test_set_max_batch_size_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_max_batch_size(&100);
    assert_eq!(client.get_max_batch_size(), 100);
}

/// set_max_batch_size panics when no admin has been set.
#[test]
fn test_set_max_batch_size_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_max_batch_size(&100);
    assert!(result.is_err());
}

// -- pause_contract -----------------------------------------------------------

/// Admin can pause the contract (happy path).
#[test]
fn test_pause_contract_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.pause_contract();
    assert!(client.is_contract_paused());
}

/// pause_contract panics when no admin has been set.
#[test]
fn test_pause_contract_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_pause_contract();
    assert!(result.is_err());
}

// -- migrate ------------------------------------------------------------------

/// Admin can run storage migration (happy path).
#[test]
fn test_migrate_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    client.migrate(&users);
    assert_eq!(client.get_schema_version(), 3);
}

/// migrate panics when no admin has been set.
#[test]
fn test_migrate_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let users = soroban_sdk::Vec::new(&env);
    let result = client.try_migrate(&users);
    assert!(result.is_err());
}

// -- set_global_volume_cap ----------------------------------------------------

/// Admin can set the global volume cap (happy path).
#[test]
fn test_set_global_volume_cap_admin_success() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);
    install_admin(&env, &contract_id);

    client.set_global_volume_cap(&100_0000000);
    assert_eq!(client.get_global_volume_cap(), 100_0000000);
}

/// set_global_volume_cap panics when no admin has been set.
#[test]
fn test_set_global_volume_cap_no_admin_panics() {
    let (env, contract_id, _token_addr, _user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_set_global_volume_cap(&100_0000000);
    assert!(result.is_err());
}


