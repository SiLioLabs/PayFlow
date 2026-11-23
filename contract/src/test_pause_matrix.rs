//! Issue #1423: which user-facing entrypoints work while the contract is paused.
//!
//! The matrix is documented in `docs/spec/LIFECYCLE-SPEC.md` (section "Pause
//! matrix"). These tests enforce it:
//!
//! - Blocked: subscribe, charge, pay-per-use, fund-moving or subscription-editing
//!   calls return `ContractPaused` (18), checked before any other validation.
//! - Exit paths: `cancel`, `resume` and `remove_daily_limit` still succeed, so users
//!   can always leave a paused contract.
#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

const AMOUNT: i128 = 1_0000000;
const INTERVAL: u64 = 3_600;
/// `ContractError::ContractPaused`.
const CONTRACT_PAUSED: u32 = 18;

/// Initialised contract with one funded, live subscription (user -> merchant).
/// Returns (env, contract_id, token_addr, user, merchant).
fn paused_fixture() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    let client = FlowPayClient::new(&env, &contract_id);
    client.initialize(&token_addr, &admin);
    env.as_contract(&contract_id, || {
        whitelist::set_whitelist_enabled(&env, false);
    });

    StellarAssetClient::new(&env, &token_addr).mint(&user, &10_000_0000000i128);
    TokenClient::new(&env, &token_addr).approve(&user, &contract_id, &10_000_0000000i128, &200_000u32);

    client.subscribe(&user, &merchant, &AMOUNT, &INTERVAL, &token_addr, &None, &None);

    (env, contract_id, token_addr, user, merchant)
}

/// The contract error a `try_*` call returns when it hits the contract pause.
/// Compare as `Err(Ok(paused_error()))`.
fn paused_error() -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(CONTRACT_PAUSED)
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocked while paused (ContractPaused, #18)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_paused_blocks_subscribe() {
    let (env, contract_id, token_addr, _user, merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    let newcomer = Address::generate(&env);
    let res = client.try_subscribe(&newcomer, &merchant, &AMOUNT, &INTERVAL, &token_addr, &None, &None);
    assert_eq!(res, Err(Ok(paused_error())));
    assert!(client.get_subscription(&newcomer).is_none());
}

#[test]
fn test_paused_blocks_subscribe_with_metadata() {
    let (env, contract_id, token_addr, _user, merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    let newcomer = Address::generate(&env);
    let res = client.try_subscribe_with_metadata(
        &newcomer,
        &merchant,
        &AMOUNT,
        &INTERVAL,
        &token_addr,
        &None,
        &None,
        &soroban_sdk::String::from_str(&env, "premium"),
    );
    assert_eq!(res, Err(Ok(paused_error())));
}

#[test]
fn test_paused_blocks_charge() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    // Make the interval elapse so only the pause can be the reason for refusal.
    env.ledger().with_mut(|l| {
        l.timestamp += INTERVAL + 1;
    });

    assert_eq!(client.try_charge(&user), Err(Ok(paused_error())));
}

#[test]
fn test_paused_blocks_charge_with_tip() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    env.ledger().with_mut(|l| {
        l.timestamp += INTERVAL + 1;
    });

    let keeper = Address::generate(&env);
    assert_eq!(
        client.try_charge_with_tip(&user, &keeper),
        Err(Ok(paused_error()))
    );
}

#[test]
fn test_paused_blocks_batch_charge() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    let users = soroban_sdk::vec![&env, user.clone()];
    assert_eq!(client.try_batch_charge(&users), Err(Ok(paused_error())));
}

#[test]
fn test_paused_blocks_pay_per_use() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    assert_eq!(client.try_pay_per_use(&user, &1_0000i128), Err(Ok(paused_error())));
}

#[test]
fn test_paused_blocks_pay_per_use_to() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    let recipient = Address::generate(&env);
    assert_eq!(
        client.try_pay_per_use_to(&user, &1_0000i128, &recipient),
        Err(Ok(paused_error()))
    );
}

#[test]
fn test_paused_blocks_set_subscription_amount() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    assert_eq!(
        client.try_set_subscription_amount(&user, &2_0000000i128),
        Err(Ok(paused_error()))
    );
}

#[test]
fn test_paused_blocks_set_subscription_interval() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    assert_eq!(
        client.try_set_subscription_interval(&user, &7_200u64),
        Err(Ok(paused_error()))
    );
}

#[test]
fn test_paused_blocks_set_merchant_fee_recipient() {
    let (env, contract_id, _token_addr, _user, merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    let recipient = Address::generate(&env);
    assert_eq!(
        client.try_set_merchant_fee_recipient(&merchant, &recipient),
        Err(Ok(paused_error()))
    );
}

#[test]
fn test_paused_blocks_transfer_subscription() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    let new_user = Address::generate(&env);
    assert_eq!(
        client.try_transfer_subscription(&user, &new_user),
        Err(Ok(paused_error()))
    );
}

/// Blocked even with a zero balance: the pause check runs before the revenue check,
/// so a merchant cannot tell from the error whether funds are present.
#[test]
fn test_paused_blocks_withdraw_merchant_revenue() {
    let (env, contract_id, _token_addr, _user, merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    assert_eq!(
        client.try_withdraw_merchant_revenue(&merchant),
        Err(Ok(paused_error()))
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exit paths and reads that stay available while paused
// ─────────────────────────────────────────────────────────────────────────────

/// A user can always cancel while the contract is paused.
#[test]
fn test_paused_allows_cancel() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    client.cancel(&user);

    let sub = client.get_subscription(&user).expect("row is kept after cancel");
    assert!(!sub.active, "cancel must deactivate the subscription while paused");
}

/// A user can resume a subscription they paused before the contract was paused.
#[test]
fn test_paused_allows_resume_of_user_pause() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause(&user);
    client.pause_contract();

    client.resume(&user);

    let sub = client.get_subscription(&user).unwrap();
    assert!(!sub.paused, "resume must clear the user's pause while the contract is paused");
    assert!(sub.active);
}

/// Removing a daily spending cap is user-owned bookkeeping and moves no funds.
#[test]
fn test_paused_allows_remove_daily_limit() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.set_daily_limit(&user, &1_0000000i128);
    client.pause_contract();

    client.remove_daily_limit(&user);

    assert_eq!(client.get_daily_limit(&user), None);
}

/// Read-only views keep working so keepers and frontends can show state.
#[test]
fn test_paused_reads_still_work() {
    let (env, contract_id, _token_addr, user, _merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();

    assert!(client.is_contract_paused());
    assert!(client.get_subscription(&user).is_some());
    assert_eq!(client.get_active_count(), 1);
}

/// Unpausing restores the blocked paths.
#[test]
fn test_unpause_restores_subscribe() {
    let (env, contract_id, token_addr, _user, merchant) = paused_fixture();
    let client = FlowPayClient::new(&env, &contract_id);
    client.pause_contract();
    client.unpause_contract();

    let newcomer = Address::generate(&env);
    StellarAssetClient::new(&env, &token_addr).mint(&newcomer, &10_000_0000000i128);
    TokenClient::new(&env, &token_addr).approve(&newcomer, &contract_id, &10_000_0000000i128, &200_000u32);
    client.subscribe(&newcomer, &merchant, &AMOUNT, &INTERVAL, &token_addr, &None, &None);

    assert!(client.get_subscription(&newcomer).is_some());
}
