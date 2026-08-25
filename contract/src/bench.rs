#![cfg(test)]
// # FlowPay Benchmark Tests
/// # FlowPay Benchmark Tests
///
/// These tests measure instruction-count costs for the four core contract
/// entry-points so that regressions can be detected as features are added.
///
/// ## How to run
///
/// ```
/// cargo test bench -- --nocapture
/// ```
///
/// ## Baseline instruction counts (Soroban SDK 21, recorded 2026-06-01)
///
/// | Function                        | CPU Instructions | Memory Bytes |
/// |---------------------------------|-----------------|--------------|
/// | subscribe()                     |   ~4_200_000    |  ~200_000    |
/// | charge()                        |   ~3_800_000    |  ~180_000    |
/// | pay_per_use()                   |   ~3_600_000    |  ~170_000    |
/// | batch_charge() – 10 users       |  ~28_000_000    | ~1_200_000   |
///
/// These numbers are printed at runtime (see `--nocapture`).  Update the
/// table above whenever a deliberate change shifts the baseline by more
/// than ~5 %.
///
/// Budget baselines were recorded with Soroban SDK 21.0.0 on 2026-06-01.
/// Each threshold includes ~10% headroom to catch regressions without
/// failing on minor environment variation.
pub const MAX_SUBSCRIBE_INSTRUCTIONS: u64 = 4_620_000;
pub const MAX_CHARGE_INSTRUCTIONS: u64 = 4_180_000;
pub const MAX_PAY_PER_USE_INSTRUCTIONS: u64 = 3_960_000;
pub const MAX_BATCH_10_INSTRUCTIONS: u64 = 30_800_000;

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
// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Spin up a fresh environment with one funded user and one merchant.
///
/// Returns `(env, contract_id, token_addr, user, merchant)`.
fn bench_setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();

    let contract_id = env.register_contract(None, FlowPay);

    let user = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Mint a generous balance so token transfers never fail during benchmarks.
    let sac = StellarAssetClient::new(&env, &token_addr);
    sac.mint(&user, &1_000_000_0000000);

    // Approve the contract to spend on behalf of the user.
    let token = TokenClient::new(&env, &token_addr);
    token.approve(&user, &contract_id, &1_000_000_0000000, &200);

    (env, contract_id, token_addr, user, merchant)
}

