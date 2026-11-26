#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

use crate::{AcademyVestingContract, AcademyVestingContractClient, VestingError};

fn setup() -> (Env, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let governance = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_contract.address();

    let contract_id = env.register(AcademyVestingContract, ());

    (env, contract_id, admin, token_addr, governance, beneficiary)
}

#[test]
fn test_init_and_get_info() {
    let (env, contract_id, admin, token_addr, governance, _beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);

    client.init(&admin, &token_addr, &governance);

    let (ret_admin, ret_token, ret_gov) = client.get_info();
    assert_eq!(ret_admin, admin);
    assert_eq!(ret_token, token_addr);
    assert_eq!(ret_gov, governance);

    // Initializing again should fail
    let res = client.try_init(&admin, &token_addr, &governance);
    assert!(res.is_err());
}

#[test]
fn test_get_info_before_init_returns_unauthorized() {
    let (env, contract_id, _admin, _token_addr, _governance, _beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    assert!(matches!(
        client.try_get_info(),
        Err(Ok(VestingError::Unauthorized))
    ));
}

#[test]
fn test_init_requires_admin_authorization() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let reward_token = Address::generate(&env);
    let governance = Address::generate(&env);
    let contract_id = env.register(AcademyVestingContract, ());
    let client = AcademyVestingContractClient::new(&env, &contract_id);

    assert!(client.try_init(&admin, &reward_token, &governance).is_err());
    env.mock_all_auths();
    client.init(&admin, &reward_token, &governance);
    assert_eq!(client.get_info(), (admin, reward_token, governance));
}

#[test]
fn test_grant_and_claim_flow() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    client.init(&admin, &token_addr, &governance);

    let amount: i128 = 1000;
    let start_time: u64 = 1000;
    let cliff: u64 = 100;
    let duration: u64 = 1000;

    env.ledger().set_timestamp(start_time);

    let grant_id = client.grant_vesting(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &cliff,
        &duration,
    );
    assert_eq!(grant_id, 1);

    // Check before cliff
    env.ledger().set_timestamp(start_time + 50);
    assert_eq!(client.get_vested_amount(&grant_id), 0);

    // Attempt claim before cliff should fail
    let claim_res = client.try_claim(&grant_id, &beneficiary);
    assert_eq!(claim_res, Err(Ok(VestingError::NotVested)));

    // Fund the contract with reward tokens
    sac.mint(&contract_id, &amount);

    // Advance to 50% post-cliff (start + 100 + 450 = 1550) -> vested = 1000 * 450 / 900 = 500
    env.ledger().set_timestamp(start_time + 550);
    let vested = client.get_vested_amount(&grant_id);
    assert_eq!(vested, 500);

    // Claim 500 tokens
    let beneficiary_bal_before = token.balance(&beneficiary);
    let claimed = client.claim(&grant_id, &beneficiary);
    assert_eq!(claimed, 500);
    let beneficiary_bal_after = token.balance(&beneficiary);
    assert_eq!(beneficiary_bal_after - beneficiary_bal_before, 500);

    // Second claim should fail with AlreadyClaimed
    let second_claim = client.try_claim(&grant_id, &beneficiary);
    assert_eq!(second_claim, Err(Ok(VestingError::AlreadyClaimed)));
}

#[test]
fn test_full_vesting_claim() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);

    client.init(&admin, &token_addr, &governance);

    let amount: i128 = 2000;
    let start_time: u64 = 1000;
    let cliff: u64 = 200;
    let duration: u64 = 1000;

    env.ledger().set_timestamp(start_time);

    let grant_id = client.grant_vesting(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &cliff,
        &duration,
    );

    sac.mint(&contract_id, &amount);

    // Advance past total duration
    env.ledger().set_timestamp(start_time + duration + 500);
    assert_eq!(client.get_vested_amount(&grant_id), amount);

    let claimed = client.claim(&grant_id, &beneficiary);
    assert_eq!(claimed, amount);
    assert_eq!(token.balance(&beneficiary), amount);
}

#[test]
fn test_revoke_vesting() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);

    client.init(&admin, &token_addr, &governance);

    let amount: i128 = 1000;
    let start_time: u64 = 1000;
    let cliff: u64 = 100;
    let duration: u64 = 10_000;

    env.ledger().set_timestamp(start_time);

    let grant_id = client.grant_vesting(
        &admin,
        &beneficiary,
        &amount,
        &start_time,
        &cliff,
        &duration,
    );

    // Revocation with timelock < 3600 fails
    let revoke_err = client.try_revoke(&grant_id, &admin, &1800);
    assert_eq!(revoke_err, Err(Ok(VestingError::InvalidTimelock)));

    // Revocation before delay passes fails
    let delay: u64 = 3600;
    let early_revoke = client.try_revoke(&grant_id, &admin, &delay);
    assert_eq!(early_revoke, Err(Ok(VestingError::NotEnoughTimeForRevoke)));

    // Advance time past start + delay
    env.ledger().set_timestamp(start_time + delay + 10);
    client.revoke(&grant_id, &admin, &delay);

    let schedule = client.get_vesting(&grant_id);
    assert!(schedule.revoked);
    assert_eq!(
        client.try_revoke(&grant_id, &admin, &delay),
        Err(Ok(VestingError::Revoked))
    );
    let vested_at_revoke = client.get_vested_amount(&grant_id);
    env.ledger().set_timestamp(start_time + delay + 1_000);
    assert_eq!(client.get_vested_amount(&grant_id), vested_at_revoke);

    // Claim on revoked grant fails
    let claim_res = client.try_claim(&grant_id, &beneficiary);
    assert_eq!(claim_res, Err(Ok(VestingError::Revoked)));
}

