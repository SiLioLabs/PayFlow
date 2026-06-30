# Testing Guide

This document explains how to run the FlowPay test suite, how the benchmark file works, and how to interpret snapshot outputs.

---

## Running the Tests

```bash
cd contract
cargo test
```

To see printed output while tests run:

```bash
cargo test -- --nocapture
```

To run a single test by name:

```bash
cargo test test_cancel
```

---

## Test Environment

FlowPay tests use the Soroban SDK test utilities:

- `Env::default()` creates an in-memory chain environment.
- `env.mock_all_auths()` bypasses auth checks for test convenience.
- `env.register_stellar_asset_contract_v2()` deploys a real test token.
- `env.ledger().with_mut()` advances time for interval and grace-period tests.

---

## Benchmarks

The benchmark suite lives in [contract/src/bench.rs](../contract/src/bench.rs). It measures instruction cost for the core contract paths:

- `bench_subscribe()`
- `bench_charge()`
- `bench_pay_per_use()`
- `bench_batch_charge_10_users()`
- `bench_charge_vs_subscribe_ratio()`

These are not functional tests. They measure CPU and memory cost so regressions can be caught when the contract grows.

### How to run benchmarks

Run the benchmark tests with nocapture so the printed results stay visible:

```bash
cd contract
cargo test bench -- --nocapture
```

That runs the benchmark functions and prints the measured CPU instructions and memory bytes for each one.

### How to read the benchmark output

Each benchmark prints a small summary like:

```text
[bench_charge]
  CPU Instructions : 3800000
  Memory Bytes     : 180000
```

Interpretation:

- `CPU Instructions` is the Soroban instruction count for the measured call.
- `Memory Bytes` is the measured memory cost for that call.
- The benchmark file compares the result against threshold constants such as `MAX_CHARGE_INSTRUCTIONS`.

If a benchmark crosses its threshold, treat it as a regression unless you intentionally changed the contract behavior.

### Snapshot files

Benchmark and test snapshots live under `contract/test_snapshots/`.

These files are JSON captures of expected output. They are used to make benchmark and test behavior easy to compare over time.

Common fields you will see:

- `cpu` or `cpu_instruction_cost`: instruction count for the call.
- `memory` or `memory_bytes_cost`: memory cost for the call.
- `events`: emitted events when the snapshot includes contract logs.
- `result` or `return`: the returned value from the call.

Units:

- Amounts are in stroops.
- Time is in seconds or ledger timestamps, depending on the benchmark or test.
- Benchmark cost numbers are instruction counts and memory bytes, not token amounts.

### Adding a new benchmark

1. Add a new `#[test]` function in [contract/src/bench.rs](../contract/src/bench.rs).
2. Use the shared `bench_setup()` helper so the new benchmark matches the others.
3. Reset the budget immediately before the call you want to measure.
4. Print CPU and memory numbers with a stable label.
5. Add a threshold constant near the top of the file.
6. If the benchmark should have a snapshot, add or update the matching file in `contract/test_snapshots/`.

### When a snapshot changes

If a snapshot changes, decide whether the difference is deliberate or a regression:

- Deliberate change: update the snapshot and note the reason in the commit or PR.
- Regression: fix the code path and rerun the benchmark until the snapshot matches expectations again.

Do not blindly accept snapshot churn. Cost increases should be justified, especially in the contract hot path.

---

## Current Test Coverage

The test suite covers:

- Core subscription flows
- Multi-token behavior
- Batch charging
- Subscription counts and merchant stats
- Spending limits
- Referral tracking
- Migration
- Metadata
- Charge history
- TTL extension

---

## Writing New Tests

Add new tests to `contract/src/test.rs`. Prefer the shared `setup()` helper to avoid boilerplate.

### Template

```rust
#[test]
fn test_your_feature() {
    let (env, contract_id, _token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &_token_addr, &None, &None);
}
```

### Testing panics

Use `#[should_panic(expected = "...")]` when you need to assert a failure path.

### Advancing time

```rust
env.ledger().with_mut(|l| {
    l.timestamp += 86_401;
});
```

---

## Frontend Tests

Frontend tests run with Vitest:

```bash
cd frontend
npm run test
```

### Admin subscription repair panel

| Test file | Coverage |
| --- | --- |
| `subscriptionValidation.test.ts` | Violation formatting and failure detection |
| `useAdmin.test.tsx` | Admin wallet authorization |
| `SubscriptionRepairPanel.test.tsx` | Validation/repair UI states, event count display, unauthorized repair |
| `AdminDashboard.test.tsx` | Dashboard integration and read-only guidance |
