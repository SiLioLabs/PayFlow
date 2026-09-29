# Deployment Guide

Covers building the FlowPay contract, deploying to Testnet with `scripts/deploy-pipeline.ts`, post-deployment health gates, upgrades, and rollback. For the Mainnet audit gate and phased checklist, see [`MAINNET-DEPLOYMENT.md`](MAINNET-DEPLOYMENT.md).

---

## Prerequisites

| Tool             | Version | Install                                     |
| ---------------- | ------- | ------------------------------------------- |
| Rust             | 1.70+   | `curl https://sh.rustup.rs -sSf \| sh`      |
| wasm32 target    | —       | `rustup target add wasm32-unknown-unknown`  |
| Stellar CLI      | current | used by the pipeline as `stellar contract deploy` |
| Soroban CLI      | 21.x    | `cargo install --locked soroban-cli` (invokes and reads) |
| Node.js          | 18+     | [nodejs.org](https://nodejs.org/)           |
| Freighter Wallet | —       | [freighter.app](https://www.freighter.app/) |

Verify your setup:

```bash
rustc --version    # 1.70+
stellar --version  # required for live `stellar contract deploy`
soroban --version  # 21.x (optional; used for manual invoke/read)
node --version     # v18+
```

Install script dependencies from the repository root before running TypeScript tools:

```bash
cd scripts && npm install && cd ..
```

---

## Build

From the repository root:

```bash
cd contract
cargo build --release --target wasm32-unknown-unknown
```

The artifact used by [`deployments/config.json`](../deployments/config.json) and `scripts/deploy-pipeline.ts` is:

```text
contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
```

The pipeline also runs this build as its first step unless `deployments/manifest.json` already records `steps.build = true`.

---

## Deploy pipeline (Testnet)

Scripted deploy is [`scripts/deploy-pipeline.ts`](../scripts/deploy-pipeline.ts). It reads [`deployments/config.json`](../deployments/config.json) (checked-in values are **testnet**) and writes progress to [`deployments/manifest.json`](../deployments/manifest.json).

### Configuration

Edit `deployments/config.json` before a live run. Required fields:

| Field               | Role                                      |
| ------------------- | ----------------------------------------- |
| `network`           | Network name (checked-in: `testnet`)      |
| `networkPassphrase` | Must match the target network             |
| `rpcUrl`            | Soroban RPC                               |
| `tokenAddress`      | SAC token passed to `initialize`          |
| `adminAddress`      | Admin passed to `initialize`              |
| `feeBps`            | Protocol fee (proposed then committed)    |
| `feeCollector`      | Fee collector address                     |
| `initialMerchants`  | Optional list for `whitelist_batch_add`   |
| `wasmPath`          | Path to `flow_pay.wasm`                   |

If `NETWORK_PASSPHRASE` or `VITE_NETWORK_PASSPHRASE` is set, it must equal `networkPassphrase` in the config file.

### Environment (live deploy only)

| Variable              | Required | Role                                      |
| --------------------- | -------- | ----------------------------------------- |
| `DEPLOYER_SECRET_KEY` | yes      | Signs `stellar contract deploy`           |
| `ADMIN_SECRET_KEY`    | yes      | Signs post-deploy admin invokes           |
| `RPC_URL` / `VITE_RPC_URL` | no  | Optional RPC override for related scripts |
| `NETWORK_PASSPHRASE` / `VITE_NETWORK_PASSPHRASE` | no | Must match config if set |

`--dry-run` does not require the secret keys.

### Commands (from the repository root)

```bash
# 1. Validate config and print the steps that would run (no RPC deploy)
npx tsx scripts/deploy-pipeline.ts --dry-run

# 2. Live deploy (requires DEPLOYER_SECRET_KEY and ADMIN_SECRET_KEY)
npx tsx scripts/deploy-pipeline.ts
```

The pipeline, in order:

1. **Build** — `cargo build --release --target wasm32-unknown-unknown` in `contract/`.
2. **Deploy** — `stellar contract deploy --wasm <wasmPath> --source <DEPLOYER_SECRET_KEY> --rpc-url <rpcUrl> --network-passphrase <networkPassphrase>`. Parses a `C…` contract ID from stdout.
3. **Initialize** — `initialize(token, admin)` unless `contract_health_check` already reports `admin_configured` and `token_configured`.
4. **Health gate (in-pipeline)** — re-reads `contract_health_check` and aborts if token/admin are not configured.
5. **Fee** — `propose_fee` then `commit_fee` when the on-chain fee does not already match config.
6. **Merchants** — `whitelist_batch_add` for addresses in `initialMerchants` that are not yet whitelisted.

It does **not** set fee bounds or the global volume cap. Those are operator-only follow-ups (see [`MAINNET-DEPLOYMENT.md`](MAINNET-DEPLOYMENT.md)).

Save the printed contract ID.

### Frontend env after deploy

Copy [`frontend/.env.example`](../frontend/.env.example) to `frontend/.env` and set:

```bash
VITE_CONTRACT_ID=<CONTRACT_ID>
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

---

## Mainnet

> **Warning:** FlowPay has not been formally audited. Do not manage real funds on Mainnet until an independent security audit is complete.

FlowPay is currently deployed on **Testnet only**. When you are ready for Mainnet, follow the full phased checklist:

**→ [`MAINNET-DEPLOYMENT.md`](MAINNET-DEPLOYMENT.md)**

Use the same pipeline commands after pointing `deployments/config.json` at Mainnet RPC, passphrase, SAC, and keys. Do not reuse the checked-in testnet config for Mainnet.

Frontend Mainnet env:

```bash
VITE_CONTRACT_ID=<CONTRACT_ID>
VITE_RPC_URL=https://soroban-mainnet.stellar.org
VITE_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

---

## Post-deployment health gates

There is no separate shell verifier. Confirm health with on-chain `contract_health_check` and [`scripts/health-check.ts`](../scripts/health-check.ts).

The public ABI name is `contract_health_check` (not `health_check` / `get_health`). Auth: none.

```bash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- contract_health_check
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_protocol_stats
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_schema_version
```

Expected `contract_health_check` snapshot (`is_healthy` is true when all of the following hold):

| Field               | Expected                         |
| ------------------- | -------------------------------- |
| `is_healthy`        | `true`                           |
| `contract_paused`   | `false`                          |
| `token_configured`  | `true`                           |
| `admin_configured`  | `true`                           |
| `schema_version`    | Matches release / `CURRENT_VERSION` (3) |

### Off-chain script

From the repository root. `CONTRACT_ID` is required (`VITE_CONTRACT_ID` is accepted). Optional: `RPC_URL` / `VITE_RPC_URL`, `NETWORK=mainnet` to select `Networks.PUBLIC`.

```bash
# Shallow (default): simulates get_schema_version and get_active_count
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/health-check.ts

# Deep: also simulates contract_health_check and get_batch_charge_estimate
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/health-check.ts --deep

# Machine-readable
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/health-check.ts --deep --json
```

Exit `0` = healthy; exit `1` = unhealthy. `HEALTH_DEEP=true` enables deep mode without `--deep`.

You can also run from `scripts/` (same file):

```bash
cd scripts
CONTRACT_ID=<CONTRACT_ID> npx tsx health-check.ts
```

---

## State Migration

`migrate(users)` is **admin-only** (`admin::require_admin`). It takes a page of subscriber addresses. Current target is `CURRENT_VERSION` **3** in [`contract/src/migration.rs`](../contract/src/migration.rs). Already-migrated slots are no-ops; repeating `migrate` at version 3 does not bump the version again.

Paged workflow (also documented on `require_current_version` / `migrate` in that file):

1. Upgrade WASM. `schema_version` stays at the pre-upgrade value until migration finishes.
2. Page subscribers with `get_subscriber_page` (capped at 50 addresses per call).
3. Invoke `migrate` for each page.
4. Confirm `get_schema_version() == 3` before treating the instance as caught up.
`migrate(users)` is admin-only. It takes a **page of subscriber addresses**, not an empty invoke. Current target is `CURRENT_VERSION` **3** in [`contract/src/migration.rs`](../contract/src/migration.rs). Subsequent calls are no-ops for already-migrated slots.

Recommended operator workflow after a WASM upgrade that changes storage layout:

1. Upgrade WASM (`propose_upgrade` / `commit_upgrade`). Schema version stays at the pre-upgrade value until `migrate` finishes.
2. Page subscribers with `get_subscriber_page` (contract pages up to 50 addresses per call).
3. Call `migrate` for each page.
4. Confirm `get_schema_version() == 3` before accepting new subscription writes.

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- get_subscriber_page --offset 0 --limit 50

soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- migrate --users '["<USER_ADDRESS>"]'

soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_schema_version
```

Optional helper: [`scripts/migrate-contract.ts`](../scripts/migrate-contract.ts) (`npx tsx scripts/migrate-contract.ts [--dry-run]`), using `VITE_CONTRACT_ID` / `VITE_RPC_URL` / `VITE_NETWORK_PASSPHRASE`. Prefer the CLI invokes above unless you have validated that script in your environment.

If subscription writes fail with **error 42**, follow [SchemaMigrationRequired (error 42)](#schemamigrationrequired-error-42) — do not treat it as a random subscribe bug.

### Migration History

| Version | Changes                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| v1      | Initial schema (`Subscription` without `paused`)                                         |
| v2      | Adds `paused`; writes `SchemaVersion`                                                    |
| v3      | Backfills `referrer` from `DataKey::Referral` (`CURRENT_VERSION`)                        |

---

## SchemaMigrationRequired (error 42)

Canonical operator note for the schema-version **write-denial** safety rail. Error-code lookup: [`ERROR-CODES.md` — 42](ERROR-CODES.md#42--schemamigrationrequired).

### Invariant

After a WASM upgrade, on-chain code knows the current `Subscription` shape (`CURRENT_VERSION` = 3), but unmigrated slots may still hold v1/v2 blobs. The intended rail is: **refuse new subscription-blob writes until `get_schema_version() == CURRENT_VERSION`**, so operators paging through `migrate()` never mix freshly written current-version blobs with stale ones.

This is the comment on `migration::require_current_version` in [`contract/src/migration.rs`](../contract/src/migration.rs):

> Invariant guard: panics with `ContractError::SchemaMigrationRequired` when `schema_version < CURRENT_VERSION`. Call this at the top of any entrypoint that writes new subscription blobs (e.g. `subscribe_inner`) so that mixed-version storage can never be created after a WASM upgrade.

`require_current_version` panics with **code 42** when `get_schema_version() < 3`. The helper is the source of the typed error. Intended write surfaces are **`subscribe` / `subscribe_with_metadata`** (they share `subscribe_inner`). `migrate` does **not** call this guard.

### How to recognize it

- User or integrator `subscribe` / `subscribe_with_metadata` panics with `SchemaMigrationRequired` / Soroban error **42** (GitHub issue discussions may call this “#42”).
- `get_schema_version` returns `0`, `1`, or `2` (unset defaults to **0**).
- `contract_health_check` / `get_protocol_stats` report a `schema_version` below 3.

This is **intentional**, not a keeper or wallet defect.

### Remedy (order)

1. Confirm version: `get_schema_version` (and optional `contract_health_check`).
2. Keep **admin** access — you still need it for `migrate`.
3. Run the [paged `migrate(users)` procedure](#state-migration) until `get_schema_version() == 3`.
4. Retry the subscription write.

Do not redeploy a new contract ID solely because of 42. Do not skip paging on a large `SubscriberIndex`.

### Admin paths while the rail is active

`require_current_version` is not applied to administrative entrypoints. While schema is stale, operators can still:

| Still available (not gated by 42) | Role |
| --------------------------------- | ---- |
| `migrate(users)`                  | The catch-up entrypoint (admin) |
| `propose_upgrade` / `commit_upgrade` / `cancel_pending_upgrade` | WASM ceremony |
| `pause_contract` / `unpause_contract` | Incident control |
| Whitelist / freeze / fee propose-commit | Merchant and fee admin |
| `get_schema_version`, `get_subscriber_page`, `contract_health_check`, `get_protocol_stats` | Reads |

Keepers charging **existing** subscriptions are a separate path: they do not go through `require_current_version`. After a layout-changing upgrade, still migrate before relying on new fields (`paused`, `referrer`).
There is also [`scripts/migrate-contract.ts`](../scripts/migrate-contract.ts) (`npx tsx scripts/migrate-contract.ts [--dry-run]`), which reads `VITE_CONTRACT_ID` / `VITE_RPC_URL` / `VITE_NETWORK_PASSPHRASE`. Prefer the CLI invoke above unless you have validated that script against your environment.

### Migration History

| Version | Changes                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| v1      | Initial schema (`Subscription` without `paused`)                                                |
| v2      | Adds `paused`; writes `SchemaVersion`                                                           |
| v3      | Backfills `referrer` from `DataKey::Referral` onto each subscription (`CURRENT_VERSION`)        |

---

## Contract Upgrade (WASM)

Production upgrades are **two-step**: `propose_upgrade` then `commit_upgrade`. Direct `upgrade()` exists only under `#[cfg(test)]`. Full ceremony: [`operations/two_step_admin_playbooks.md`](operations/two_step_admin_playbooks.md).

### Pre-upgrade health gate

[`scripts/pre-upgrade-check.ts`](../scripts/pre-upgrade-check.ts) is a standalone preflight (schema version, optional WASM path, admin, `get_active_count`, `get_fee`, simulated `migrate`). From the repository root:

```bash
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/pre-upgrade-check.ts
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/pre-upgrade-check.ts --wasm contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
```

From `scripts/`: `npm run pre-upgrade-check` → `tsx pre-upgrade-check.ts`.

Optional snapshot/diff:

```bash
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/subscription-snapshot.ts --file addresses.txt --out before.json
# … upgrade …
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/subscription-snapshot.ts --file addresses.txt --out after.json
npx tsx scripts/snapshot-diff.ts before.json after.json
```

### Upload and two-step swap

```bash
# 1. Upload new WASM (record the hash)
soroban contract upload \
  --source admin \
  --network testnet \
  --wasm contract/target/wasm32-unknown-unknown/release/flow_pay.wasm

# 2. Propose
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- propose_upgrade --new_wasm_hash <NEW_WASM_HASH>

# 3. Verify pending hash
soroban contract invoke --id <CONTRACT_ID> --network testnet -- get_pending_upgrade

# 3. Run paged migration if storage layout changed (see State Migration)
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network <NETWORK> \
  -- migrate --users '["<USER_ADDRESS>"]'
# 4. Commit (admin; irreversible WASM swap)
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- commit_upgrade

# 5. Page migrate if storage layout changed (see State Migration)
```

An `upg_proposed` event is emitted on propose; `upgraded` on commit.

---

## Rollback Procedure

FlowPay does not support automatic rollback. To revert to a previous WASM, run the same two-step upgrade with the **previous** WASM hash (retrieve it from the last `upgraded` event, indexer DB, or a retained artifact):

1. **Retrieve the previous WASM hash** from the `upgraded` event emitted at the time of the last deployment (use `soroban events` or your indexer DB).
2. **Re-upload the previous WASM** if needed (if the hash is still on-chain, skip this step):
   ```bash
   soroban contract upload --source deployer --network <NETWORK> --wasm <previous.wasm>
   ```
3. **Upgrade back to the previous hash**:
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --source deployer \
     --network <NETWORK> \
     -- upgrade <PREVIOUS_WASM_HASH>
   ```
4. **Run migration** if the restored WASM still requires schema catch-up (paged `migrate(users)` — [State Migration](#state-migration)):
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --source admin --network <NETWORK> -- migrate --users '["<USER_ADDRESS>"]'
1. **Re-upload the previous WASM** if the hash is no longer on-chain:
   ```bash
   soroban contract upload --source admin --network testnet --wasm <previous.wasm>
   ```
2. **Propose** the previous hash, verify `get_pending_upgrade`, then **commit**.
3. **Run `migrate`** only if the restored WASM still requires schema catch-up for current storage.
4. **Verify** with `contract_health_check` and `CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/health-check.ts --deep`.

To abort a bad proposal **before** commit:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- cancel_pending_upgrade
```

> Note: Storage written by the newer WASM remains on-chain. If the rollback WASM reads keys introduced by the newer version, those reads will return `None` or the default value — existing subscription data is unaffected unless you also migrate/reshape it.

---

## Frontend Environment Variables

| Variable                  | Required | Default                               | Description                |
| ------------------------- | -------- | ------------------------------------- | -------------------------- |
| `VITE_CONTRACT_ID`        | Yes      | `""`                                  | Deployed contract ID       |
| `VITE_RPC_URL`            | No       | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint       |
| `VITE_NETWORK_PASSPHRASE` | No       | Testnet passphrase                    | Stellar network passphrase |

Source: [`frontend/.env.example`](../frontend/.env.example).

---

## Related operations

- Keeper bot setup and cadence: [`docs/KEEPER.md`](KEEPER.md)
- Advanced keeper scenarios (DLQ replay, multi-instance locks, RPC failover, incident pause): [`docs/operations/keeper_runbook.md`](operations/keeper_runbook.md)
- Two-step upgrade and fee ceremonies: [`docs/operations/two_step_admin_playbooks.md`](operations/two_step_admin_playbooks.md)
- Script catalog: [`scripts/README.md`](../scripts/README.md)
