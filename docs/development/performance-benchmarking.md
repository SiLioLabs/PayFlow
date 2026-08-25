# Performance Benchmarking Guide

The FlowPay contract ships a benchmark suite in [`contract/src/bench.rs`](../../contract/src/bench.rs) that measures the Soroban CPU-instruction and memory cost of the four core entry points: `subscribe()`, `charge()`, `pay_per_use()`, and `batch_charge()`. This guide explains how to run those benchmarks, how to read the numbers they print, what each existing benchmark actually measures, how to catch a performance regression, and how to add a new benchmark.

For day-to-day unit testing (not performance), see [`docs/TESTING.md`](../TESTING.md). For the Rust/Soroban contribution workflow in general, see [`docs/CONTRIBUTING-CONTRACT.md`](../CONTRIBUTING-CONTRACT.md#benchmarks).

---

## Table of Contents

- [How to Run the Benchmarks](#how-to-run-the-benchmarks)
- [Interpreting Results](#interpreting-results)
- [Existing Benchmarks](#existing-benchmarks)
- [Regression Detection](#regression-detection)
- [Adding a New Benchmark](#adding-a-new-benchmark)
- [CI Integration](#ci-integration)

---

## How to Run the Benchmarks

The benchmarks are ordinary `#[test]` functions gated by `#![cfg(test)]` at the top of `bench.rs`, so they run through `cargo test` — there's no separate benchmark harness to install.

```bash
cd contract
cargo test --features testutils bench -- --nocapture
```

- `--features testutils` enables the Soroban SDK's test utilities (`Env::default()`, `mock_all_auths()`, `budget()`, etc.). It's technically already pulled in as a `dev-dependency` for `cargo test` in this crate, but pass it explicitly so the command is correct if that ever changes.
- `bench` filters to test functions whose name contains `bench` (all five live in the `bench` module: `bench_subscribe`, `bench_charge`, `bench_pay_per_use`, `bench_batch_charge_10_users`, `bench_charge_vs_subscribe_ratio`).
- `-- --nocapture` tells the Rust test harness to print `println!` output even for passing tests — without it, Cargo swallows stdout for green tests and you won't see the instruction counts.

### Expected output format

Running the command above produces one block per benchmark plus the standard `cargo test` summary:

```text
running 5 tests

[bench_charge]
  CPU Instructions : 508118
  Memory Bytes     : 79338

[bench_charge_vs_subscribe_ratio]
  subscribe() CPU  : 261022
  charge()    CPU  : 508118
  ratio (charge/subscribe) : 1.95

[bench_pay_per_use]
  CPU Instructions : 530622
  Memory Bytes     : 86189
test bench::bench_charge ... ok
test bench::bench_pay_per_use ... ok

[bench_subscribe]
  CPU Instructions : 261022
  Memory Bytes     : 45019
test bench::bench_charge_vs_subscribe_ratio ... ok
test bench::bench_subscribe ... ok

[bench_batch_charge_10_users]
  CPU Instructions : 6706059
  Memory Bytes     : 1304444
test bench::bench_batch_charge_10_users ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 218 filtered out; finished in 0.53s
```

This is real output from a local run (Rust 1.95.0, `soroban-sdk` 21.7.7). Test execution is multi-threaded by default, so the blocks may interleave in a different order on your machine — that's harmless; each block is self-contained and labeled with the benchmark's function name.

Each benchmark also writes a JSON snapshot to `contract/test_snapshots/bench/<name>.1.json` (a full ledger-state dump used for deeper diffing — see [Snapshot files](../TESTING.md#snapshot-files) in the testing guide). These are committed to the repo; a snapshot diff is a signal worth looking at, but the printed CPU/memory numbers above are the primary signal for performance work.

To run a single benchmark:

```bash
cargo test --features testutils bench_charge -- --nocapture
```

---

## Interpreting Results

Each benchmark prints two numbers:

- **CPU Instructions** — the number of CPU instructions the Soroban host metered for the measured call, read via `env.budget().cpu_instruction_cost()`. This is the same unit Soroban uses to enforce the network's per-transaction resource limits (currently on the order of 100M instructions per transaction on Stellar mainnet/testnet) and the same unit `soroban contract invoke` reports as `cpu instructions` after a real invocation. Lower is better — it means the function does less computational work and leaves more of the transaction's resource budget for whatever else shares the transaction (e.g., other operations in `batch_charge`).
- **Memory Bytes** — the peak memory the host allocated for the call, read via `env.budget().memory_bytes_cost()`. This tracks heap allocations inside the WASM guest (Soroban SDK collections, temporary buffers, etc.), not the size of ledger entries written. Soroban also enforces a per-transaction memory ceiling, so this number matters for the same "shared budget" reason as CPU instructions.

### What "good" looks like

There's no universal "good" number — it depends entirely on what the function does. What you're actually watching for is:

1. **Comparative stability.** The same function, called the same way, should produce (approximately) the same instruction count on every run — Soroban's budget metering is deterministic given deterministic inputs, so unlike wall-clock benchmarks, there's no run-to-run noise to average out. If a number changes between two runs of the _same_ code, something is non-deterministic (e.g., iterating a `Map` whose insertion order affects iteration) and worth investigating on its own.
2. **Proportionality to work done.** `batch_charge()` over 10 users measured at 6,706,059 instructions is roughly 13× `charge()`'s 508,118 — i.e., a bit more than linear in user count, since batch overhead (loading the subscriber list, one shared transaction context) is amortized but per-user work (storage read/write, token transfer, event emission) dominates. If a future change made `batch_charge` scale _worse_ than linear with subscriber count, that would be a red flag independent of any fixed baseline.
3. **Headroom under the enforced threshold.** `bench.rs` asserts each measured call stays under a `MAX_*_INSTRUCTIONS` constant (see below). As long as you're comfortably under threshold with margin, you're "good"; crossing it fails the test outright.

### Actual measured baselines vs. the threshold constants

Running the suite locally produced instruction counts substantially **lower** than the `MAX_*_INSTRUCTIONS` threshold constants defined at the top of `bench.rs` (those constants were set with ~10% headroom over baselines recorded against an earlier SDK snapshot per the file's own doc comment). Concretely:

| Function                    | Measured CPU | Threshold constant (`bench.rs`)            | Headroom |
| --------------------------- | ------------ | ------------------------------------------ | -------- |
| `subscribe()`               | 261,022      | `MAX_SUBSCRIBE_INSTRUCTIONS` = 4,620,000   | ~17.7×   |
| `charge()`                  | 508,118      | `MAX_CHARGE_INSTRUCTIONS` = 4,180,000      | ~8.2×    |
| `pay_per_use()`             | 530,622      | `MAX_PAY_PER_USE_INSTRUCTIONS` = 3,960,000 | ~7.5×    |
| `batch_charge()` (10 users) | 6,706,059    | `MAX_BATCH_10_INSTRUCTIONS` = 30,800,000   | ~4.6×    |

This gap is expected and not a bug: the threshold constants exist to catch _regressions_, not to track the current number tightly. They were set generously so ordinary feature work doesn't spuriously fail CI. If you're doing dedicated optimization work, use the **actual measured numbers** in the table above as your working baseline, not the threshold constants — the thresholds only tell you the outer bound before the benchmark test fails.

> Numbers on your machine may differ slightly by Soroban SDK / `soroban-env-host` patch version. Always treat "the number this exact benchmark printed on `master` before your change" as the ground truth for regression comparisons (see [Regression Detection](#regression-detection)), not the numbers hardcoded in this document.

---

## Existing Benchmarks

### `bench_subscribe`

Measures a single `subscribe()` call for a brand-new user against a freshly funded token balance and approval. This is close to the cheapest possible `subscribe()` call — no existing subscription, no referral, no trial. Measured: **261,022 CPU instructions / 45,019 memory bytes**.

### `bench_charge`

Subscribes a user, advances the ledger timestamp past the billing interval, then measures a single `charge()` call. This is the recurring-billing hot path a keeper calls once per subscriber per cycle (see [`docs/KEEPER.md`](../KEEPER.md)). Measured: **508,118 CPU instructions / 79,338 memory bytes** — about 1.95× the cost of `subscribe()`, since `charge()` does everything `subscribe()`'s storage writes imply plus a token transfer and fee computation.

### `bench_pay_per_use`

Subscribes a user (a subscription must exist), then measures a single `pay_per_use()` call for an ad-hoc charge outside the regular billing interval. Measured: **530,622 CPU instructions / 86,189 memory bytes** — comparable to `charge()`, since the underlying charge-execution path (`charge_exec.rs`) is shared.

### `bench_batch_charge_10_users`

Subscribes 10 independent users (all due for billing), advances the ledger past every interval, then measures one `batch_charge()` call across all 10. Verifies all 10 results are `ChargeResult::Charged` (i.e., the benchmark also asserts correctness, not just cost). Measured: **6,706,059 CPU instructions / 1,304,444 memory bytes** — this is the number to watch if you're evaluating "how many subscribers can one `batch_charge` transaction realistically cover" for keeper batch-sizing (see [`docs/KEEPER.md`](../KEEPER.md) and the configurable max batch size).

### `bench_charge_vs_subscribe_ratio`

Not a standalone cost measurement — a **relative regression guard**. It measures `subscribe()` and `charge()` in the same environment and asserts `charge_cpu <= subscribe_cpu * 3`. The intent is to catch a change that makes `charge()` disproportionately expensive relative to `subscribe()` even if both individually stay under their absolute thresholds. Measured ratio: **1.95×** (well under the 3× ceiling).

---

## Regression Detection

Because the benchmarks are deterministic given the same code and SDK version, comparing two runs is a matter of comparing two sets of printed numbers — no statistical noise-averaging required.

### Manual comparison (before/after a change)

1. On a clean `master` checkout (or before your change), capture a baseline:
   ```bash
   cd contract
   cargo test --features testutils bench -- --nocapture > /tmp/bench-before.txt
   ```
2. Apply your change, then capture a second run:
   ```bash
   cargo test --features testutils bench -- --nocapture > /tmp/bench-after.txt
   ```
3. Diff the two:
   ```bash
   grep -A2 '^\[bench_' /tmp/bench-before.txt > /tmp/before-numbers.txt
   grep -A2 '^\[bench_' /tmp/bench-after.txt  > /tmp/after-numbers.txt
   diff /tmp/before-numbers.txt /tmp/after-numbers.txt
   ```
4. Any changed `CPU Instructions` or `Memory Bytes` line is a candidate regression (or improvement). Ask: is this shift explained by an intentional change to that function's logic? If yes, it's expected — update the baselines table in this doc and in [`docs/CONTRIBUTING-CONTRACT.md`](../CONTRIBUTING-CONTRACT.md#benchmarks) if the shift exceeds ~5%. If the change touched an unrelated part of the contract, treat it as a real regression and investigate (a shared helper got more expensive, an extra storage read was introduced, etc.).

### What counts as a regression vs. noise

Because Soroban's budget metering is deterministic (not wall-clock timing), there is no "run it 10 times and average" step — the same inputs against the same compiled contract produce the same instruction count every time. If two runs of _identical_ code produce different numbers, that itself is a bug worth investigating (usually nondeterministic iteration order over an unordered collection), not something to average away.

A meaningful regression is any increase not explained by an intentional feature change, especially in `charge()` or `batch_charge()` since those run on every keeper billing cycle across every active subscriber — a regression there multiplies across the whole subscriber base, unlike a one-time `subscribe()` cost.

### Comparing against a committed baseline

Keep the "Actual measured baselines" table in this document current. When you deliberately shift a baseline by more than ~5%, update:

1. This table.
2. The baselines table in [`docs/CONTRIBUTING-CONTRACT.md`](../CONTRIBUTING-CONTRACT.md#benchmarks).
3. The `MAX_*_INSTRUCTIONS` constants in `bench.rs` if the new number no longer leaves reasonable headroom under the threshold.

---

## Adding New Benchmarks

Use this template — it mirrors the existing benchmarks' structure so results stay comparable across the suite.

```rust
// contract/src/bench.rs

/// Measures the instruction cost of a single `my_function()` call.
///
/// Baseline (YYYY-MM-DD):
///   CPU Instructions : <fill in after first run>
///   Memory Bytes     : <fill in after first run>
#[test]
fn bench_my_function() {
    let (env, contract_id, token_addr, user, merchant) = bench_setup();
    let client = FlowPayClient::new(&env, &contract_id);

    // ── Arrange any state your function needs, unmeasured ──────────────────
    client.subscribe(&user, &merchant, &5_0000000, &86400, &token_addr, &None, &None);

    // Reset budget immediately before the call under measurement — anything
    // before this line is setup cost and must not be counted.
    env.budget().reset_unlimited();

    client.my_function(&user);

    let cpu = env.budget().cpu_instruction_cost();
    let mem = env.budget().memory_bytes_cost();

    env.budget().reset_default();

    println!("\n[bench_my_function]");
    println!("  CPU Instructions : {}", cpu);
    println!("  Memory Bytes     : {}", mem);

    assert!(cpu > 0, "my_function() must consume CPU instructions");
    assert!(mem > 0, "my_function() must consume memory");
    assert!(
        cpu <= MAX_MY_FUNCTION_INSTRUCTIONS,
        "my_function() CPU ({}) exceeds budget threshold ({})",
        cpu,
        MAX_MY_FUNCTION_INSTRUCTIONS
    );
}
```

Steps:

1. Add the `#[test]` function to `contract/src/bench.rs`, following the template above.
2. Reuse the shared `bench_setup()` (or `add_funded_user()`) helper rather than hand-rolling environment setup — this keeps every benchmark's baseline environment identical.
3. Call `env.budget().reset_unlimited()` **immediately before** the call you're measuring, and `env.budget().reset_default()` immediately after reading the cost — anything outside that window pollutes the measurement with setup cost.
4. Run it once with `cargo test --features testutils bench_my_function -- --nocapture` to get the actual baseline number, then fill in the doc comment and add a `MAX_MY_FUNCTION_INSTRUCTIONS` constant near the top of the file with ~10% headroom over the measured value.
5. Add the new benchmark's baseline to the tables in this document and in [`docs/CONTRIBUTING-CONTRACT.md`](../CONTRIBUTING-CONTRACT.md#benchmarks).

---

## CI Integration

The `Backend (Rust)` workflow ([`.github/workflows/rust.yml`](../../.github/workflows/rust.yml)) currently runs `cargo clippy`, `cargo build`, and `cargo test --verbose` on every push/PR to `master` — `cargo test` already includes the benchmark tests, so a benchmark that exceeds its `MAX_*_INSTRUCTIONS` threshold **already fails CI today** as a normal test failure. That's the baseline gate every PR goes through.

To add a dedicated, visible benchmark-reporting step (rather than relying on failures buried in the general `cargo test` output), add a step after the existing `Run tests` step:

```yaml
- name: Run tests
  run: cargo test --verbose
  working-directory: contract
- name: Run benchmarks
  run: cargo test --features testutils bench -- --nocapture
  working-directory: contract
```

This re-runs the same benchmark tests (they already ran once as part of `cargo test --verbose` above) but with `--nocapture`, so the CPU/memory numbers for every benchmark show up directly in the Actions log for each PR — useful for a reviewer eyeballing whether a PR touching `subscribe`/`charge`/`pay_per_use`/`batch_charge` shifted the numbers, without needing to run anything locally.

**On tightening this further** (e.g., failing CI on any regression rather than only on crossing the absolute threshold): that requires persisting the previous run's numbers somewhere CI can read them back (a checked-in baseline file, or a cache/artifact keyed by commit) and diffing against them in the workflow — that's a larger change than adding a print step and isn't implemented today. If you want to build it, the [Regression Detection](#regression-detection) manual comparison above is exactly the logic you'd automate: capture `grep -A2 '^\[bench_' ` output before and after, diff the CPU/memory lines, and fail the job if any value increases beyond an agreed tolerance (e.g., 5%).

---

## Related

- [`contract/src/bench.rs`](../../contract/src/bench.rs) — the benchmark suite itself
- [`docs/TESTING.md`](../TESTING.md) — general test suite guide, including snapshot files
- [`docs/CONTRIBUTING-CONTRACT.md`](../CONTRIBUTING-CONTRACT.md#benchmarks) — contribution checklist requirement to run benchmarks when touching hot-path functions
- [`.github/workflows/rust.yml`](../../.github/workflows/rust.yml) — CI workflow that runs the benchmark tests today
