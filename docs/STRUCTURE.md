# Project Structure

A detailed breakdown of every file and folder in the FlowPay repository.

---

## Top-Level Layout

```
flowpay/
├── contract/        # Soroban smart contract (Rust)
├── frontend/        # React + TypeScript UI
├── docs/            # Project documentation
├── .gitignore       # Git ignore rules
├── CONTRIBUTING.md  # Contribution guide
├── LICENSE          # MIT License
└── README.md        # Project overview and quick start
```

---

## `contract/`

The Soroban smart contract. Written in Rust, compiled to WASM, deployed to the Stellar network.

```
contract/
├── Cargo.toml          # Rust package manifest and dependencies
└── src/
    ├── lib.rs          # Contract implementation
    └── test.rs         # Unit tests
```

### `contract/Cargo.toml`

Defines the package metadata and dependencies:

- `soroban-sdk = "21.0.0"` with `alloc` feature — the core Soroban SDK
- `soroban-sdk` with `testutils` feature in `[dev-dependencies]` — test utilities
- `[profile.release]` — aggressive optimisation settings for minimal WASM size (`opt-level = "z"`, `lto = true`, `panic = "abort"`)
- `crate-type = ["cdylib"]` — required for WASM compilation

### `contract/src/lib.rs`

The main contract file. Contains:

| Item | Kind | Description |
| --- | --- | --- |
| `DataKey` | `enum` | Storage key variants: `Subscription(Address)` and `Token` |
| `Subscription` | `struct` | Per-user subscription data: merchant, amount, interval, last_charged, active |
| `FlowPay` | `struct` | The contract entry point (tagged `#[contract]`) |
| `initialize()` | function | One-time setup — stores the token address |
| `subscribe()` | function | Creates/updates a subscription |
| `charge()` | function | Permissionless — triggers a recurring charge |
| `pay_per_use()` | function | Instant microtransaction |
| `cancel()` | function | Deactivates a subscription |
| `get_subscription()` | function | Read-only view |

### `contract/src/test.rs`

Unit tests using the Soroban test environment. Contains:

| Item | Description |
| --- | --- |
| `setup()` | Shared helper — deploys token + contract, mints tokens, approves allowance |
| `test_subscribe_and_charge` | Happy path: subscribe → advance time → charge |
| `test_cancel` | Verifies `active = false` after cancel |
| `test_charge_too_early` | Verifies panic when interval hasn't elapsed |

---

## `frontend/`

The React + TypeScript single-page application.

```
frontend/
├── index.html              # HTML entry point
├── package.json            # Node dependencies and scripts
├── tsconfig.json           # TypeScript compiler config
├── vite.config.ts          # Vite bundler config
└── src/
    ├── main.tsx            # React root — mounts <App />
    ├── App.tsx             # Root component: wallet connect, tab routing
    ├── index.css           # Global styles (dark theme, card, badge utilities)
    ├── stellar.ts          # All Soroban SDK calls (single source of truth)
    ├── hooks/
    │   └── useWallet.ts    # Freighter wallet hook
    └── components/
        ├── SubscribeForm.tsx   # Form to create a new subscription
        └── Dashboard.tsx       # View subscription, cancel, pay-per-use
```

### `frontend/src/stellar.ts`

The contract interaction layer. All `@stellar/stellar-sdk` usage is isolated here. Components never import the SDK directly.

| Export | Description |
| --- | --- |
| `RPC_URL` | Soroban RPC endpoint (testnet) |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET` |
| `CONTRACT_ID` | Read from `VITE_CONTRACT_ID` env var |
| `server` | `Server` instance for RPC calls |
| `buildSubscribeTx()` | Builds + simulates a `subscribe` transaction, returns XDR |
| `buildCancelTx()` | Builds + simulates a `cancel` transaction, returns XDR |
| `buildPayPerUseTx()` | Builds + simulates a `pay_per_use` transaction, returns XDR |
| `getSubscription()` | Simulates `get_subscription`, parses and returns the result |

### `frontend/src/hooks/useWallet.ts`

React hook for Freighter wallet integration.

| Export | Description |
| --- | --- |
| `publicKey` | The connected wallet's public key, or `null` |
| `connect()` | Prompts Freighter connection |
| `signAndSubmit(xdr)` | Signs a transaction with Freighter and submits it to the network |
| `error` | Error message string, or `null` |

### `frontend/src/components/SubscribeForm.tsx`

Form component for creating a new subscription. Accepts merchant address, XLM amount, and billing interval (daily / weekly / monthly). Calls `buildSubscribeTx()` and passes the XDR to `onSign`.

### `frontend/src/components/Dashboard.tsx`

Displays the user's active subscription. Shows merchant, amount, interval, and next charge date. Provides cancel and pay-per-use actions.

### `frontend/src/pages/AdminDashboard.tsx`

Administrative tools layout. Hosts the Subscription Repair panel for on-chain diagnostics and recovery.

### `frontend/src/components/admin/SubscriptionRepairPanel.tsx`

Admin-only subscription integrity panel. Calls `validate_subscription` (read-only simulation) and `repair_subscription` (admin-auth transaction). Authorization is enforced by comparing the connected wallet to `get_admin`.

### `frontend/src/App.tsx`

Root component. Manages wallet connection state and tab switching between `SubscribeForm`, `Dashboard`, `MerchantDashboard`, and `AdminDashboard`.

---

## `docs/`

Project documentation.

```
docs/
├── ARCHITECTURE.md   # System design, data model, storage strategy
├── DEPLOYMENT.md     # Build, deploy, keeper setup
├── TESTING.md        # How to run and write tests
├── API.md            # Full contract function reference
├── STRUCTURE.md      # This file
└── SECURITY.md       # Security model and disclosure policy
```

---

## Root Files

| File | Description |
| --- | --- |
| `.gitignore` | Excludes `target/`, `node_modules/`, `dist/`, `.env*`, `.soroban/`, `*.wasm` |
| `CONTRIBUTING.md` | How to contribute: setup, branching, guidelines, PR checklist |
| `LICENSE` | MIT License |
| `README.md` | Project overview, features, quick start, contract reference |
