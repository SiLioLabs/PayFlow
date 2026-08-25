# Mainnet Deployment Checklist

FlowPay is **currently deployed on Testnet only**. Use this checklist when the protocol is ready for Public Global Stellar Network (Mainnet) after a formal security audit.

For day-to-day Testnet steps, see [`DEPLOYMENT.md`](DEPLOYMENT.md). For audit gates, see [`security/audit-preparation.md`](security/audit-preparation.md) and [`SECURITY.md`](SECURITY.md).

---

## Phase 0 — Security gates (do not skip)

> Real funds must not flow through an unaudited Mainnet deployment.

- [ ] **Independent security audit complete** — findings remediations merged; report (or summary) published or accepted by maintainers. _Why:_ Mainnet holds user allowances and merchant revenue.
- [ ] **Audit WASM hash matches release artifact** — SHA256 of `flow_pay.wasm` recorded in release notes. _Why:_ prevents deploying an unaudited binary.
- [ ] **Key management plan approved**
  - [ ] Admin key on a **hardware wallet** (or equivalent HSM)
  - [ ] Prefer **multisig / multi-party** admin (Stellar multisig thresholds) over a single hot key
  - [ ] Deployer key separate from long-term admin key where possible
  - [ ] Keeper keys are hot keys with **limited XLM** and no admin rights  
        _Why:_ admin compromise can pause, freeze merchants, or change fees.
- [ ] **Emergency runbook rehearsed** — who can call `pause_contract()`, who to page, how to unpause. _Why:_ reduces incident MTTR.
- [ ] **Fee governance configured** — intended `bps` and fee collector (not the contract address). Two-step propose/commit understood. _Why:_ fee mistakes are costly on Mainnet.

---

## Phase 1 — Pre-deploy

- [ ] **Tag the release** — `git tag mainnet-vX.Y.Z <commit>` and push tags.
- [ ] **Build release WASM**

```bash
cd contract
cargo build --release --target wasm32-unknown-unknown
```

Expected artifact:

```text
target/wasm32-unknown-unknown/release/flow_pay.wasm
```

- [ ] **Record WASM hash**

```bash
sha256sum target/wasm32-unknown-unknown/release/flow_pay.wasm
# Windows PowerShell:
Get-FileHash target\wasm32-unknown-unknown\release\flow_pay.wasm -Algorithm SHA256
```

- [ ] **Schema version check** — confirm `get_schema_version` expectations match docs migration table in [`DEPLOYMENT.md`](DEPLOYMENT.md#migration-history).
- [ ] **Testnet smoke test on the same commit**
  - [ ] Deploy/upgrade testnet with this WASM
  - [ ] `subscribe` → wait/advance interval → `charge` / keeper `batch_charge`
  - [ ] `pause` / `resume`, merchant withdraw (if applicable)
  - [ ] `scripts/verify-contract.sh --network testnet --id <TESTNET_CONTRACT_ID>` passes
- [ ] **Mainnet SAC address confirmed** — use the Mainnet Stellar Asset Contract for the chosen asset (not Testnet SAC).
- [ ] **RPC / horizon endpoints selected** — primary + backup Mainnet Soroban RPC.
- [ ] **Funding** — deployer and keeper accounts funded with Mainnet XLM for fees.

---

## Phase 2 — Deploy

> Prefer `scripts/deploy.sh` when available; otherwise use Soroban CLI equivalents below.

### Option A — Script

```bash
bash scripts/deploy.sh --network mainnet --source <DEPLOYER_KEYPAIR> --token <MAINNET_SAC_ADDRESS>
```

Save the printed **contract ID**.

### Option B — Manual Soroban CLI

```bash
# 1) Upload WASM
soroban contract upload \
  --source <DEPLOYER> \
  --network mainnet \
  --wasm target/wasm32-unknown-unknown/release/flow_pay.wasm
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

```bash
bash scripts/verify-contract.sh --network mainnet --id <CONTRACT_ID>
```

Manual checks:

```bash
soroban contract invoke --id <CONTRACT_ID> --network mainnet -- health_check
# Expected: healthy / is_healthy true (per contract ABI)

soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_protocol_stats
# Expected: readable stats; no panic

soroban contract invoke --id <CONTRACT_ID> --network mainnet -- get_schema_version
# Expected: version matching release notes
```

- [ ] Health check passes
- [ ] Token and admin configured (non-empty)
- [ ] Schema version matches release
- [ ] **First-subscriber smoke test** (small amount)
  1. Approve SAC allowance to the contract
  2. `subscribe` with a short-but-valid interval
  3. Trigger `charge` after interval (or keeper page)
  4. Confirm token balances / events
- [ ] **Monitoring live**
  - [ ] Keeper metrics + balance alerts ([`KEEPER.md`](KEEPER.md))
  - [ ] RPC error-rate alerts
  - [ ] Pause / anomaly alerts for ops

---

## Phase 4 — Go-live

### Frontend / clients

Update production env (example):

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

## Rollback (emergency)

FlowPay does not auto-rollback. If a critical issue appears:

1. Admin: `pause_contract()` immediately.
2. Follow [`DEPLOYMENT.md` Rollback Procedure](DEPLOYMENT.md#rollback-procedure) to restore a prior WASM hash if required.
3. Re-run `verify-contract.sh` and keeper health checks before `unpause_contract()`.

---

## Related

- Testnet & general deploy: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
- Audit preparation: [`docs/security/audit-preparation.md`](security/audit-preparation.md)
- Keeper operations: [`docs/KEEPER.md`](KEEPER.md)
- Error recovery: [`docs/ERROR-CODES.md`](ERROR-CODES.md)
