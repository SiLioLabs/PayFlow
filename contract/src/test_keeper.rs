//! Keeper-facing tests.
//!
//! - Issue #1424: `get_charges_due_between`, the bounded due-window read.
//! - Issue #1425: `charge_with_tip` and `set_keeper_tip_bps`, the keeper tip paid
//!   out of the protocol fee.
//!
//! Amounts are in stroops. With a 5% protocol fee (500 bps) on a 1 XLM charge
//! (10_000_000 stroops), the fee is 500_000 stroops.
#![cfg(test)]

use super::*;
use crate::fee::MAX_KEEPER_TIP_BPS;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

const START: u64 = 1_000_000;
const AMOUNT: i128 = 1_0000000;

/// Contract initialised with admin and token, whitelist disabled, clock at `START`.
/// Returns (env, contract_id, token_addr, admin, merchant).
fn keeper_setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);

    let client = FlowPayClient::new(&env, &contract_id);
    client.initialize(&token_addr, &admin);
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });
    env.ledger().with_mut(|l| {
        l.timestamp = START;
    });

    (env, contract_id, token_addr, admin, merchant)
}

/// A subscriber with a large balance and an allowance over the contract.
fn funded_subscriber(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    StellarAssetClient::new(env, token_addr).mint(&user, &10_000_0000000i128);
    TokenClient::new(env, token_addr).approve(&user, contract_id, &10_000_0000000i128, &200_000u32);
    user
}

/// Sets a 5% protocol fee (500 bps) collected by a fresh address, and returns it.
fn set_five_percent_fee(env: &Env, client: &FlowPayClient) -> Address {
    let collector = Address::generate(env);
    client.propose_fee(&collector, &500u32);
    client.commit_fee();
    collector
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1424: get_charges_due_between
// ─────────────────────────────────────────────────────────────────────────────

/// Every returned pair carries the subscriber's real `next_charge_at`, and only
/// subscriptions due inside the window are returned.
#[test]
fn test_due_window_matches_next_charge_at_per_user() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let early = funded_subscriber(&env, &contract_id, &token_addr);
    let mid = funded_subscriber(&env, &contract_id, &token_addr);
    let late = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&early, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);
    client.subscribe(&mid, &merchant, &AMOUNT, &86_400u64, &token_addr, &None, &None);
    client.subscribe(&late, &merchant, &AMOUNT, &604_800u64, &token_addr, &None, &None);

    let window_end = START + 100_000;
    let due = client.get_charges_due_between(&START, &window_end, &0u64, &50u32);

    assert_eq!(due.len(), 2, "the week-long subscription is outside the window");
    for i in 0..due.len() {
        let (addr, at) = due.get(i).unwrap();
        assert_eq!(client.next_charge_at(&addr), Some(at));
        assert!(at >= START && at <= window_end);
        assert!(addr != late);
    }
}

/// Both window bounds are inclusive.
#[test]
fn test_due_window_bounds_are_inclusive() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);
    let due_at = START + 3_600;

    let exact = client.get_charges_due_between(&due_at, &due_at, &0u64, &50u32);
    assert_eq!(exact.len(), 1);
    assert_eq!(exact.get(0).unwrap(), (user.clone(), due_at));

    let just_after = client.get_charges_due_between(&(due_at + 1), &(due_at + 100), &0u64, &50u32);
    assert_eq!(just_after.len(), 0);
}

/// Walking the index one slot at a time finds the same subscribers as one wide page.
#[test]
fn test_due_window_paging_covers_every_match() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    for interval in [3_600u64, 7_200, 90_000] {
        let user = funded_subscriber(&env, &contract_id, &token_addr);
        client.subscribe(&user, &merchant, &AMOUNT, &interval, &token_addr, &None, &None);
    }

    let window_end = START + 100_000;
    let wide = client.get_charges_due_between(&START, &window_end, &0u64, &50u32);

    let slots = client.get_subscriber_count();
    let mut paged = 0u32;
    let mut offset = 0u64;
    while offset < slots {
        paged += client
            .get_charges_due_between(&START, &window_end, &offset, &1u32)
            .len();
        offset += 1;
    }

    // All three intervals (3_600, 7_200, 90_000) fall inside the window.
    assert_eq!(wide.len(), 3);
    assert_eq!(paged, wide.len());
}

/// The page size is capped like `get_next_charge_batch`: 51 is rejected.
#[test]
fn test_due_window_rejects_page_above_cap() {
    let (env, contract_id, _token_addr, _admin, _merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let result = client.try_get_charges_due_between(&START, &(START + 1), &0u64, &51u32);
    assert!(result.is_err(), "limit above SUBSCRIBER_PAGE_SIZE must be rejected");

    let at_cap = client.try_get_charges_due_between(&START, &(START + 1), &0u64, &50u32);
    assert!(at_cap.is_ok());
}

/// `limit == 0` and an inverted window both return an empty list without error.
#[test]
fn test_due_window_empty_for_zero_limit_or_inverted_window() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    assert_eq!(
        client
            .get_charges_due_between(&START, &(START + 100_000), &0u64, &0u32)
            .len(),
        0
    );
    assert_eq!(
        client
            .get_charges_due_between(&(START + 100_000), &START, &0u64, &50u32)
            .len(),
        0
    );
}

