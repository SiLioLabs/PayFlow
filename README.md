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