/// Create a funded user and approve the contract to spend their tokens.
fn add_funded_user(env: &Env, contract_id: &Address, token_addr: &Address) -> Address {
    let user = Address::generate(env);
    let sac = StellarAssetClient::new(env, token_addr);
    sac.mint(&user, &1_000_000_0000000);
    let token = TokenClient::new(env, token_addr);
    token.approve(&user, contract_id, &1_000_000_0000000, &200);
    user
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: subscribe()
// ─────────────────────────────────────────────────────────────────────────────

/// Measures the instruction cost of a single `subscribe()` call.
///
/// Baseline (2026-06-01):
///   CPU Instructions : ~4_200_000
///   Memory Bytes     : ~200_000
#[test]
fn bench_subscribe() {
    let (env, contract_id, token_addr, user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60; // 30 days

    // Reset budget immediately before the call under measurement.
    env.budget().reset_unlimited();

    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    env.budget().reset_default();

    println!("\n[bench_subscribe]");
    println!("  CPU Instructions : {}", cpu);
    println!("  Memory Bytes     : {}", mem);

    assert!(cpu > 0, "subscribe() must consume CPU instructions");
    assert!(mem > 0, "subscribe() must consume memory");
    assert!(
        cpu <= MAX_SUBSCRIBE_INSTRUCTIONS,
        "subscribe() CPU ({}) exceeds budget threshold ({})",
        cpu,
        MAX_SUBSCRIBE_INSTRUCTIONS
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: charge()
// ─────────────────────────────────────────────────────────────────────────────

/// Measures the instruction cost of a single `charge()` call after the
/// billing interval has elapsed.
///
/// Baseline (2026-06-01):
///   CPU Instructions : ~3_800_000
///   Memory Bytes     : ~180_000
#[test]
fn bench_charge() {
    let (env, contract_id, token_addr, user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 30 * 24 * 60 * 60;

    // Subscribe first (not measured).
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Advance ledger past the billing interval.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // Reset budget immediately before the call under measurement.
    env.budget().reset_unlimited();

    client.charge(&user);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    env.budget().reset_default();

    println!("\n[bench_charge]");
    println!("  CPU Instructions : {}", cpu);
    println!("  Memory Bytes     : {}", mem);

    assert!(cpu > 0, "charge() must consume CPU instructions");
    assert!(mem > 0, "charge() must consume memory");
    assert!(
        cpu <= MAX_CHARGE_INSTRUCTIONS,
        "charge() CPU ({}) exceeds budget threshold ({})",
        cpu,
        MAX_CHARGE_INSTRUCTIONS
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: pay_per_use()
// ─────────────────────────────────────────────────────────────────────────────

/// Measures the instruction cost of a single `pay_per_use()` call.
///
/// Baseline (2026-06-01):
///   CPU Instructions : ~3_600_000
///   Memory Bytes     : ~170_000
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
fn bench_pay_per_use() {
    let (env, contract_id, token_addr, user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // A subscription must exist before pay_per_use can be called.
    client.subscribe(
        &user,
        &merchant,
        &1_0000000,
        &86400,
        &token_addr,
        &None,
        &None,
    );

    // Reset budget immediately before the call under measurement.
    env.budget().reset_unlimited();

    client.pay_per_use(&user, &5_0000000);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    env.budget().reset_default();

    println!("\n[bench_pay_per_use]");
    println!("  CPU Instructions : {}", cpu);
    println!("  Memory Bytes     : {}", mem);

    assert!(cpu > 0, "pay_per_use() must consume CPU instructions");
    assert!(mem > 0, "pay_per_use() must consume memory");
    assert!(
        cpu <= MAX_PAY_PER_USE_INSTRUCTIONS,
        "pay_per_use() CPU ({}) exceeds budget threshold ({})",
        cpu,
        MAX_PAY_PER_USE_INSTRUCTIONS
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark: batch_charge() – 10 users
// ─────────────────────────────────────────────────────────────────────────────

/// Measures the instruction cost of `batch_charge()` across 10 subscribers
/// whose billing intervals have all elapsed (all 10 result in `Charged`).
///
/// Baseline (2026-06-01):
///   CPU Instructions : ~28_000_000
///   Memory Bytes     : ~1_200_000
#[test]
fn bench_batch_charge_10_users() {
    let (env, contract_id, token_addr, first_user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 1_0000000;
    let interval: u64 = 86400; // 1 day

    // Subscribe the first user (already set up by bench_setup).
    client.subscribe(
        &first_user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );

    // Create and subscribe 9 more users.
    let mut users: Vec<Address> = Vec::new(&env);
    users.push_back(first_user.clone());

    for _ in 1..10 {
        let u = add_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(&u, &merchant, &amount, &interval, &token_addr, &None, &None);
        users.push_back(u);
    }

    // Advance ledger so every subscription is due.
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    // Reset budget immediately before the call under measurement.
    env.budget().reset_unlimited();

    let results = client.batch_charge(&users);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    env.budget().reset_default();

    println!("\n[bench_batch_charge_10_users]");
    println!("  CPU Instructions : {}", cpu);
    println!("  Memory Bytes     : {}", mem);

    // Verify all 10 users were actually charged (not skipped/errored).
    assert_eq!(
        results.len(),
        10,
        "batch_charge must return one result per user"
    );
    for i in 0..10u32 {
        assert_eq!(
            results.get(i).unwrap(),
            ChargeResult::Charged,
            "user {} should be Charged",
            i
        );
    }

    assert!(cpu > 0, "batch_charge() must consume CPU instructions");
    assert!(mem > 0, "batch_charge() must consume memory");
    assert!(
        cpu <= MAX_BATCH_10_INSTRUCTIONS,
        "batch_charge() CPU ({}) exceeds budget threshold ({})",
        cpu,
        MAX_BATCH_10_INSTRUCTIONS
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Regression guard: charge() must not cost more than 3× subscribe()
// ─────────────────────────────────────────────────────────────────────────────

/// Ensures that `charge()` does not regress to an unexpectedly high cost
/// relative to `subscribe()`.  Both are measured in the same environment so
/// the comparison is apples-to-apples.
///
/// The 3× ceiling is intentionally generous — tighten it if the baseline
/// stabilises.
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
fn bench_charge_vs_subscribe_ratio() {
    let (env, contract_id, token_addr, user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    let amount: i128 = 5_0000000;
    let interval: u64 = 86400;

    // ── Measure subscribe ────────────────────────────────────────────────────
    env.budget().reset_default();
    client.subscribe(
        &user,
        &merchant,
        &amount,
        &interval,
        &token_addr,
        &None,
        &None,
    );
    let subscribe_cpu = env.budget().cpu_instruction_cost();

    // ── Measure charge ───────────────────────────────────────────────────────
    env.ledger().with_mut(|l| {
        l.timestamp += interval + 1;
    });

    env.budget().reset_default();
    client.charge(&user);
    let charge_cpu = env.budget().cpu_instruction_cost();

    println!("\n[bench_charge_vs_subscribe_ratio]");
    println!("  subscribe() CPU  : {}", subscribe_cpu);
    println!("  charge()    CPU  : {}", charge_cpu);
    println!(
        "  ratio (charge/subscribe) : {:.2}",
        charge_cpu as f64 / subscribe_cpu as f64
    );

    // charge() should not cost more than 3× subscribe().
    assert!(
        charge_cpu <= subscribe_cpu * 3,
        "charge() CPU ({}) is more than 3× subscribe() CPU ({})",
        charge_cpu,
        subscribe_cpu
    );
}
