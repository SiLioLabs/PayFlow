# Deployment Guide

Covers building the FlowPay contract, deploying to Testnet and Mainnet using the provided scripts, post-deployment verification, and rollback procedures.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.70+ | `curl https://sh.rustup.rs -sSf \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | 21.x | `cargo install --locked soroban-cli` |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Freighter Wallet | — | [freighter.app](https://www.freighter.app/) |

Verify your setup:

```bash
rustc --version    # 1.70+
soroban --version  # 21.x
node --version     # v18+
```

---

## Build

```bash
cd contract
cargo build --release --target wasm32-unknown-unknown
```

The compiled WASM is written to `target/wasm32-unknown-unknown/release/flow_pay.wasm`.

---

## Testnet Deployment

Use `scripts/deploy.sh` to deploy to Testnet:

```bash
bash scripts/deploy.sh --network testnet --source <DEPLOYER_KEYPAIR> --token <SAC_ADDRESS>
```

The script:
1. Uploads the WASM and obtains a hash.
2. Deploys the contract and captures the contract ID.
3. Calls `initialize(token, admin)` with the provided SAC address.
4. Prints the contract ID — save it for subsequent steps.

Set the returned contract ID in `frontend/.env`:

```bash
VITE_CONTRACT_ID=<CONTRACT_ID>
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

---

## Mainnet Deployment

> **Warning:** FlowPay has not been formally audited. Do not manage real funds on Mainnet until an independent security audit is complete.

```bash
bash scripts/deploy.sh --network mainnet --source <DEPLOYER_KEYPAIR> --token <SAC_ADDRESS>
```

Set the returned contract ID in `frontend/.env`:

```bash
VITE_CONTRACT_ID=<CONTRACT_ID>
VITE_RPC_URL=https://soroban-mainnet.stellar.org
VITE_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

---

## Post-Deployment Verification

After deploying, run the post-deployment check script:

```bash
bash scripts/verify-contract.sh --network <testnet|mainnet> --id <CONTRACT_ID>
```

The script calls the following read functions and asserts expected values:

| Check | Expected |
|-------|----------|
| `get_schema_version` | Latest version |
| `get_health` | `is_healthy: true` |
| Token configured | Non-empty address |
| Admin configured | Non-empty address |

You can also run these manually:

```bash
soroban contract invoke --id <CONTRACT_ID> --network <NETWORK> -- health_check
soroban contract invoke --id <CONTRACT_ID> --network <NETWORK> -- get_protocol_stats
```

---

## State Migration

When upgrading to a new WASM that introduces storage layout changes, call `migrate()` once after deployment:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network <NETWORK> \
  -- migrate
```

Subsequent calls are safe no-ops. See [Migration History](#migration-history) below.

### Migration History

| Version | Changes |
|---------|---------|
| v1 | Initial schema |
| v2 | Added `SchemaVersion`, `Referral`, `SubscriptionMeta`, `ChargeHistory` keys |

---

## Contract Upgrade (WASM)

```bash
# 1. Upload new WASM
soroban contract upload \
  --source deployer \
  --network <NETWORK> \
  --wasm target/wasm32-unknown-unknown/release/flow_pay.wasm

# 2. Upgrade the deployed contract
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network <NETWORK> \
  -- upgrade <NEW_WASM_HASH>

# 3. Run migration if storage layout changed
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network <NETWORK> \
  -- migrate
```

An `upgraded` event is emitted on success.

---

## Rollback Procedure

FlowPay does not support automatic rollback. To revert to a previous WASM:

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
4. **Run migration** if the previous version had a lower schema version:
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --source deployer --network <NETWORK> -- migrate
   ```
5. **Verify** the rollback using `verify-contract.sh`.

> Note: Storage written by the newer WASM version remains on-chain. If the rollback WASM reads keys introduced by the newer version, those reads will return `None` or the default value — existing subscription data is unaffected.

---

## Frontend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_CONTRACT_ID` | Yes | `""` | Deployed contract ID |
| `VITE_RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `VITE_NETWORK_PASSPHRASE` | No | `Networks.TESTNET` | Stellar network passphrase |
