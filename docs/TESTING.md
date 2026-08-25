# Testing Guide

This document explains how to run the FlowPay test suite, how the benchmark file works, and how to interpret snapshot outputs. It also covers integration testing against a real testnet deployment, end-to-end testing of the full subscriber flow, testing keeper scripts, managing reproducible test data, and what runs in CI versus what requires manual testing.

- Contract unit tests and benchmarks: [Running the Tests](#running-the-tests), [Benchmarks](#benchmarks)
- Cross-system and live-network testing: [Integration Testing](#integration-testing), [End-to-End Testing](#end-to-end-testing), [Keeper Testing](#keeper-testing), [Test Data Management](#test-data-management)
- [CI](#ci) — what's automated vs. manual

For deep dives on specific contract test patterns (ledger time manipulation, mocking, panic testing), see [`docs/development/testing_runbook.md`](development/testing_runbook.md). For contract testing conventions specifically, see [`docs/CONTRIBUTING-CONTRACT.md`](CONTRIBUTING-CONTRACT.md#testing-conventions). For benchmark interpretation and regression detection in depth, see [`docs/development/performance-benchmarking.md`](development/performance-benchmarking.md).

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

| Test file                          | Coverage                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| `subscriptionValidation.test.ts`   | Violation formatting and failure detection                            |
| `useAdmin.test.tsx`                | Admin wallet authorization                                            |
| `SubscriptionRepairPanel.test.tsx` | Validation/repair UI states, event count display, unauthorized repair |
| `AdminDashboard.test.tsx`          | Dashboard integration and read-only guidance                          |

---

## Integration Testing

Unit tests (contract `cargo test`, frontend `npm run test`) run entirely in-memory — the contract tests use `Env::default()`, and frontend tests mock `stellar.ts` rather than hitting a real network. Integration testing means running the frontend against a **real deployed contract on testnet**, so you exercise the actual RPC round-trip, real transaction simulation, and real wallet signing flow.

### When you need this

- You changed `frontend/src/stellar.ts` or any hook that calls it, and want to confirm the request/response shape still matches a live contract.
- You changed a contract function's signature and want to confirm the frontend's generated bindings (`frontend/src/generated/contract.ts`) still work end-to-end, not just that they compile.
- You're validating a testnet deployment before promoting it toward mainnet (see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)).

### Required environment variables

Set these in `frontend/.env.local` (copy from `frontend/.env.example`):

```bash
VITE_CONTRACT_ID=<deployed contract ID>
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

You need a contract already deployed to testnet — see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md#testnet-deployment) if you don't have one, or use [Test Data Management](#test-data-management) below to get funded test accounts against an existing deployment.

### Running

```bash
cd frontend
npm run dev
```

Open the dev server URL, connect a testnet-funded Freighter wallet (or one of the identities generated by `scripts/testnet-setup.ts`, imported into your wallet), and drive the UI: subscribe, view subscription state, cancel. Because this hits real testnet RPC, expect each action to take a few seconds (ledger close time) rather than being instant like the mocked unit tests.

There is currently no automated integration test target (e.g. `npm run test:integration`) — this is a manual verification step. If you want to script it, you can call `frontend/src/stellar.ts`'s exported functions directly from a small Node/Vitest script with `VITE_CONTRACT_ID`/`VITE_RPC_URL` pointed at testnet instead of mocking them, following the same client construction pattern the reference scripts under `scripts/` use (see [`scripts/health-check.ts`](../scripts/health-check.ts) for the simplest example of a real RPC round-trip).

### Expected result

A successful integration pass looks like: the UI reflects the subscription state change within one ledger close (~5s) of submitting a transaction, and no console errors appear from `stellar.ts`. If the UI hangs or errors, check `VITE_RPC_URL` reachability first (`curl -X POST $VITE_RPC_URL` should return a JSON-RPC error body, not a connection failure), then confirm `VITE_CONTRACT_ID` is actually deployed on the network your RPC URL points at.

---

## End-to-End Testing

End-to-end (E2E) testing here means manually walking the **entire** subscriber → keeper → charge → merchant withdraw lifecycle across both halves of the system, rather than testing any one function or component in isolation. There is no automated E2E harness in this repo today (no Playwright/Cypress suite) — this is a manual checklist to run before merging a change that could affect the full flow, and before any deployment promotion.

### Prerequisites

- A contract deployed to testnet (see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md))
- Frontend running against that deployment (see [Integration Testing](#integration-testing) above)
- A funded test subscriber and a merchant address — use [`scripts/testnet-setup.ts`](../scripts/testnet-setup.ts) (see [Test Data Management](#test-data-management)) rather than hand-generating and funding keys each time
- Either the reference keeper pattern from [`docs/KEEPER.md`](KEEPER.md) or a manual `batch_charge` invocation via the Soroban CLI, to simulate the keeper's role

### Checklist

1. **Subscribe**
   - [ ] In the frontend, subscribe the test user to the test merchant with a short interval (e.g. 60 seconds, so you don't wait long in step 3).
   - [ ] Confirm the UI shows the subscription as active immediately after the transaction confirms.
   - [ ] Confirm a `subscribed` event appears via [`scripts/watch-events.ts`](../scripts/watch-events.ts) run against the same contract.

2. **Wait for the interval to elapse**
   - [ ] Wait past `last_charged + interval` (use the short interval from step 1 to keep this fast).

3. **Keeper charges the subscriber**
   - [ ] Invoke `batch_charge` with the test user's address (via the CLI, or a keeper implementation if you have one running) and confirm the result is `Charged`.
   - [ ] Confirm a `charged` event appears via `watch-events.ts` with the expected `gross`/`fee`/`net` split.
   - [ ] Confirm the frontend UI (refresh or re-fetch) shows the updated `last_charged` timestamp and any charge-history view.

4. **Merchant withdraws**
   - [ ] As the merchant address, call `withdraw_merchant_revenue` (via the frontend if there's a merchant UI for it, or via CLI).
   - [ ] Confirm the merchant's token balance increases by the expected net amount.
   - [ ] Confirm a `merchant_withdrawal` event appears via `watch-events.ts`.

5. **Cancel (cleanup / negative path)**
   - [ ] Cancel the subscription as the test user.
   - [ ] Confirm a subsequent `batch_charge` attempt for that user returns `Inactive`, not `Charged`.

If every checkbox passes, the full flow is verified end-to-end. Any failure here is higher-signal than a unit test failure — it means something about how the pieces integrate (not any single piece) is broken.

---

## Keeper Testing

The reference keeper implementation in [`docs/KEEPER.md`](KEEPER.md#running-the-reference-keeper) is Python and illustrative — the `invoke_read`, `invoke_batch_charge`, and `check_balance` functions are left as stubs for you to fill in with your chosen Soroban SDK bindings. Whether you're testing that reference pattern or your own keeper implementation, the same two-mode approach applies.

### Dry-run mode

Before a keeper is allowed to submit real `batch_charge` transactions, test its **read path** in isolation:

- Paging through the subscriber index (`get_subscriber_index_size()` / `get_subscriber_at(offset)`) without calling `batch_charge` at all.
- Computing which addresses _would_ be due for a charge this cycle (comparing `last_charged + interval` against current time) and logging that list instead of submitting it.

This validates pagination and due-date logic against a real deployment without moving any funds — critical to test in isolation because a bug in "who is due" logic (e.g., an off-by-one in interval math) is invisible if you only ever look at `batch_charge`'s aggregate result.

```python
def run_charge_cycle(server, keypair, dry_run: bool = False):
    offset = 0
    while True:
        addresses = fetch_subscriber_page(server, keypair, offset, PAGE_SIZE)
        if not addresses:
            break
        if dry_run:
            logger.info(f"[dry-run] would batch_charge {len(addresses)} addresses at offset={offset}")
        else:
            invoke_batch_charge(server, keypair, addresses)
        offset += PAGE_SIZE
```

Run this against your testnet deployment (populated via [`scripts/testnet-setup.ts`](../scripts/testnet-setup.ts) with a short subscription interval so subscribers become due quickly) and confirm the logged "would charge" list matches what you expect given the subscriptions you created.

### Live mode with monitoring

Once dry-run output looks correct, run the keeper against testnet in live mode (`dry_run=False`) with the monitoring described in [`docs/KEEPER.md`](KEEPER.md#monitoring-and-alerting) active:

- Watch the keeper's own logs for per-address `ChargeResult`s (`Charged`, `Skipped`, `GracePeriodElapsed`, etc.).
- Independently confirm charges landed by running [`scripts/watch-events.ts`](../scripts/watch-events.ts) against the same contract and cross-checking `charged` event counts against the keeper's own "charged" tally for the cycle.
- If you've wired up the `/health` endpoint pattern from `docs/KEEPER.md`, confirm it reflects `last_cycle_charged` matching what `watch-events.ts` observed.

A live-mode testnet run is considered validated when the keeper's self-reported charge count and the independently observed `charged` event count agree — if they don't, that's a real bug (either the keeper is silently swallowing failures, or your event observation has a gap — see [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md#reliability) for gap-detection techniques).

---

## Test Data Management

Integration, E2E, and keeper testing all need funded testnet accounts with known subscription state — and re-creating that by hand (generate a keypair, fund it, remember which one is "the merchant") does not scale past a couple of manual runs and is not reproducible between contributors.

[`scripts/testnet-setup.ts`](../scripts/testnet-setup.ts) solves this by deterministically deriving accounts from a `--seed`: the same seed always produces the same set of public/secret keypairs, and the script funds any of them that aren't already funded via Friendbot.

```bash
cd scripts
npm install
npx tsx testnet-setup.ts --seed 1 --users 3 --merchants 1
```

Expected output:

```text
Setting up testnet fixtures: seed=1 users=3 merchants=1

Wrote manifest: /path/to/scripts/.testnet-manifest.1.json
  user[0] GA5N...WTX — funding via Friendbot...
  user[0] GA5N...WTX — funded
  user[1] GBKM...U54 — funding via Friendbot...
  user[1] GBKM...U54 — funded
  merchant[0] GBWQ...DJIT — funding via Friendbot...
  merchant[0] GBWQ...DJIT — funded

Manifest: /path/to/scripts/.testnet-manifest.1.json
Next step: use the Soroban CLI with these identities to call subscribe()/charge()
against your deployed contract — see docs/TESTING.md, Integration Testing section.
```

Re-running the same command reuses the existing manifest and reports each identity as `already funded` instead of re-funding it — safe to run repeatedly, including in CI or a setup script other contributors share.

The generated manifest (`scripts/.testnet-manifest.<seed>.json`, gitignored) contains each identity's public **and secret** key and its role (`user` or `merchant`). Feed the secret keys to the Soroban CLI to actually invoke contract functions on their behalf, e.g.:

```bash
soroban contract invoke \
  --id $CONTRACT_ID --source <user-secret-from-manifest> --network testnet \
  -- subscribe --user <user-public> --merchant <merchant-public> \
     --amount 50000000 --interval 60 --token $TOKEN_ID
```

These are testnet-only throwaway keys with no real value — never reuse a seed's identities for anything beyond disposable testing, and never point this script at a mainnet RPC URL.

### Choosing a seed

Use a distinct `--seed` per scenario you want to keep independent (e.g., `--seed 1` for a "normal subscriber" fixture set, `--seed 2` for an "already-cancelled subscriber" fixture set) so test runs don't interfere with each other's contract state on the same deployment.

---

## CI

### What runs in CI today

| Workflow                                          | Steps                                                                | Covers                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Backend (Rust)`](../.github/workflows/rust.yml) | `cargo clippy -- -D warnings`, `cargo build`, `cargo test --verbose` | All contract unit tests **and** the benchmark tests in `bench.rs` (they're plain `#[test]` functions, so `cargo test` runs them too — see [`docs/development/performance-benchmarking.md`](development/performance-benchmarking.md#ci-integration) for adding a dedicated `--nocapture` reporting step) |
| [`Frontend`](../.github/workflows/frontend.yml)   | `npm ci`, `npm run lint`, `npx prettier --check .`, `npm run build`  | Linting, formatting, and a production build — note this workflow does **not** currently run `npm run test` (the Vitest suite) as a separate step; `npm run build` only type-checks and bundles                                                                                                          |

### What requires manual testing

Nothing in CI touches a real network — there is no testnet RPC access from GitHub Actions today. That means the following are **manual-only**, run by a contributor or reviewer before merging changes that could affect them:

- [Integration Testing](#integration-testing) — frontend against a live testnet contract
- [End-to-End Testing](#end-to-end-testing) — the full subscriber → keeper → charge → withdraw checklist
- [Keeper Testing](#keeper-testing) — dry-run and live-mode keeper validation

### Adding a new CI test

- **A new contract unit or benchmark test**: add it to `contract/src/test.rs` (or `bench.rs`) — it's picked up automatically by the existing `cargo test --verbose` step, no workflow change needed.
- **A new frontend unit test**: add it under `frontend/src/**/__tests__/` — picked up automatically by Vitest's default discovery, but remember the `Frontend` workflow doesn't currently invoke `npm run test` at all (see table above); if you want frontend unit tests enforced in CI, add a step to [`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml):
  ```yaml
  - name: Test
    run: npm run test
  ```
- **A new integration/E2E/keeper check**: these require live testnet access and a funded account, which GitHub Actions doesn't have configured today. Automating any of them means provisioning a CI secret for a funded testnet keypair and accepting real network flakiness in CI — treat this as a deliberate infrastructure decision, not a drop-in workflow step, and discuss it in an issue before implementing it.
