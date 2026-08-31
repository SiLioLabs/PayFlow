# Mainnet Deployment Checklist

FlowPay is **currently deployed on Testnet only**. Use this checklist when the protocol is ready for Public Global Stellar Network (Mainnet) after a formal security audit.

For day-to-day Testnet steps, see [`DEPLOYMENT.md`](DEPLOYMENT.md). For audit gates, see [`security/audit-preparation.md`](security/audit-preparation.md), [`SECURITY.md`](SECURITY.md), and the repository [`SECURITY.md`](../SECURITY.md).

This document does **not** authorize a Mainnet deployment. Do not deploy or deposit real funds until every gate below is complete.

---

## Audit gate (mandatory — do not skip)

The repository security policy is explicit:

> PayFlow is currently deployed on Testnet only and has not been formally audited.
>
> Do not use on Mainnet with real funds until an independent security audit is completed.
>
> — [`SECURITY.md`](../SECURITY.md)

[`docs/SECURITY.md`](SECURITY.md) repeats that FlowPay has not been formally audited and requires remediating findings, re-testing, and publishing the report (or summary) **before Mainnet**.

**Do not deploy a Mainnet instance, and do not deposit or route real funds, until:**

- [ ] An independent Soroban-focused security audit is complete
- [ ] Findings remediations are merged
- [ ] The report (or summary) is published or accepted by maintainers
- [ ] The audited WASM hash matches the release artifact

There is no in-repo override that weakens this requirement.

---

## Phase 0 — Security gates

> Real funds must not flow through an unaudited Mainnet deployment.

