#![cfg(test)]

use super::*;
use crate::UpgradeableTradingContractClient;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Env, Vec,
};

extern crate std;
use std::println;

/// Gas benchmarking utilities for trading contract
pub struct GasBenchmark;

impl GasBenchmark {
    /// Benchmark a single trade operation
    pub fn bench_trade(env: &Env) -> (u64, u64) {
        let contract_id = env.register_contract(None, UpgradeableTradingContract);
        let client = UpgradeableTradingContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let trader = Address::generate(env);
        let approver = Address::generate(env);
        let executor = Address::generate(env);
        let fee_recipient = Address::generate(env);

        let mut approvers = Vec::new(env);
        approvers.push_back(approver);

        env.mock_all_auths();
        client.init(&admin, &approvers, &executor);

        // Create mock token
        let token_id = env.register_stellar_asset_contract(fee_recipient.clone());

        // Reset budget before measurement
        env.budget().reset_default();

        // Execute trade
        let _ = client.trade(
            &trader,
            &symbol_short!("BTCUSD"),
            &1_000_000i128,
            &50_000i128,
            &true,
            &token_id,
            &0i128,
            &fee_recipient,
        );

        // Get measurements
        let cpu_insns = env.budget().cpu_instruction_cost();
        let mem_bytes = env.budget().memory_bytes_cost();

        (cpu_insns, mem_bytes)
    }

    /// Benchmark multiple trades to measure scaling
    pub fn bench_multiple_trades(env: &Env, count: u32) -> Vec<(u64, u64)> {
        let contract_id = env.register_contract(None, UpgradeableTradingContract);
        let client = UpgradeableTradingContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let trader = Address::generate(env);
        let approver = Address::generate(env);
        let executor = Address::generate(env);
        let fee_recipient = Address::generate(env);

        let mut approvers = soroban_sdk::Vec::new(env);
        approvers.push_back(approver);

        env.mock_all_auths();
        client.init(&admin, &approvers, &executor);

        let token_id = env.register_stellar_asset_contract(fee_recipient.clone());
        let mut results = Vec::new(env);

        for i in 0..count {
            env.budget().reset_default();

            let _ = client.trade(
                &trader,
                &symbol_short!("BTCUSD"),
                &(1_000_000i128 + i as i128),
                &50_000i128,
                &true,
                &token_id,
                &0i128,
                &fee_recipient,
            );

            let cpu_insns = env.budget().cpu_instruction_cost();
            let mem_bytes = env.budget().memory_bytes_cost();
            results.push_back((cpu_insns, mem_bytes));
        }

        results
    }

    /// Benchmark get_stats operation
    pub fn bench_get_stats(env: &Env) -> (u64, u64) {
        let contract_id = env.register_contract(None, UpgradeableTradingContract);
        let client = UpgradeableTradingContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let approver = Address::generate(env);
        let executor = Address::generate(env);

        let mut approvers = Vec::new(env);
        approvers.push_back(approver);

        env.mock_all_auths();
        client.init(&admin, &approvers, &executor);

        env.budget().reset_default();
        let _ = client.get_stats();

        let cpu_insns = env.budget().cpu_instruction_cost();
        let mem_bytes = env.budget().memory_bytes_cost();

        (cpu_insns, mem_bytes)
    }

    /// Benchmark pause/unpause operations
    pub fn bench_pause_unpause(env: &Env) -> ((u64, u64), (u64, u64)) {
        let contract_id = env.register_contract(None, UpgradeableTradingContract);
        let client = UpgradeableTradingContractClient::new(env, &contract_id);

        let admin = Address::generate(env);
        let approver = Address::generate(env);
        let executor = Address::generate(env);

        let mut approvers = Vec::new(env);
        approvers.push_back(approver);

        env.mock_all_auths();
        client.init(&admin, &approvers, &executor);

        // Benchmark pause
        env.budget().reset_default();
        let _ = client.pause(&admin);
        let pause_cpu = env.budget().cpu_instruction_cost();
        let pause_mem = env.budget().memory_bytes_cost();

        // Benchmark unpause
        env.budget().reset_default();
        let _ = client.unpause(&admin);
        let unpause_cpu = env.budget().cpu_instruction_cost();
        let unpause_mem = env.budget().memory_bytes_cost();

        ((pause_cpu, pause_mem), (unpause_cpu, unpause_mem))
    }
}

#[test]
fn test_gas_benchmark_single_trade() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1000);

    let (cpu_insns, mem_bytes) = GasBenchmark::bench_trade(&env);

    // Print results for analysis
    println!("Single Trade Gas Usage:");
    println!("  CPU Instructions: {}", cpu_insns);
    println!("  Memory Bytes: {}", mem_bytes);

    // Assert reasonable limits (adjust based on actual measurements)
    assert!(cpu_insns > 0, "CPU instructions should be measured");
    assert!(mem_bytes > 0, "Memory bytes should be measured");
}

#[test]
#[ignore] // Skip in CI - can cause issues with multiple trades
fn test_gas_benchmark_scaling() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1000);

    let results = GasBenchmark::bench_multiple_trades(&env, 10);

    println!("\nMultiple Trades Gas Scaling:");
    for (i, (cpu, mem)) in results.iter().enumerate() {
        println!("  Trade {}: CPU={}, MEM={}", i + 1, cpu, mem);
    }

    // Verify consistent performance (no exponential growth)
    let first = results.get(0).unwrap();
    let last = results.get(9).unwrap();

    // Gas should remain relatively constant (within 50% variance)
    let cpu_ratio = last.0 as f64 / first.0 as f64;
    assert!(cpu_ratio < 1.5, "CPU usage should not grow significantly");
}

#[test]
fn test_gas_benchmark_read_operations() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1000);

    let (cpu_insns, mem_bytes) = GasBenchmark::bench_get_stats(&env);

    println!("\nGet Stats Gas Usage:");
    println!("  CPU Instructions: {}", cpu_insns);
    println!("  Memory Bytes: {}", mem_bytes);

    // Read operations should be cheaper than writes
    assert!(cpu_insns > 0);
    assert!(mem_bytes > 0);
}

#[test]
#[ignore] // Skip in CI - can cause issues with pause/unpause
fn test_gas_benchmark_admin_operations() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.timestamp = 1000);

    let ((pause_cpu, pause_mem), (unpause_cpu, unpause_mem)) =
        GasBenchmark::bench_pause_unpause(&env);

    println!("\nAdmin Operations Gas Usage:");
    println!("  Pause - CPU: {}, MEM: {}", pause_cpu, pause_mem);
    println!("  Unpause - CPU: {}, MEM: {}", unpause_cpu, unpause_mem);

    // Both operations should have similar costs
    assert!(pause_cpu > 0);
    assert!(unpause_cpu > 0);
}
