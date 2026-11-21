# PayFlow: Decentralized Subscriptions on Stellar

PayFlow (also referred to as FlowPay) is a decentralized subscription and recurring payment protocol built on the Stellar network using Soroban smart contracts. It enables trustless, non-custodial recurring billing by allowing users to approve a contract to periodically transfer funds to a merchant.

## Project Overview

- **Core Technology:** Stellar Soroban (Rust), React + TypeScript (Frontend)
- **Architecture:**
  - **Smart Contract (`/contract`):** Handles subscription logic, charging, cancellations, and pay-per-use microtransactions.
  - **Frontend (`/frontend`):** A React-based dashboard for users to manage subscriptions and for merchants to view revenue/subscribers.
  - **Documentation (`/docs`):** Comprehensive guides on API, architecture, deployment, and testing.

## Key Components & Technologies

### Smart Contract (Rust/Soroban)

- **Primary Contract:** `FlowPay` in `contract/src/lib.rs`.
- **Key Functions:**
  - `initialize(token)`: Sets the primary SAC token (e.g., XLM).
  - `subscribe(user, merchant, amount, interval, ...)`: Creates a new subscription.
  - `charge(user)`: Triggers a scheduled charge (called externally by a keeper).
  - `pay_per_use(user, amount)`: Instant microtransactions against an active subscription.
  - `cancel(user)`: Deactivates a subscription.
  - `batch_charge(users)`: Optimizes multi-user charging in a single transaction.
- **Features:** Grace periods, merchant whitelisting, protocol fees, referral tracking, and subscription metadata.

### Frontend (React/TypeScript)

- **Framework:** Vite + React + TypeScript.
- **Blockchain Interaction:** `frontend/src/stellar.ts` uses `@stellar/stellar-sdk` and Soroban RPC.
- **Wallet Support:** Freighter Wallet via `useWallet` hook.
- **Key Views:** Subscriber Dashboard, Merchant Dashboard, Subscription Forms.

## Building and Running

### Prerequisites

- Rust 1.70+ with `wasm32-unknown-unknown` target.
- Soroban CLI.
- Node.js 18+.

### Root Commands (using `package.json` scripts)

- **Typecheck Frontend:** `npm run typecheck`
- **Build Frontend:** `npm run build:frontend`
- **Test Contract:** `npm run backend:test`
- **Check Contract:** `npm run backend:typecheck`

### Contract (`/contract`)

- **Build:** `cargo build --release --target wasm32-unknown-unknown`
- **Test:** `cargo test`

### Frontend (`/frontend`)

- **Install Dependencies:** `npm install`
- **Development Server:** `npm run dev`
- **Build:** `npm run build`
- **Test:** `npm run test` (Vitest)
- **Lint/Format:** `npm run lint` / `npm run format`

## Development Conventions

### Coding Style

- **Contract:** Idiomatic Rust using `soroban-sdk`. Strict use of `no_std`.
- **Frontend:** Functional React components with TypeScript. Prefer Vanilla CSS for styling (as seen in `index.css`).

### Testing Practices

- **Contract:** Comprehensive unit tests in `contract/src/test.rs`. Use `soroban-sdk`'s `testutils`.
- **Frontend:** Vitest for unit and component testing. Smoke tests for main application entry points.

### Contribution Guidelines

- Refer to `CONTRIBUTING.md` for detailed instructions.
- Husky is used for pre-commit/pre-push hooks (linting and type-checking).

## Important Files

- `contract/src/lib.rs`: Entry point for smart contract logic.
- `frontend/src/stellar.ts`: Central hub for all Soroban/Stellar interactions.
- `docs/API.md`: Detailed contract function documentation.
- `docs/ARCHITECTURE.md`: Deep dive into system design and storage strategy.
