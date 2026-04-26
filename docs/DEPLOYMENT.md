# Deployment Guide

This guide covers everything from building the contract to running it on Testnet and eventually Mainnet, including setting up a keeper service to trigger recurring charges.

---

## Prerequisites

| Tool | Install |
| --- | --- |
| Rust 1.70+ | `curl https://sh.rustup.rs -sSf \| sh` |
| wasm32 target | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | `cargo install --locked soroban-cli` |
| Node.js 18+ | [nodejs.org](https://nodejs.org/) |
| Freighter Wallet | [freighter.app](https://www.freighter.app/) |

Verify your setup:

```bash
rustc --version        # rustc 1.70+
soroban --version      # soroban 21.x
node --version         # v18+

```

---

## State Migration

FlowPay uses a `SchemaVersion` key in instance storage to track the storage schema version. When upgrading the contract WASM to a new version that introduces storage layout changes, call `migrate()` once after deployment:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- migrate
```

### Migration History

| Version | Changes |
| --- | --- |
| v1 | Initial schema (no version key) |
| v2 | Introduced `SchemaVersion` tracking, `Referral`, `SubscriptionMeta`, `ChargeHistory` keys |

### How It Works

- `get_schema_version()` returns `1` by default (pre-versioning contracts).
- `migrate()` checks the current version and applies any pending upgrades sequentially.
- Subsequent calls to `migrate()` are no-ops once the contract is at the latest version.
- Future schema changes should add a new `if version < N { ... }` block in `migration.rs`.
