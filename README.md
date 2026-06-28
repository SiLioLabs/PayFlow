# PayFlow — `get_daily_limit()` Read Function

**Issue:** Add `get_daily_limit()` read function (symmetric to `set_daily_limit`)  
**Branch:** `feat/get-daily-limit`  
**Status:** ✅ Implemented & tested

---

## What This Does

Users who set a daily spending cap via `set_daily_limit()` had no way to read it back. This adds a public `get_daily_limit()` function to the `FlowPay` contract so users can query their current cap at any time.

---

## Background

FlowPay is a Soroban smart contract on Stellar that handles recurring subscriptions and pay-per-use billing. The `pay_per_use()` function supports an optional daily spending limit — users can call `set_daily_limit()` to cap how much they spend in a single day. Before this change, there was no corresponding read function, leaving users unable to verify what limit they had set.

---

## Changes

### `contract/src/spending_limit.rs`

The internal helper `get_daily_limit` reads from temporary storage and returns `None` if no limit has been set for the user:

```rust
/// Returns the daily spending limit for a user, or `None` if not set.
pub fn get_daily_limit(env: &Env, user: &Address) -> Option<i128> {
    env.storage()
        .temporary()
        .get(&DataKey::DailyLimit(user.clone()))
}
```

### `contract/src/lib.rs`

The public contract method exposes this to callers. No auth is required — reading your own limit is a view-only operation:

```rust
/// Returns the current daily spending limit for the caller, or `None` if unset.
pub fn get_daily_limit(env: Env, user: Address) -> Option<i128> {
    spending_limit::get_daily_limit(&env, &user)
}
```

---

## API

```
get_daily_limit(env: Env, user: Address) -> Option<i128>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `user` | `Address` | The subscriber address to query |

**Returns:** `Some(limit)` in stroops if a limit is set, `None` otherwise.  
**Auth:** None required.  
**Storage:** Reads `DataKey::DailyLimit(user)` from temporary storage.

**CLI example:**
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_daily_limit \
  --user <USER_ADDRESS>
```

---

## Tests

The following tests in `contract/src/test.rs` cover this function:

### `test_daily_limit_visibility_and_spend_tracking`

Verifies the full lifecycle — `None` before setting, correct value after setting, and unchanged after a `pay_per_use` call:

```rust
#[test]
fn test_daily_limit_visibility_and_spend_tracking() {
    let (env, contract_id, token_addr, user, merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.subscribe(&user, &merchant, &1_0000000, &86400, &token_addr, &None, &None);

    // None before any limit is set
    assert_eq!(client.get_daily_limit(&user), None);
    assert_eq!(client.get_daily_spent(&user), 0);

    client.set_daily_limit(&user, &4_0000000);

    // Returns the set value
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));

    client.pay_per_use(&user, &1_0000000);

    // Limit unchanged after spending
    assert_eq!(client.get_daily_spent(&user), 1_0000000);
    assert_eq!(client.get_daily_limit(&user), Some(4_0000000));
}
```

### `test_daily_limit_removed_event_emitted`

Verifies `get_daily_limit` returns `None` after `remove_daily_limit` is called:

```rust
#[test]
fn test_daily_limit_removed_event_emitted() {
    let (env, contract_id, _token_addr, user, _merchant) = setup();
    let client = FlowPayClient::new(&env, &contract_id);

    client.set_daily_limit(&user, &4_0000000);
    client.remove_daily_limit(&user);

    assert_eq!(client.get_daily_limit(&user), None);
    assert_last_user_event(&env, "daily_limit_removed", &user);
}
```

---

## Running the Tests

```bash
cd contract
cargo test
```

To run only the spending limit tests:

```bash
cargo test daily_limit
```

Expected output:
```
test test::test_daily_limit_allows_spend_within_limit ... ok
test test::test_daily_limit_accumulates_across_calls ... ok
test test::test_daily_limit_blocks_cumulative_overspend ... ok
test test::test_daily_limit_blocks_overspend ... ok
test test::test_daily_limit_removed_event_emitted ... ok
test test::test_daily_limit_set_event_emitted ... ok
test test::test_daily_limit_visibility_and_spend_tracking ... ok
```

---

## FAQ

### What is a keeper and how do I run one locally?

A keeper is an off-chain scheduler (cron job, AWS Lambda, or any scripted process) that calls `batch_charge(users)` on the FlowPay contract whenever subscribers' billing intervals have elapsed. Because Soroban has no native scheduler, recurring charges depend entirely on this external trigger. To run one locally, maintain a list of subscriber addresses sourced from contract events and invoke `batch_charge` on a schedule — the contract handles all eligibility checks, so ineligible users are silently skipped without aborting the transaction. See [Architecture — Keeper Service](docs/ARCHITECTURE.md#keeper-service) for the recommended pattern.

### How do I spin up a local validation environment for testing?

All contract tests run fully in-memory with no network connection required — `soroban-sdk`'s `Env::default()` provides an isolated Soroban runtime. Install Rust 1.70+ with the `wasm32-unknown-unknown` target, then run `cd contract && cargo test` to execute the full suite. To simulate time passing (e.g. advancing past a billing interval), use `env.ledger().with_mut(|l| { l.timestamp += seconds; })` inside your test. For frontend validation, run `cd frontend && npm run test` using Vitest. Full setup steps are in [Testing Guide](docs/TESTING.md).

### What tokens does FlowPay support?

Each deployed FlowPay contract is initialized with a single **Stellar Asset Contract (SAC)** address — for example, the SAC for XLM or any other SAC-wrapped asset on Stellar. All subscription amounts are denominated in **stroops** (1 XLM = 10,000,000 stroops). Supporting multiple tokens in the same deployment is a planned feature; for now, supporting different tokens requires deploying separate contract instances. Per-subscription token addresses are stored in the `Subscription` struct, so users can switch tokens by re-subscribing with a different SAC address.

