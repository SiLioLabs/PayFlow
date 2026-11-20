# PayFlow

Decentralized subscriptions and recurring payments on Stellar, built with Soroban smart contracts.

PayFlow (also referred to as **FlowPay**) is a trustless, non-custodial recurring-billing protocol. Users approve the contract to transfer funds to a merchant on a schedule, enabling recurring subscriptions and pay-per-use microtransactions without a custodian holding user keys.

## What it is

- **Protocol:** Soroban smart contract on Stellar (Testnet only; not yet audited for Mainnet)
- **Core contract:** `FlowPay` — `subscribe`, `charge`, `pay_per_use`, `cancel`, `batch_charge`, and related entrypoints
- **Frontend:** React + TypeScript dashboard (Vite) for subscribers and merchants
- **Ops:** TypeScript keeper, indexer, and monitoring scripts under `scripts/`
- **Docs:** `docs/` — API reference, architecture, deployment, security, testing, and operations guides

## Architecture

```text
┌─────────────────┐         approve allowance         ┌──────────────────┐
│   Subscriber    │ ─────────────────────────────────▶│   Token (SAC)    │
│  (wallet user)  │                                   │   (e.g. XLM)     │
└────────┬────────┘                                   └──────────┬───────┘
         │ subscribe / pay_per_use                              │ transfer
         │ (signed by user)                                     │ (via allowance)
         ▼                                                      ▼
┌─────────────────┐                              ┌───────────────────────┐
│  FlowPay        │◄──────── batch_charge ───────│   Keeper (off-chain)  │
│  smart contract │   (recurring billing trigger│   TypeScript script   │
│  (Soroban/Rust) │                              │   or cron/Lambda      │
└────────┬────────┘                              └───────────┬───────────┘
         │ net to merchant / fee to collector                │ polls subscribers
         ▼                                                   ▼ due for interval
┌─────────────────┐                              ┌──────────────────┐
│   Merchant      │◄─────────────────────────────│   Frontend       │
│  (receives net) │                              │  React dashboard │
└─────────────────┘                              └──────────────────┘
# PayFlow — `get_daily_limit()` Read Function

**Issue:** Add `get_daily_limit()` read function (symmetric to `set_daily_limit`)  
**Branch:** `feat/get-daily-limit`  
**Status:** ✅ Implemented & tested

> 📚 **Documentation index:** [`docs/README.md`](docs/README.md) — every guide, grouped by task.

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

| Parameter | Type      | Description                     |
| --------- | --------- | ------------------------------- |
| `user`    | `Address` | The subscriber address to query |

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

**Key responsibilities by layer:**

| Layer | Responsibility |
|-------|----------------|
| `contract/src/lib.rs` | Entrypoints: `subscribe`, `charge`, `pay_per_use`, `cancel`, `batch_charge`, admin/config |
| `contract/src/fee.rs` | Protocol fee split (basis points) to fee collector |
| `contract/src/spending_limit.rs` | Per-user daily cap for `pay_per_use` / `pay_per_use_to` |
| `contract/src/referral.rs` | On-chain referral attribution (`DataKey::Referral`) |
| `frontend/` | React UI: dashboard, subscribe form, wallet (Freighter), modals |
| `scripts/` | Keeper, indexer, health check, alerts, testnet setup |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design, storage tiers, and TTL strategy.

## Quickstart

### Prerequisites

| Tool | Version |
|------|---------|
| Rust | 1.70+ |
| wasm32 target | `wasm32-unknown-unknown` |
| Soroban CLI | 21.x |
| Node.js | 18+ |

### Contract

```bash
cd contract
cargo build --release --target wasm32-unknown-unknown
cargo test
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # set VITE_CONTRACT_ID, VITE_RPC_URL, VITE_NETWORK_PASSPHRASE
npm run dev
```

### Scripts (keeper, indexer, ops)
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

A keeper is an off-chain scheduler (cron job, AWS Lambda, or any scripted process) that calls `batch_charge(users)` on the FlowPay contract whenever subscribers' billing intervals have elapsed. Because Soroban has no native scheduler, recurring charges depend entirely on this external trigger. To run one locally, maintain a list of subscriber addresses sourced from contract events and invoke `batch_charge` on a schedule — the contract handles all eligibility checks, so ineligible users are silently skipped without aborting the transaction. See the [Keeper runbook](docs/KEEPER.md) for the recommended pattern.

### How do I spin up a local validation environment for testing?

All contract tests run fully in-memory with no network connection required — `soroban-sdk`'s `Env::default()` provides an isolated Soroban runtime. Install Rust 1.70+ with the `wasm32-unknown-unknown` target, then run `cd contract && cargo test` to execute the full suite. To simulate time passing (e.g. advancing past a billing interval), use `env.ledger().with_mut(|l| { l.timestamp += seconds; })` inside your test. For frontend validation, run `cd frontend && npm run test` using Vitest. Full setup steps are in [Testing Guide](docs/TESTING.md).

### What tokens does FlowPay support?

Each deployed FlowPay contract is initialized with a single **Stellar Asset Contract (SAC)** address — for example, the SAC for XLM or any other SAC-wrapped asset on Stellar. All subscription amounts are denominated in **stroops** (1 XLM = 10,000,000 stroops). Supporting multiple tokens in the same deployment is a planned feature; for now, supporting different tokens requires deploying separate contract instances. Per-subscription token addresses are stored in the `Subscription` struct, so users can switch tokens by re-subscribing with a different SAC address.

### How is the protocol fee calculated?

The protocol fee is configured by the admin via `set_fee(collector, bps)` and expressed in **basis points** (1 bps = 0.01%, max 10,000 bps). On each successful `charge()`, the contract computes `fee_amount = amount * bps / 10_000` and routes that portion directly to the fee collector address via `transfer_from`; the net amount (`amount - fee_amount`) goes to the merchant. If no fee is configured or `bps` is zero, the full amount transfers to the merchant with no deduction. Full fee logic lives in [`contract/src/fee.rs`](contract/src/fee.rs).

### How does a trial period work?

An optional trial duration (in seconds) is passed as `trial_period: Option<u64>` to `subscribe()`. When set, the contract initializes `last_charged` to `now + trial_period` instead of `now`, pushing the first eligible charge forward by that duration. The `get_trial_end(user)` function returns the trial-end timestamp when `last_charged > now`, and `None` once the trial has expired — no separate storage key is used, the trial end is encoded directly in `last_charged`. See [`contract/src/trial.rs`](contract/src/trial.rs) for the implementation.

### How does the grace period work?

The grace period is a **contract-wide** setting (set by admin via the two-step `propose_grace_period(seconds)` / `commit_grace_period()`) that defines how long after a billing interval elapses a charge can still be successfully submitted. Concretely, `charge()` will accept a call only within the window `[last_charged + interval, last_charged + interval + grace_period]`; calls after that window panic with `"grace period elapsed"`. In `batch_charge`, users whose grace window has closed are returned as `ChargeResult::GracePeriodElapsed` without aborting the batch. The default is 0 (no grace period). Details are in [`contract/src/grace.rs`](contract/src/grace.rs) and [`docs/API.md`](docs/API.md#propose_grace_period).

### How are contract upgrades and storage migrations handled?

Contract WASM can be replaced by the admin via the `upgrade(new_wasm_hash)` entrypoint, which calls `env.deployer().update_current_contract_wasm()` and emits an `upgraded` event. If the new WASM introduces storage layout changes, call `migrate()` once after upgrading — it reads the current `SchemaVersion` from instance storage and applies any pending transformations sequentially (e.g., the v1→v2 migration adds the `paused` field to all provided `Subscription` records). Subsequent `migrate()` calls are safe no-ops. See [Deployment — State Migration](docs/DEPLOYMENT.md#state-migration) for the full migration history and CLI steps.

### What is the difference between Testnet and Mainnet deployments?

FlowPay is **currently deployed on Testnet only** and has not been formally audited — it should not be used to manage real funds on Mainnet until an independent Soroban security audit is completed and published. The frontend targets the network specified by three environment variables in `frontend/.env`: `VITE_CONTRACT_ID` (your deployed contract address), `VITE_RPC_URL` (defaults to `https://soroban-testnet.stellar.org`), and `VITE_NETWORK_PASSPHRASE` (defaults to `Networks.TESTNET`). Switching to Mainnet requires updating all three variables to point to your Mainnet contract and RPC endpoint. The planned audit roadmap is documented in [Security](docs/SECURITY.md#audit-roadmap). For the full Mainnet go-live checklist (security gates, key management, deploy, verification, announcement), see [Mainnet Deployment Checklist](docs/MAINNET-DEPLOYMENT.md).

