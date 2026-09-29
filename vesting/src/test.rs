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

    (
        env,
        contract_id,
        admin,
        token_addr,
        governance,
        beneficiary,
    )
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

    // Claim on revoked grant fails
    let claim_res = client.try_claim(&grant_id, &beneficiary);
    assert_eq!(claim_res, Err(Ok(VestingError::Revoked)));
}