- [ ] **Independent security audit complete** — see [Audit gate](#audit-gate-mandatory--do-not-skip). _Why:_ Mainnet holds user allowances and merchant revenue.
- [ ] **Audit WASM hash matches release artifact** — SHA256 of the release WASM (`flow_pay.wasm` per [`deployments/config.json`](../deployments/config.json)) recorded in release notes. _Why:_ prevents deploying an unaudited binary.
- [ ] **Key management plan approved**
  - [ ] Admin key on a **hardware wallet** (or equivalent HSM)
  - [ ] Prefer **multisig / multi-party** admin (Stellar multisig thresholds) over a single hot key
  - [ ] Deployer key separate from long-term admin key where possible
  - [ ] Keeper keys are hot keys with **limited XLM** and no admin rights
        _Why:_ admin compromise can pause, freeze merchants, change fees, or commit an upgrade.
- [ ] **Emergency runbook rehearsed** — who can call `pause_contract()`, who to page, how to unpause. _Why:_ reduces incident MTTR. There is **no automatic rollback**.
- [ ] **Fee governance configured** — intended `bps` and fee collector (not the contract address). Two-step `propose_fee` / `commit_fee` understood. Fee **bounds** configured and verified (see [Fee bounds](#1-fee-bounds)).
- [ ] **Volume cap verified** — see [Volume cap](#2-volume-cap).
- [ ] **Health gates understood** — on-chain `contract_health_check` plus the shallow `scripts/health-check.ts` script (see [Health](#3-health)).

---

## 1. Fee bounds

Configured fee bounds are admin-set guardrails on future protocol-fee commits. They must be verified **before any Mainnet funds** (user allowances or merchant revenue) are allowed into the contract.

| Method                                       | Auth                    | Role                                                         |
| -------------------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `set_fee_bounds(min_bps: u32, max_bps: u32)` | admin (`require_admin`) | Writes instance keys `MinFeeBps` / `MaxFeeBps`               |
| `get_fee_bounds() -> (u32, u32)`             | none                    | Returns configured bounds; defaults to `(0, 10000)` if unset |

**Semantics (from `contract/src/lib.rs` and `contract/src/fee.rs`):**

- `set_fee_bounds` panics with `InvalidFeeBounds` (34) if `min_bps > max_bps` or `max_bps > 10_000`.
- `propose_fee` does **not** check these bounds; it only rejects `bps > 10_000` (`InvalidFeeBps`, 13) and an invalid collector (`InvalidFeeCollector`, 26).
- `commit_fee` re-validates the pending bps against `[min_bps, max_bps]` and panics with `FeeOutOfBoundsAtCommit` (35) if the pending value is outside the range.

**Pre-deposit checks:**

```bash
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_fee_bounds
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_fee
```

- [ ] `get_fee_bounds` returns the intended `(min_bps, max_bps)` for Mainnet (not an accidental default of `0`–`10000` unless that is the approved policy)
- [ ] Current `get_fee` collector and bps sit inside those bounds
- [ ] Operators understand that tightening bounds after `propose_fee` will block `commit_fee`

API reference: [`API.md` — `set_fee_bounds` / `get_fee_bounds`](API.md#set_fee_bounds).

---

## 2. Volume cap

The protocol enforces a **global hourly volume cap** so a burst of charges cannot move unbounded value in a single window. The compile-time default is:

```text
GLOBAL_MAX_VOLUME_PER_HOUR = 50_000_000_000_000  // 50 trillion stroops
HOUR_IN_SECONDS            = 3600
```

| Method                                      | Auth  | Role                                                                                    |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| `get_global_volume_cap() -> i128`           | none  | Effective cap: instance override `GlobalVolumeCapOverride`, or the compile-time default |
| `get_global_volume_window() -> (i128, u64)` | none  | `(accumulated_volume, window_start_timestamp)`; `(0, 0)` if no window yet               |
| `set_global_volume_cap(new_cap: i128)`      | admin | Stores a positive override; panics `InvalidVolumeCap` (33) if `new_cap <= 0`            |

**Operational purpose:** limit protocol-wide transfer volume per rolling hour. Exceeding the cap during charge accounting panics with `GlobalVolumeExceeded` (28).

**Enforcement note (do not assume the override is live in the charge path):** `check_and_update_global_volume` currently compares accumulated volume against the compile-time `GLOBAL_MAX_VOLUME_PER_HOUR` constant, not against `get_global_volume_cap()`. `get_contract_config` also reports the constant. Treat `set_global_volume_cap` as stored operator intent and a health-report input (`HealthReport.global_volume_utilization_pct` uses the override when present). The charge-time ceiling that actually panics is still `GLOBAL_MAX_VOLUME_PER_HOUR` until that path is wired to the override.

**Pre-deposit checks:**

```bash
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_global_volume_cap
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_global_volume_window
```

- [ ] Recorded cap matches the approved Mainnet risk limit
- [ ] Window accumulation is as expected for a fresh or recently migrated instance
- [ ] Operators know `GlobalVolumeExceeded` is a protocol-wide halt on further charges in that hour

---

## 3. Health

A Mainnet deployment is **healthy** only when both the on-chain snapshot and the off-chain responsiveness check succeed.

### On-chain: `contract_health_check` → `HealthReport`

There is **no** exported `health_check` or `get_health` method. The public ABI name is `contract_health_check`. Auth: none. No storage writes.

`is_healthy` is true when **all** of the following hold (`contract/src/lib.rs`):

- `contract_paused` is false
- `token_configured` is true
- `admin_configured` is true
- `instance_ttl_ledgers > 17_280` (~1 day at ~5 s/ledger)

On-chain, `instance_ttl_ledgers` is a **hardcoded 100_000** estimate (`get_ttl()` is not available outside test builds). Do not treat it as a precise remaining-TTL reading.

```bash
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- contract_health_check
```

Also confirm:

```bash
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_protocol_stats
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_schema_version
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- is_contract_paused
```

Fields and interpretation: [`API.md` — `HealthReport`](API.md#healthreport).

### Off-chain: `scripts/health-check.ts` (shallow)

This script simulates `get_schema_version` and `get_active_count`. It does **not** call `contract_health_check` and has **no** `--deep` mode.

```bash
cd scripts
CONTRACT_ID=<CONTRACT_ID> npx tsx health-check.ts
# exit 0 = both calls returned valid responses; exit 1 = unhealthy
```

Env: `CONTRACT_ID` (required; `VITE_CONTRACT_ID` accepted), `RPC_URL` / `VITE_RPC_URL`, `NETWORK=mainnet` to select `Networks.PUBLIC`.

- [ ] `contract_health_check` reports `is_healthy: true`, token + admin configured, not paused
- [ ] `scripts/health-check.ts` exits 0 against the Mainnet contract ID and Mainnet RPC
- [ ] Schema version matches the release notes / [`DEPLOYMENT.md` migration history](DEPLOYMENT.md#migration-history)

---

## 4. Pre-upgrade controls

Run these **before** proposing a WASM swap on Mainnet. They are separate scripts; they are not wired together automatically.

### `scripts/pre-upgrade-check.ts`

```bash
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/pre-upgrade-check.ts
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/pre-upgrade-check.ts --wasm ./contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/pre-upgrade-check.ts --skip-key-check --upgrade-config ./upgrade-config.json
```

From `scripts/`: `npm run pre-upgrade-check` → `tsx pre-upgrade-check.ts`.

Checks include: `get_schema_version`, optional expected schema from upgrade-config, optional WASM magic/size/hash prefix, `get_admin` plus optional `ADMIN_SECRET_KEY` sign test, `get_active_count` (warns if > 0), `get_fee`, and a dry-run simulate of `migrate`. Exit 1 on blocking failures.

Env: `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `ADMIN_SECRET_KEY`, `UPGRADE_CONFIG_PATH`.

### Snapshot then diff

```bash
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/subscription-snapshot.ts --file addresses.txt --out before.json
# … upgrade or config change …
CONTRACT_ID=<CONTRACT_ID> npx tsx scripts/subscription-snapshot.ts --file addresses.txt --out after.json
npx tsx scripts/snapshot-diff.ts before.json after.json
# exit 0 = no differences; exit 1 = differences; exit 2 = usage/file errors
```

`snapshot-diff.ts` compares `active`, `paused`, `amount`, `interval`, `merchant`, `token`. There is no npm script alias for snapshot-diff.

- [ ] `pre-upgrade-check` exits 0 on the candidate WASM
- [ ] Before/after snapshots retained; `snapshot-diff` reviewed if an upgrade is in the same change window

### `ALLOW_MAINNET` and network authorization

**This repository does not implement an `ALLOW_MAINNET` environment variable or deploy-time guard.** Network selection is a manual operator control:

- Soroban CLI `--network mainnet`
- `scripts/health-check.ts`: `NETWORK=mainnet` selects `Networks.PUBLIC`
- `deployments/config.json` `network` / `networkPassphrase` / `rpcUrl` (the checked-in example is **testnet**)
- `NETWORK_PASSPHRASE` / `VITE_NETWORK_PASSPHRASE` for scripts and frontend

Absence of a flag is **not** authorization to use real funds. Confirm passphrase, RPC, SAC, and contract ID are Mainnet **before** any signed invoke.

---

## Phase 1 — Pre-deploy

- [ ] **Tag the release** — `git tag mainnet-vX.Y.Z <commit>` and push tags.
- [ ] **Build release WASM**

```bash
cd contract
cargo build --release --target wasm32-unknown-unknown
```

Expected artifact path used by [`deployments/config.json`](../deployments/config.json) and `scripts/deploy-pipeline.ts`:

```text
contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
```

- [ ] **Record WASM hash**

```bash
sha256sum contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
# Windows PowerShell:
Get-FileHash contract\target\wasm32-unknown-unknown\release\flow_pay.wasm -Algorithm SHA256
```

- [ ] **Schema version check** — confirm `get_schema_version` expectations match [`DEPLOYMENT.md`](DEPLOYMENT.md#migration-history).
- [ ] **Testnet smoke test on the same commit**
  - [ ] Deploy/upgrade testnet with this WASM
  - [ ] `subscribe` → wait/advance interval → `charge` / keeper `batch_charge`
  - [ ] `pause` / `pause_until` / `resume`, merchant withdraw (if applicable)
  - [ ] `CONTRACT_ID=<TESTNET_CONTRACT_ID> npx tsx scripts/health-check.ts` exits 0
  - [ ] `soroban contract invoke ... -- contract_health_check` is healthy
- [ ] **Mainnet SAC address confirmed** — use the Mainnet Stellar Asset Contract for the chosen asset (not Testnet SAC).
- [ ] **RPC / horizon endpoints selected** — primary + backup Mainnet Soroban RPC.
- [ ] **Funding** — deployer and keeper accounts funded with Mainnet XLM for fees.

---

## Phase 2 — Deploy

> Prefer `scripts/deploy-pipeline.ts` when you intend a scripted deploy. There is **no** `scripts/deploy.sh` in this repository. The pipeline reads [`deployments/config.json`](../deployments/config.json); the checked-in file is **testnet**. Do not point it at Mainnet until the [audit gate](#audit-gate-mandatory--do-not-skip) is complete.

### Option A — Deploy pipeline

```bash
# Dry-run first (no live deploy)
npx tsx scripts/deploy-pipeline.ts --dry-run

# Live deploy requires DEPLOYER_SECRET_KEY and ADMIN_SECRET_KEY.
# Use a Mainnet-specific deployments/config.json (network, passphrase, RPC, SAC, wasmPath).
npx tsx scripts/deploy-pipeline.ts
```

The pipeline builds WASM, runs `stellar contract deploy`, `initialize`, verifies via `contract_health_check` (`admin_configured` + `token_configured`), then `propose_fee` / `commit_fee` and `whitelist_batch_add` when configured. It does **not** set fee bounds or volume cap, and it has **no** `ALLOW_MAINNET` gate.

Save the printed **contract ID**.

### Option B — Manual Soroban CLI

```bash
# 1) Upload WASM
soroban contract upload \
  --source <DEPLOYER> \
  --network mainnet \
  --wasm contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
# Expected: prints WASM hash (hex)

# 2) Deploy instance
soroban contract deploy \
  --source <DEPLOYER> \
  --network mainnet \
  --wasm-hash <WASM_HASH>
# Expected: prints CONTRACT_ID (C...)

# 3) Initialize once
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <DEPLOYER> \
  --network mainnet \
  -- initialize \
  --token <MAINNET_SAC_ADDRESS> \
  --admin <ADMIN_ADDRESS>
# Expected: success; subsequent initialize must fail with AlreadyInitialized (1)
```

- [ ] WASM upload succeeded; hash matches Phase 1 record
- [ ] Contract ID recorded in password manager / ops vault
- [ ] `initialize` succeeded exactly once
- [ ] Admin address is the intended hardware/multisig account
- [ ] `set_fee_bounds` applied with the approved range
- [ ] Volume cap recorded (`get_global_volume_cap`); `set_global_volume_cap` only if policy requires an override

### Optional: migrate

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <DEPLOYER> \
  --network mainnet \
  -- migrate
```

- [ ] `migrate` run if this WASM introduces schema changes; safe no-op otherwise

---

## Phase 3 — Post-deploy verification

There is **no** `scripts/verify-contract.sh`. Verify with the health APIs and admin reads:

```bash
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- contract_health_check
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_protocol_stats
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_schema_version
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_fee_bounds
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_global_volume_cap

cd scripts
CONTRACT_ID=<CONTRACT_ID> NETWORK=mainnet npx tsx health-check.ts
```

- [ ] Health check passes (`is_healthy` true; script exit 0)
- [ ] Token and admin configured (non-empty)
- [ ] Schema version matches release
- [ ] Fee bounds and volume cap match the approved policy
- [ ] **First-subscriber smoke test** (small amount, still after audit approval)
  1. Approve SAC allowance to the contract
  2. `subscribe` with a short-but-valid interval
  3. Trigger `charge` after interval (or keeper page)
  4. Confirm token balances / events
- [ ] **Monitoring live**
  - [ ] Keeper + indexer + metrics readiness ([`scripts/README.md`](../scripts/README.md), [`KEEPER.md`](KEEPER.md))
  - [ ] RPC error-rate alerts
  - [ ] Pause / anomaly alerts for ops

---

## Phase 4 — Go-live

### Frontend / clients

Update production env (example — placeholders only):

```bash
VITE_CONTRACT_ID=<MAINNET_CONTRACT_ID>
VITE_RPC_URL=https://soroban-mainnet.stellar.org
VITE_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

- [ ] Production frontend env updated and redeployed
- [ ] Wallet network prompts show **Mainnet** (not Testnet)
- [ ] Feature flags / maintenance banner cleared

### DNS / CDN

- [ ] Production DNS records point at the go-live frontend
- [ ] CDN/cache purged after env deploy
- [ ] TLS certificates valid
- [ ] Status page / uptime check pointed at production URL

### Public announcement checklist

- [ ] Contract ID + WASM hash published
- [ ] Audit report link published
- [ ] Known limitations summarized ([`SECURITY.md`](SECURITY.md))
- [ ] Support / disclosure channel listed (`security@payflow.dev`)
- [ ] Keeper operators notified of Mainnet contract ID and cadence

---

## Rollback / upgrade

> **Operator playbooks:** Step-by-step timing budgets, verification reads, and abort paths for upgrade and fee rotation ceremonies are in [`operations/two_step_admin_playbooks.md`](operations/two_step_admin_playbooks.md).

FlowPay does **not** auto-rollback. Production WASM replacement is the two-step admin flow in [`contract/src/upgrade.rs`](../contract/src/upgrade.rs):

1. `propose_upgrade(new_wasm_hash)` — admin; stores `PendingUpgrade` in temporary storage (TTL 17,280 ledgers).
2. Independently verify the pending hash (`get_pending_upgrade`) against a reproducible build.
3. `commit_upgrade()` — admin; calls `update_current_contract_wasm`. Panics `NoPendingProposal` (23) if nothing is pending.
4. Optional: `cancel_pending_upgrade()` — admin; drops the pending hash without swapping WASM.

CLI (also in [`architecture/two-step-auth.md`](architecture/two-step-auth.md)):

```bash
soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network mainnet -- \
  propose_upgrade --new_wasm_hash <WASM_HASH>

soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network mainnet -- \
  get_pending_upgrade

soroban contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> --network mainnet -- \
  commit_upgrade
```

The single-step `upgrade` entrypoint exists **only under `#[cfg(test)]`**. Do not treat [`DEPLOYMENT.md` Rollback Procedure](DEPLOYMENT.md#rollback-procedure) `upgrade <PREVIOUS_WASM_HASH>` as the production ABI.

**Emergency recovery:**

1. Admin: `pause_contract()` immediately.
2. Restore a prior WASM via `propose_upgrade` / `commit_upgrade` (previous hash from the `upgraded` event or your release notes).
3. Re-run `contract_health_check` and `scripts/health-check.ts` before `unpause_contract()`.

Further recovery guidance: [`DEPLOYMENT.md`](DEPLOYMENT.md#rollback-procedure) (storage caveat: newer keys remain on-chain), [`ERROR-CODES.md`](ERROR-CODES.md), [`operations/keeper_runbook.md`](operations/keeper_runbook.md).

---

## Final pre-deposit checklist

Do not deposit or route real Mainnet funds until every item is checked.

- [ ] **Audit approval** — independent audit complete; remediations merged; report published ([`SECURITY.md`](../SECURITY.md))
- [ ] **Correct network** — CLI `--network mainnet`, passphrase `Public Global Stellar Network ; September 2015`, Mainnet RPC, Mainnet SAC, Mainnet contract ID (no `ALLOW_MAINNET` flag exists; confirm manually)
- [ ] **Fee bounds** — `get_fee_bounds` matches policy; current `get_fee` is inside bounds
- [ ] **Volume cap** — `get_global_volume_cap` / `get_global_volume_window` recorded; operators understand compile-time enforcement of `GLOBAL_MAX_VOLUME_PER_HOUR`
- [ ] **Contract health** — `contract_health_check` `is_healthy`; `scripts/health-check.ts` exit 0; not paused; token + admin set
- [ ] **Configuration / snapshot verification** — schema version matches release; subscription snapshot retained if migrating or upgrading
- [ ] **Upgrade safety checks** — `pre-upgrade-check` if a WASM swap is planned; propose/commit understood; no assumption of automatic rollback
- [ ] **Mainnet authorization controls** — admin/deployer keys as planned; deployer secret not reused as long-term admin; config.json not left on testnet values
- [ ] **Monitoring / keeper / indexer readiness** — keeper funded and running with `CONTRACT_ID`, `KEEPER_PUBLIC_KEY`, and live `KEEPER_SECRET`; indexer `events.db` persistence planned; metrics/Grafana optional but RPC and pause alerts live ([`scripts/README.md`](../scripts/README.md))

---

## Related

- Testnet & general deploy: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
- Audit preparation: [`docs/security/audit-preparation.md`](security/audit-preparation.md)
- Repository security policy: [`SECURITY.md`](../SECURITY.md)
- Two-step upgrade: [`docs/architecture/two-step-auth.md`](architecture/two-step-auth.md)
- Contract API: [`docs/API.md`](API.md)
- Keeper operations: [`docs/KEEPER.md`](KEEPER.md)
- Scripts ops (keeper / indexer / metrics / Compose): [`scripts/README.md`](../scripts/README.md)
- Error recovery: [`docs/ERROR-CODES.md`](ERROR-CODES.md)
