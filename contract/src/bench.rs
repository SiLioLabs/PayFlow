#![cfg(test)]

use super::*;
use crate::batch::MAX_BATCH_SIZE;
use crate::limits;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

extern crate std;
use std::println;

fn setup_with_n_users(
    env: &Env,
    n: u32,
    merchant: &Address,
    interval: u64,
    amount: i128,
) -> (Address, Address, Vec<Address>) {
    env.mock_all_auths();

    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);

    let sac = StellarAssetClient::new(env, &token_addr);
    let token = TokenClient::new(env, &token_addr);

    let mut users = Vec::new(env);
    for _ in 0..n {
        let u = Address::generate(env);
        sac.mint(&u, &1_000_000_0000000);
        token.approve(&u, &contract_id, &1_000_000_0000000, &999999);
        users.push_back(u);
    }

    let client = FlowPayClient::new(env, &contract_id);
    for u in users.iter() {
        client.subscribe(
            &u,
            merchant,
            &amount,
            &interval,
            &token_addr,
            &None,
            &None,
        );
    }

    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    (contract_id, token_addr, users)
}

pub struct BatchBenchmark;

impl BatchBenchmark {
    pub fn bench_batch_charge(env: &Env, n_users: u32) -> (u64, u64) {
        let merchant = Address::generate(env);
        let interval: u64 = 86400;
        let amount: i128 = 1_0000000;
        let (contract_id, _token_addr, users) = setup_with_n_users(env, n_users, &merchant, interval, amount);
        let client = FlowPayClient::new(env, &contract_id);

        env.budget().reset_default();
        let _results = client.batch_charge(&users);

        let cpu_insns = env.budget().cpu_instruction_cost();
        let mem_bytes = env.budget().memory_bytes_cost();
        (cpu_insns, mem_bytes)
    }

    pub fn bench_single_charge(env: &Env) -> (u64, u64) {
        let merchant = Address::generate(env);
        let interval: u64 = 86400;
        let amount: i128 = 1_0000000;
        let (contract_id, _token_addr, users) = setup_with_n_users(env, 1, &merchant, interval, amount);
        let client = FlowPayClient::new(env, &contract_id);
        let user = users.get(0).unwrap();

        env.budget().reset_default();
        let _ = client.charge(&user);

        let cpu_insns = env.budget().cpu_instruction_cost();
        let mem_bytes = env.budget().memory_bytes_cost();
        (cpu_insns, mem_bytes)
    }
}

#[test]
fn test_bench_single_charge() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let (cpu, mem) = BatchBenchmark::bench_single_charge(&env);

    println!("Single charge:");
    println!("  CPU instructions: {}", cpu);
    println!("  Memory bytes:    {}", mem);

    assert!(cpu > 0, "CPU must be measured");
    assert!(mem > 0, "MEM must be measured");
}

#[test]
fn test_bench_batch_charge_small() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let n = 10u32;
    let (cpu, mem) = BatchBenchmark::bench_batch_charge(&env, n);

    println!("batch_charge(n={}):", n);
    println!("  CPU instructions: {}", cpu);
    println!("  Memory bytes:    {}", mem);
    println!("  Per-user CPU:     {}", cpu / n as u64);

    assert!(cpu > 0);
    assert!(mem > 0);
}

#[test]
fn test_bench_batch_charge_max() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let n = MAX_BATCH_SIZE;
    let (cpu, mem) = BatchBenchmark::bench_batch_charge(&env, n);

    println!("\nbatch_charge MAX (n={}):", n);
    println!("  CPU instructions: {}", cpu);
    println!("  Memory bytes:    {}", mem);
    println!("  Per-user CPU:     {}", cpu / n as u64);
    println!(
        "  CPU vs soft-limit: {:.2}%",
        cpu as f64 / limits::SOROBAN_CPU_INSN_SOFT_LIMIT as f64 * 100.0
    );

    assert!(cpu > 0);
    assert!(mem > 0);

    assert!(
        cpu < limits::SOROBAN_CPU_INSN_SOFT_LIMIT,
        "max batch CPU ({}) must be under soft limit ({})",
        cpu,
        limits::SOROBAN_CPU_INSN_SOFT_LIMIT
    );
    assert!(
        mem < limits::SOROBAN_MEM_BYTES_SOFT_LIMIT,
        "max batch MEM ({}) must be under soft limit ({})",
        mem,
        limits::SOROBAN_MEM_BYTES_SOFT_LIMIT
    );
}

#[test]
fn test_bench_batch_charge_linearity() {
    let env = Env::default();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let small = 10u32;
    let large = 50u32;
    let (cpu_small, _) = BatchBenchmark::bench_batch_charge(&env, small);

    let env2 = Env::default();
    env2.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let (cpu_large, _) = BatchBenchmark::bench_batch_charge(&env2, large);

    let ratio_small = cpu_small as f64 / small as f64;
    let ratio_large = cpu_large as f64 / large as f64;

    println!("Per-user CPU (n=10): {:.0}", ratio_small);
    println!("Per-user CPU (n=50): {:.0}", ratio_large);

    let ratio_of_ratios = ratio_large / ratio_small;
    println!("Ratio of per-user costs: {:.2} (should be ~1.0 for linear)", ratio_of_ratios);

    assert!(
        ratio_of_ratios < 2.0,
        "CPU scaling should be roughly linear; ratio={}",
        ratio_of_ratios
    );
}
