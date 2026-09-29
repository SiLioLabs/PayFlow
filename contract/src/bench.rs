#![cfg(test)]
// # FlowPay Benchmark Tests
/// # FlowPay Benchmark Tests
///
/// These tests measure instruction-count costs for the four core contract
/// entry-points so that regressions can be detected as features are added.
///
/// ## How to run
///
/// The module is gated behind the `bench` cargo feature, so it must be
/// enabled explicitly — without `--features bench` the filter below matches
/// zero tests and the run exits successfully without measuring anything.
///
/// ```
/// cargo test --features bench bench -- --nocapture
/// ```
///
/// ## Baseline instruction counts (Soroban SDK 21.7.7 / env-host 21.2.1, recorded 2026-09-28)
///
/// | Function                        | CPU Instructions | Memory Bytes | Pinned budget |
/// |---------------------------------|-----------------|--------------|---------------|
/// | subscribe()                     |     429_145     |    77_234    |    495_000    |
/// | charge()                        |     668_949     |   110_970    |    770_000    |
/// | pay_per_use()                   |     715_958     |   125_058    |    825_000    |
/// | batch_charge() – 10 users       |   8_860_549     | 1_894_229    | 10_200_000    |
/// | get_top_merchants_by_subs() – 15 merchants | 724_790 | 68_839   |    835_000    |
///
/// These numbers are printed at runtime (see `--nocapture`).  Update the
/// table above whenever a deliberate change shifts the baseline by more
/// than ~5 %.
///
/// ## Re-pinning history
///
/// The thresholds below were originally recorded on 2026-06-01 against an
/// earlier build and sat ~10x above the true cost of every entrypoint
/// (subscribe: 4_620_000 pinned vs. 429_145 measured). A budget that loose
/// cannot fail, so the gate would have passed while a regression shipped.
/// They were re-pinned on 2026-09-28 to the measured cost plus ~15 %
/// headroom: enough to absorb host/SDK noise, tight enough that a scan-based
/// rewrite of a single entrypoint trips the build. `get_top_merchants_by_subs`
/// was previously unbudgeted entirely — it is the entrypoint whose
/// scan-over-subscribers shape is the most likely source of a budget blowup,
/// so it is now pinned too.
pub const MAX_SUBSCRIBE_INSTRUCTIONS: u64 = 495_000;
pub const MAX_CHARGE_INSTRUCTIONS: u64 = 770_000;
pub const MAX_PAY_PER_USE_INSTRUCTIONS: u64 = 825_000;
pub const MAX_BATCH_10_INSTRUCTIONS: u64 = 10_200_000;
pub const MAX_TOP_MERCHANTS_LARGE_INDEX_INSTRUCTIONS: u64 = 835_000;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

extern crate std;
use std::println;

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

    // Whitelisting is enabled by default, so an unregistered merchant would make
    // every state-changing benchmark fail with `MerchantNotWhitelisted` (code 10)
    // before it ever reached its budget assertion. Disable it for the whole bench
    // env so each benchmark measures its entrypoint rather than the whitelist.
    env.as_contract(&contract_id, || {
        crate::whitelist::set_whitelist_enabled(&env, false);
    });

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
/// Baseline (Soroban SDK 21.7.7, 2026-09-28):
///   CPU Instructions : 429_145
///   Memory Bytes     : 77_234
///   Pinned budget    : 495_000 (+15 % headroom)
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
/// Baseline (Soroban SDK 21.7.7, 2026-09-28):
///   CPU Instructions : 668_949
///   Memory Bytes     : 110_970
///   Pinned budget    : 770_000 (+15 % headroom)
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
/// Baseline (Soroban SDK 21.7.7, 2026-09-28):
///   CPU Instructions : 715_958
///   Memory Bytes     : 125_058
///   Pinned budget    : 825_000 (+15 % headroom)
#[test]
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
/// Baseline (Soroban SDK 21.7.7, 2026-09-28):
///   CPU Instructions : 8_860_549
///   Memory Bytes     : 1_894_229
///   Pinned budget    : 10_200_000 (+15 % headroom)
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

#[test]
fn bench_get_top_merchants_by_subs_large_index() {
    let (env, contract_id, token_addr, _, _) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);
    env.as_contract(&contract_id, || {
        crate::whitelist::set_whitelist_enabled(&env, false);
    });

    // Seed 15 merchants with varying subscriber counts
    for i in 0..15 {
        let merchant = Address::generate(&env);
        let user = add_funded_user(&env, &contract_id, &token_addr);
        client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
        if i % 2 == 0 {
            let u2 = add_funded_user(&env, &contract_id, &token_addr);
            client.subscribe(&u2, &merchant, &1_0000000, &86400, &token_addr, &None, &None);
        }
    }

    env.budget().reset_unlimited();

    let top = client.get_top_merchants_by_subs(&10);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    env.budget().reset_default();

    println!("\n[bench_get_top_merchants_by_subs_large_index]");
    println!("  CPU Instructions : {}", cpu);
    println!("  Memory Bytes     : {}", mem);

    assert_eq!(top.len(), 10);
    assert!(cpu > 0, "get_top_merchants_by_subs must consume CPU instructions");
    assert!(mem > 0, "get_top_merchants_by_subs must consume memory");
    assert!(
        cpu <= MAX_TOP_MERCHANTS_LARGE_INDEX_INSTRUCTIONS,
        "get_top_merchants_by_subs() CPU ({}) exceeds budget threshold ({})",
        cpu,
        MAX_TOP_MERCHANTS_LARGE_INDEX_INSTRUCTIONS
    );
}
