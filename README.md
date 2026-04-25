<div align="center">

# ⚡ FlowPay

**Decentralized Subscription & Recurring Payments on Stellar**

*Netflix-style payments, on-chain.*

<br/>

<img src="https://img.shields.io/badge/Stellar-Soroban-7c3aed" alt="Stellar Soroban" />
<img src="https://img.shields.io/badge/Language-Rust-orange" alt="Rust" />
<img src="https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-3b82f6" alt="React TypeScript" />
<img src="https://img.shields.io/badge/Status-Testnet-22c55e" alt="Status: Testnet" />
<img src="https://img.shields.io/badge/License-MIT-94a3b8" alt="MIT License" />

</div>

---

## What is FlowPay?

Recurring payments are one of the hardest problems in crypto. Every billing cycle, users have to manually send funds — there's no native mechanism for a service to pull payments on a schedule.

FlowPay solves this. It is a Soroban smart contract that lets users **approve a contract to charge them periodically**. Merchants and creators get paid automatically. Users stay in full control and can cancel at any time.

Think of it as **Stripe Subscriptions, but trustless and on-chain** — built natively on the Stellar network using the Soroban smart contract platform.

---

## Features

| Feature | Description |
| --- | --- |
| **Recurring Subscriptions** | Users set up a subscription once. The contract enforces the billing interval on every charge attempt. |
| **Allowance-Based Spending** | Uses Soroban's token `transfer_from` — the contract only moves funds the user has explicitly approved. |
| **Pay-Per-Use Microtransactions** | Charge arbitrary amounts instantly against an active subscription. Ideal for metered/usage-based billing. |
| **Cancel Anytime** | Users can cancel their subscription in a single transaction. No lock-ins. |
| **Any SAC Token** | Works with native XLM or any Stellar Asset Contract (USDC, custom tokens). |
| **On-Chain Events** | Every action emits a contract event (`subscribed`, `charged`, `cancelled`, `pay_per_use`) for easy indexing. |

---

## Use Cases

- **SaaS tools** — charge users monthly for software access
- **Content creators** — fan subscriptions and newsletter paywalls
- **DAOs & communities** — recurring membership dues
- **Metered APIs** — pay-per-call billing using `pay_per_use`
- **Payroll** — automate recurring salary disbursements

---

## How It Works

```
1. User calls approve() on the token contract
   → grants FlowPay an allowance (e.g. 60 XLM for 12 months)

2. User calls subscribe(merchant, amount, interval)
   → subscription stored on-chain, last_charged = now

3. Backend/keeper calls charge(user) every billing period
   → contract checks: now >= last_charged + interval
   → transfers amount from user → merchant via transfer_from
   → updates last_charged

4. User calls cancel() at any time
   → subscription marked inactive, no further charges possible
```

> **Important:** Soroban has no native cron jobs. The `charge()` function must be triggered externally — by your backend, a keeper service, or a scheduled cloud function. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for keeper setup.

---

## Project Structure

```
flowpay/
├── contract/                   # Soroban smart contract (Rust)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs              # Core contract: subscribe, charge, cancel, pay_per_use
│       └── test.rs             # Unit tests (3 tests, full logic coverage)
│
├── frontend/                   # React + TypeScript UI
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx             # Root component, wallet connect, tab routing
│       ├── index.css
│       ├── stellar.ts          # All contract interactions (single source of truth)
│       ├── hooks/
│       │   └── useWallet.ts    # Freighter wallet hook
│       └── components/
│           ├── SubscribeForm.tsx   # Create a new subscription
│           └── Dashboard.tsx       # View, cancel, pay-per-use
│
├── docs/                       # Full project documentation
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   ├── API.md
│   ├── STRUCTURE.md
│   └── SECURITY.md
│
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Getting Started

### Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| Rust | 1.70+ | [rustup.rs](https://rustup.rs/) |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | latest | `cargo install --locked soroban-cli` |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Freighter Wallet | latest | [freighter.app](https://www.freighter.app/) |

---

### 1 — Clone the repo

```bash
git clone https://github.com/SiLioLabs/PayFlow.git
cd flowpay
```

### 2 — Build & test the contract

```bash
cd contract
cargo test
cargo build --release --target wasm32-unknown-unknown
```

All 3 tests should pass:
```
test test::test_cancel                  ... ok
test test::test_subscribe_and_charge    ... ok
test test::test_charge_too_early        ... ok
```

### 3 — Deploy to Testnet

```bash
# Generate and fund a testnet keypair
soroban keys generate --global deployer --network testnet

# Deploy the compiled WASM
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/flowpay.wasm \
  --source deployer \
  --network testnet
# → prints your CONTRACT_ID

# Initialize with the native XLM token
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- initialize \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

For full deployment instructions including mainnet, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### 4. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev

---

## Contract Reference

| Function | Auth Required | Description |
| --- | --- | --- |
| `initialize(token)` | — | One-time setup. Sets the token contract address. |
| `subscribe(user, merchant, amount, interval)` | `user` | Creates or updates a subscription. |
| `charge(user)` | — | Triggers a charge if the interval has elapsed. |
| `pay_per_use(user, amount)` | `user` | Instant microtransaction against an active subscription. |
| `cancel(user)` | `user` | Deactivates a subscription. |
| `get_subscription(user)` | — | Read-only. Returns the subscription struct or `None`. |

Full parameter types, return values, and error conditions: [docs/API.md](docs/API.md)

---

## Documentation

| Document | Description |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data model, storage strategy, contract flow |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Step-by-step deploy to testnet and mainnet, keeper setup |
| [docs/TESTING.md](docs/TESTING.md) | How to run tests, what's covered, how to add new tests |
| [docs/API.md](docs/API.md) | Full contract function reference with types and examples |
| [docs/STRUCTURE.md](docs/STRUCTURE.md) | Detailed folder and file breakdown |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model, known limitations, disclosure policy |

---

## Contributing

FlowPay is open source and welcomes contributions. Good first issues include:

- Multi-token support (USDC, custom SAC tokens)
- Keeper/scheduler service (Node.js or Python)
- Subscription pause/resume
- Additional contract tests

Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

## Security

FlowPay is deployed on Testnet and has not been audited. Do not use with mainnet funds until a formal audit is completed.

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model and vulnerability disclosure policy.

---

## License

FlowPay is licensed under the [MIT License](LICENSE).