### Why is `charge()` permissionless — isn't that a security risk?

`charge()` has no `require_auth()` check by design, so any account (including a keeper bot) can trigger a charge without holding user keys. The contract enforces correctness independently: the subscription must exist, `active` must be `true`, and the billing interval must have elapsed — if any condition fails, the transaction panics and no funds move. Because the token transfer uses `transfer_from` against a pre-approved allowance, FlowPay can never move more than the user explicitly approved. This is covered in detail under [Security — Auth Model](docs/SECURITY.md#auth-model).

### How does the daily spending limit work for `pay_per_use`?

Users can cap their `pay_per_use` exposure by calling `set_daily_limit(user, limit)`, which stores the limit in **temporary storage** with a TTL of approximately 24 hours (~17,280 ledgers at 5 s/ledger). Every `pay_per_use` call checks that `DailySpent + amount <= DailyLimit` before transferring, and increments `DailySpent` on success. Both keys expire automatically after ~24 hours, resetting the counter without any manual cleanup. Use `get_daily_limit(user)` and `get_daily_spent(user)` to inspect the current state. See [`docs/API.md`](docs/API.md#set_daily_limit) and the [Storage Architecture](docs/architecture/STORAGE-AND-TTL.md) for TTL details.

### How does FlowPay prevent subscription data from being evicted by the network?

Stellar's Soroban platform uses state archiving — persistent storage entries have a TTL and can be evicted if not refreshed. FlowPay automatically calls `extend_ttl` on a subscription's persistent storage entry during `subscribe()` and `charge()`, bumping its TTL to ~1 year (6,307,200 ledgers). For subscriptions that are paused or idle for extended periods, keepers or users should manually call `extend_subscription_ttl(user)` to prevent archival. Daily-limit data uses temporary storage (~24-hour TTL) and is permanently purged on expiry — this is intentional, not a risk. Full details are in [Storage and TTL Management](docs/architecture/STORAGE-AND-TTL.md).

---

## Prerequisites

| Tool          | Version | Install                                    |
| ------------- | ------- | ------------------------------------------ |
| Rust          | 1.70+   | `curl https://sh.rustup.rs -sSf \| sh`     |
| wasm32 target | —       | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI   | 21.x    | `cargo install --locked soroban-cli`       |

---

## Related

- `set_daily_limit(user, limit)` — sets the cap
- `remove_daily_limit(user)` — clears the cap
- `get_daily_spent(user)` — returns how much has been spent today
- `pay_per_use(user, amount)` — the function this limit applies to
- Documentation index: [`docs/README.md`](docs/README.md)
- Project structure: [`docs/STRUCTURE.md`](docs/STRUCTURE.md)
- Full API reference: [`docs/API.md`](docs/API.md)
- Architecture overview: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Referral system (canonical): [`docs/REFERRALS.md`](docs/REFERRALS.md)
- Developer Integration Guide: [`docs/INTEGRATION-GUIDE.md`](docs/INTEGRATION-GUIDE.md)
- Mainnet deployment checklist: [`docs/MAINNET-DEPLOYMENT.md`](docs/MAINNET-DEPLOYMENT.md)
- Merchant Integration Cookbook: [`docs/MERCHANT-INTEGRATION.md`](docs/MERCHANT-INTEGRATION.md)

### Operations quick-links

For when something needs doing to a live deployment:

- [Keeper runbook](docs/KEEPER.md) - runtime, flags and configuration for `keeper.ts`
- [Troubleshooting runbook](docs/operations/TROUBLESHOOTING.md) - diagnosing `ChargeResult` errors, wallet failures, RPC failures and other operational issues
- [Scripts environment reference](docs/SCRIPTS-ENVIRONMENT.md) - every environment variable the scripts read, with defaults
- [Charge outcome encoding](docs/CHARGE-RESULTS.md) - what a `ChargeResult` is on the wire, and what the DLQ and export tooling should do with it
- [Batch and pagination caps](docs/LIMITS.md) - every size limit the contract enforces
- [Operator scripts](scripts/README.md#undocumented-operator-scripts) - the maintenance tools: allowance alerts, churn analysis, migration, merchant onboarding, renewal forecasts, metrics

---

## Subscriber Churn Analysis Dashboard

The **Subscriber Churn Analysis Dashboard** script offers detailed cohort-based monthly retention metrics, merchant-level churn breakdown, and future churn projections.

### Features

- **Data Ingestion with Graceful Fallback**: Automatically reads from your local SQLite indexer database if available, and gracefully falls back to querying on-chain Soroban RPC events otherwise.
- **Monthly Cohort Tracking**: Groups subscribers by initial subscription month to compute 30-day and 90-day active counts and retention rates. Includes data guarding that flags younger cohorts as `"insufficient data"`.
- **Merchant Churn Breakdown**: Identifies the Top 5 high-churn merchants while automatically filtering out single-subscriber merchants (`subscribers <= 1`) to eliminate statistical skew.
- **Historical Churn Projection**: Analyzes historical monthly average churn rates of completed cohorts and applies them to current active subscribers to project the next month's churn.
- **Dual Formats**: Outputs reports in raw JSON or formatted CSV tables.

### Usage

Run the script using `ts-node` or `tsx` from the `scripts` or root directory:

```bash
cd scripts
npm install
npm run typecheck
```

See [`docs/ONBOARDING.md`](docs/ONBOARDING.md) for a contributor walkthrough and [`docs/development/network-matrix.md`](docs/development/network-matrix.md) for aligning frontend, scripts, and contract on the same network.

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/API.md`](docs/API.md) | Full contract function reference (auth, errors, events) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, storage strategy, module map |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security model, threat model, auth matrix |
| [`docs/TESTING.md`](docs/TESTING.md) | Running contract/frontend/scripts tests |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deploy pipeline and health gates |
| [`docs/MAINNET-DEPLOYMENT.md`](docs/MAINNET-DEPLOYMENT.md) | Mainnet go-live checklist |
| [`docs/REFERRALS.md`](docs/REFERRALS.md) | Referral system (canonical guide) |
| [`docs/DAILY-LIMITS.md`](docs/DAILY-LIMITS.md) | Daily spending limits for pay-per-use |
| [`docs/limits.md`](docs/limits.md) | Batch and pagination caps |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | Frontend architecture guide |
| [`docs/FRONTEND-COMPONENTS.md`](docs/FRONTEND-COMPONENTS.md) | Component reference |
| [`docs/KEEPER.md`](docs/KEEPER.md) | Keeper runtime and configuration |
| [`docs/integrations/frontend_integration.md`](docs/integrations/frontend_integration.md) | Frontend integration guide |

All docs live under [`docs/`](docs/).

## License

[MIT](LICENSE)