/// Cancelled (tombstoned) and paused subscriptions are never reported as due.
#[test]
fn test_due_window_skips_cancelled_and_paused() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let cancelled = funded_subscriber(&env, &contract_id, &token_addr);
    let paused = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&cancelled, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);
    client.subscribe(&paused, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    client.cancel(&cancelled);
    client.pause(&paused);

    let due = client.get_charges_due_between(&START, &(START + 100_000), &0u64, &50u32);
    assert_eq!(due.len(), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1425: keeper tip paid out of the protocol fee
// ─────────────────────────────────────────────────────────────────────────────

/// The tip is off until the admin sets it.
#[test]
fn test_keeper_tip_defaults_to_zero() {
    let (env, contract_id, _token_addr, _admin, _merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    assert_eq!(client.get_keeper_tip_bps(), 0);
}

/// A 20% tip on a 5% fee: the keeper gets 100_000 stroops, the collector gets the
/// other 400_000, and the merchant's net stays at 9_500_000. Every stroop of the
/// 10_000_000 gross is accounted for.
#[test]
fn test_charge_with_tip_pays_keeper_out_of_protocol_fee() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = set_five_percent_fee(&env, &client);
    client.set_keeper_tip_bps(&2_000u32);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = START + 3_600 + 1;
    });
    let keeper = Address::generate(&env);
    client.charge_with_tip(&user, &keeper);

    let token = TokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&keeper), 100_000);
    assert_eq!(token.balance(&collector), 400_000);
    assert_eq!(token.balance(&merchant), 9_500_000);
    assert_eq!(
        token.balance(&keeper) + token.balance(&collector) + token.balance(&merchant),
        AMOUNT,
        "fee + net must equal the gross charge"
    );
    assert_eq!(client.get_total_protocol_fees(), 400_000);
}

/// With a 0 bps tip, `charge_with_tip` charges the same as `charge` and the keeper
/// receives nothing.
#[test]
fn test_charge_with_tip_at_zero_bps_pays_no_tip() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = set_five_percent_fee(&env, &client);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = START + 3_600 + 1;
    });
    let keeper = Address::generate(&env);
    client.charge_with_tip(&user, &keeper);

    let token = TokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&keeper), 0);
    assert_eq!(token.balance(&collector), 500_000);
    assert_eq!(token.balance(&merchant), 9_500_000);
}

/// A plain `charge` never pays a tip, even when one is configured.
#[test]
fn test_plain_charge_pays_no_tip_even_when_configured() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    let collector = set_five_percent_fee(&env, &client);
    client.set_keeper_tip_bps(&5_000u32);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = START + 3_600 + 1;
    });
    client.charge(&user);

    assert_eq!(TokenClient::new(&env, &token_addr).balance(&collector), 500_000);
}

/// With no protocol fee configured there is nothing to tip from, so the keeper is
/// paid nothing and the merchant receives the full gross amount.
#[test]
fn test_keeper_tip_needs_a_protocol_fee() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    client.set_keeper_tip_bps(&5_000u32);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = START + 3_600 + 1;
    });
    let keeper = Address::generate(&env);
    client.charge_with_tip(&user, &keeper);

    let token = TokenClient::new(&env, &token_addr);
    assert_eq!(token.balance(&keeper), 0);
    assert_eq!(token.balance(&merchant), AMOUNT);
}

/// The tip is capped at `MAX_KEEPER_TIP_BPS` (half the fee). Above the cap is rejected.
#[test]
fn test_keeper_tip_bps_is_capped() {
    let (env, contract_id, _token_addr, _admin, _merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let over = client.try_set_keeper_tip_bps(&(MAX_KEEPER_TIP_BPS + 1));
    assert_eq!(
        over,
        Err(Ok(soroban_sdk::Error::from_contract_error(49))),
        "tips above the cap must fail with InvalidKeeperTipBps (49)"
    );
    assert_eq!(client.get_keeper_tip_bps(), 0, "a rejected value must not be stored");

    client.set_keeper_tip_bps(&MAX_KEEPER_TIP_BPS);
    assert_eq!(client.get_keeper_tip_bps(), MAX_KEEPER_TIP_BPS);
}

/// `charge_with_tip` requires the keeper's own authorization.
#[test]
fn test_charge_with_tip_requires_keeper_auth() {
    let (env, contract_id, token_addr, _admin, merchant) = keeper_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    set_five_percent_fee(&env, &client);
    client.set_keeper_tip_bps(&2_000u32);

    let user = funded_subscriber(&env, &contract_id, &token_addr);
    client.subscribe(&user, &merchant, &AMOUNT, &3_600u64, &token_addr, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp = START + 3_600 + 1;
    });
    let keeper = Address::generate(&env);
    env.set_auths(&[]);

    let result = client.try_charge_with_tip(&user, &keeper);
    assert!(result.is_err(), "charge_with_tip must reject a call without keeper auth");
    assert_eq!(TokenClient::new(&env, &token_addr).balance(&keeper), 0);
}