#[test]
fn test_cliff_and_vesting_boundaries() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);
    env.ledger().set_timestamp(1_000);
    let id = client.grant_vesting(&admin, &beneficiary, &1_000, &1_000, &100, &500);

    env.ledger().set_timestamp(1_099);
    assert_eq!(client.get_vested_amount(&id), 0);
    env.ledger().set_timestamp(1_100);
    assert_eq!(client.get_vested_amount(&id), 0);
    env.ledger().set_timestamp(1_200);
    assert_eq!(client.get_vested_amount(&id), 250);
    env.ledger().set_timestamp(1_500);
    assert_eq!(client.get_vested_amount(&id), 1_000);
}

#[test]
fn test_partial_vesting_claim_is_one_time() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    let token = TokenClient::new(&env, &token_addr);
    let sac = StellarAssetClient::new(&env, &token_addr);
    client.init(&admin, &token_addr, &governance);
    env.ledger().set_timestamp(1_000);
    let id = client.grant_vesting(&admin, &beneficiary, &1_000, &1_000, &0, &1_000);
    sac.mint(&contract_id, &1_000);

    env.ledger().set_timestamp(1_500);
    assert_eq!(client.claim(&id, &beneficiary), 500);
    assert_eq!(token.balance(&beneficiary), 500);
    assert_eq!(
        client.try_claim(&id, &beneficiary),
        Err(Ok(VestingError::AlreadyClaimed))
    );
    let schedule = client.get_vesting(&id);
    assert!(schedule.claimed);
    assert_eq!(
        client.try_revoke(&id, &admin, &3_600),
        Err(Ok(VestingError::AlreadyClaimed))
    );
}

#[test]
fn test_grant_rejects_invalid_and_overflowing_schedules() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);

    assert_eq!(
        client.try_grant_vesting(&admin, &beneficiary, &0, &10, &0, &10),
        Err(Ok(VestingError::InvalidSchedule))
    );
    assert_eq!(
        client.try_grant_vesting(&admin, &beneficiary, &-1, &10, &0, &10),
        Err(Ok(VestingError::InvalidSchedule))
    );
    assert_eq!(
        client.try_grant_vesting(&admin, &beneficiary, &10, &10, &11, &10),
        Err(Ok(VestingError::InvalidSchedule))
    );
    assert_eq!(
        client.try_grant_vesting(&admin, &beneficiary, &10, &u64::MAX, &0, &1),
        Err(Ok(VestingError::InvalidSchedule))
    );
    let other_admin = Address::generate(&env);
    assert_eq!(
        client.try_grant_vesting(&other_admin, &beneficiary, &10, &10, &0, &10),
        Err(Ok(VestingError::Unauthorized))
    );
}

#[test]
fn test_claim_and_revoke_reject_wrong_addresses() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);
    env.ledger().set_timestamp(1_000);
    let id = client.grant_vesting(&admin, &beneficiary, &1_000, &1_000, &0, &1_000);
    let other = Address::generate(&env);

    assert_eq!(
        client.try_claim(&id, &other),
        Err(Ok(VestingError::Unauthorized))
    );
    assert_eq!(
        client.try_revoke(&id, &other, &3_600),
        Err(Ok(VestingError::Unauthorized))
    );
}

#[test]
fn test_revoke_is_rejected_after_full_vesting() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);
    env.ledger().set_timestamp(1_000);
    let id = client.grant_vesting(&admin, &beneficiary, &1_000, &1_000, &0, &1_000);
    env.ledger().set_timestamp(2_000);

    assert_eq!(
        client.try_revoke(&id, &admin, &3_600),
        Err(Ok(VestingError::AlreadyVested))
    );
    assert!(!client.get_vesting(&id).revoked);
}

#[test]
fn test_missing_grant_queries_and_revoke_return_not_found() {
    let (env, contract_id, admin, token_addr, governance, _beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);

    assert!(matches!(
        client.try_get_vesting(&99),
        Err(Ok(VestingError::GrantNotFound))
    ));
    assert_eq!(
        client.try_get_vested_amount(&99),
        Err(Ok(VestingError::GrantNotFound))
    );
    assert_eq!(
        client.try_revoke(&99, &admin, &3_600),
        Err(Ok(VestingError::GrantNotFound))
    );
}

#[test]
fn test_claim_requires_contract_token_balance_and_preserves_schedule() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);
    env.ledger().set_timestamp(1_000);
    let id = client.grant_vesting(&admin, &beneficiary, &1_000, &1_000, &0, &1_000);
    env.ledger().set_timestamp(2_000);

    assert_eq!(
        client.try_claim(&id, &beneficiary),
        Err(Ok(VestingError::InsufficientBalance))
    );
    let schedule = client.get_vesting(&id);
    assert!(!schedule.claimed);
}

#[test]
fn test_zero_duration_grant_is_fully_vested_at_start() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);
    env.ledger().set_timestamp(1_000);
    let id = client.grant_vesting(&admin, &beneficiary, &100, &1_000, &0, &0);
    assert_eq!(client.get_vested_amount(&id), 100);
}

#[test]
fn test_vested_amount_reports_checked_multiplication_overflow() {
    let (env, contract_id, admin, token_addr, governance, beneficiary) = setup();
    let client = AcademyVestingContractClient::new(&env, &contract_id);
    client.init(&admin, &token_addr, &governance);
    let id = client.grant_vesting(&admin, &beneficiary, &i128::MAX, &0, &0, &u64::MAX);
    env.ledger().set_timestamp(u64::MAX - 1);

    assert_eq!(
        client.try_get_vested_amount(&id),
        Err(Ok(VestingError::InvalidSchedule))
    );
}