### How is the protocol fee calculated?

The protocol fee is configured by the admin via `set_fee(collector, bps)` and expressed in **basis points** (1 bps = 0.01%, max 10,000 bps). On each successful `charge()`, the contract computes `fee_amount = amount * bps / 10_000` and routes that portion directly to the fee collector address via `transfer_from`; the net amount (`amount - fee_amount`) goes to the merchant. If no fee is configured or `bps` is zero, the full amount transfers to the merchant with no deduction. Full fee logic lives in [`contract/src/fee.rs`](contract/src/fee.rs).

### How does a trial period work?

An optional trial duration (in seconds) is passed as `trial_period: Option<u64>` to `subscribe()`. When set, the contract initializes `last_charged` to `now + trial_period` instead of `now`, pushing the first eligible charge forward by that duration. The `get_trial_end(user)` function returns the trial-end timestamp when `last_charged > now`, and `None` once the trial has expired — no separate storage key is used, the trial end is encoded directly in `last_charged`. See [`contract/src/trial.rs`](contract/src/trial.rs) for the implementation.

### How does the grace period work?

The grace period is a **contract-wide** setting (set by admin via `set_grace_period(seconds)`) that defines how long after a billing interval elapses a charge can still be successfully submitted. Concretely, `charge()` will accept a call only within the window `[last_charged + interval, last_charged + interval + grace_period]`; calls after that window panic with `"grace period elapsed"`. In `batch_charge`, users whose grace window has closed are returned as `ChargeResult::GracePeriodElapsed` without aborting the batch. The default is 0 (no grace period). Details are in [`contract/src/grace.rs`](contract/src/grace.rs) and [`docs/API.md`](docs/API.md#set_grace_period).

### How are contract upgrades and storage migrations handled?

Contract WASM can be replaced by the admin via the `upgrade(new_wasm_hash)` entrypoint, which calls `env.deployer().update_current_contract_wasm()` and emits an `upgraded` event. If the new WASM introduces storage layout changes, call `migrate()` once after upgrading — it reads the current `SchemaVersion` from instance storage and applies any pending transformations sequentially (e.g., the v1→v2 migration adds the `paused` field to all provided `Subscription` records). Subsequent `migrate()` calls are safe no-ops. See [Deployment — State Migration](docs/DEPLOYMENT.md#state-migration) for the full migration history and CLI steps.

### What is the difference between Testnet and Mainnet deployments?

FlowPay is **currently deployed on Testnet only** and has not been formally audited — it should not be used to manage real funds on Mainnet until an independent Soroban security audit is completed and published. The frontend targets the network specified by three environment variables in `frontend/.env`: `VITE_CONTRACT_ID` (your deployed contract address), `VITE_RPC_URL` (defaults to `https://soroban-testnet.stellar.org`), and `VITE_NETWORK_PASSPHRASE` (defaults to `Networks.TESTNET`). Switching to Mainnet requires updating all three variables to point to your Mainnet contract and RPC endpoint. The planned audit roadmap is documented in [Security](docs/SECURITY.md#audit-roadmap).

### Why is `charge()` permissionless — isn't that a security risk?

`charge()` has no `require_auth()` check by design, so any account (including a keeper bot) can trigger a charge without holding user keys. The contract enforces correctness independently: the subscription must exist, `active` must be `true`, and the billing interval must have elapsed — if any condition fails, the transaction panics and no funds move. Because the token transfer uses `transfer_from` against a pre-approved allowance, FlowPay can never move more than the user explicitly approved. This is covered in detail under [Security Model](docs/SECURITY.md#why-charge-is-permissionless) and [Architecture — Why charge() has no auth](docs/ARCHITECTURE.md#why-charge-has-no-auth).

### How does the daily spending limit work for `pay_per_use`?

Users can cap their `pay_per_use` exposure by calling `set_daily_limit(user, limit)`, which stores the limit in **temporary storage** with a TTL of approximately 24 hours (~17,280 ledgers at 5 s/ledger). Every `pay_per_use` call checks that `DailySpent + amount <= DailyLimit` before transferring, and increments `DailySpent` on success. Both keys expire automatically after ~24 hours, resetting the counter without any manual cleanup. Use `get_daily_limit(user)` and `get_daily_spent(user)` to inspect the current state. See [`docs/API.md`](docs/API.md#set_daily_limit) and the [Storage Architecture](docs/architecture/storage_and_ttl.md) for TTL details.

### How does FlowPay prevent subscription data from being evicted by the network?

Stellar's Soroban platform uses state archiving — persistent storage entries have a TTL and can be evicted if not refreshed. FlowPay automatically calls `extend_ttl` on a subscription's persistent storage entry during `subscribe()` and `charge()`, bumping its TTL to ~1 year (6,307,200 ledgers). For subscriptions that are paused or idle for extended periods, keepers or users should manually call `extend_subscription_ttl(user)` to prevent archival. Daily-limit data uses temporary storage (~24-hour TTL) and is permanently purged on expiry — this is intentional, not a risk. Full details are in [Storage and TTL Management](docs/architecture/storage_and_ttl.md).

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.70+ | `curl https://sh.rustup.rs -sSf \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | 21.x | `cargo install --locked soroban-cli` |

---

## Related

- `set_daily_limit(user, limit)` — sets the cap
- `remove_daily_limit(user)` — clears the cap
- `get_daily_spent(user)` — returns how much has been spent today
- `pay_per_use(user, amount)` — the function this limit applies to
- Full API reference: [`docs/API.md`](docs/API.md)
- Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Developer Integration Guide: [`docs/INTEGRATION-GUIDE.md`](docs/INTEGRATION-GUIDE.md)
