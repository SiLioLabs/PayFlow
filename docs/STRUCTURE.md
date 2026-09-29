# Project Structure

A detailed breakdown of the FlowPay repository as tracked in git. Compared against `git ls-files` at documentation time. Generated artifacts (`target/`, `node_modules/`, `dist/`, most WASM) are gitignored and omitted.

---

## Top-Level Layout

```
PayFlow/
├── .husky/              # Git hooks (pre-commit, pre-push)
├── .kiro/               # Spec notes under .kiro/specs/
├── contract/            # Soroban smart contract (Rust)
├── deployments/         # deploy-pipeline config + manifest
├── docs/                # Project documentation
├── frontend/            # React + TypeScript UI
├── scripts/             # Operational TypeScript (keeper, indexer, deploy, health)
├── tests/               # Root Node tests (tsx)
├── .env.example         # Keeper / indexer env template
├── .gitignore
├── AGENTS.md            # Agent-oriented project map
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE              # MIT License
├── README.md
├── SECURITY.md
├── config.ts            # Shared keeper/indexer config
├── config.test.ts
├── keeper.ts            # Root keeper entry (canonical copy also in scripts/)
├── keeper-config.ts
├── keeper.test.ts
├── indexer.ts
├── package.json         # Root npm scripts (frontend typecheck/build, contract test)
├── tsconfig.json
└── …                    # Additional tracked root notes/scripts (see Root files)
```

Checked-in directories: `contract/`, `deployments/`, `docs/`, `frontend/`, `scripts/`, `tests/`, `.husky/`, `.kiro/`. There is no tracked `.github/` workflow tree in this repository at documentation time.

---

## `contract/`

The Soroban smart contract. Written in Rust, compiled to WASM, deployed to the Stellar network.

```
contract/
├── Cargo.toml           # Rust package `flowpay`, crate-type cdylib
├── Cargo.lock
├── package-lock.json
├── src/                 # Contract modules (see below)
└── test_snapshots/      # soroban-sdk test snapshot JSON
```

Release WASM path (after `cargo build --release --target wasm32-unknown-unknown` in this directory):

```text
contract/target/wasm32-unknown-unknown/release/flow_pay.wasm
```

### `contract/src/`

```
contract/src/
├── lib.rs                   # FlowPay contract entry; re-exports modules
├── admin.rs
├── batch.rs
├── bench.rs
├── charge_exec.rs
├── errors.rs
├── events.rs
├── fee.rs
├── grace.rs
├── limits.rs                 # Limits documentation pointer (validation/batch/spending_limit)
├── merchant_stats.rs
├── migration.rs             # Schema version + migrate(); CURRENT_VERSION = 3
├── min_interval.rs
├── referral.rs
├── spending_limit.rs
├── storage.rs
├── subscription_count.rs
├── subscription_history.rs
├── subscription_metadata.rs
├── token.rs                  # Note on token/vesting (vesting extracted to vesting/)
├── trial.rs
├── upgrade.rs               # propose_upgrade / commit_upgrade (test-only upgrade())
├── validation.rs
├── whitelist.rs
├── test.rs                  # Unit tests
└── test_migration.rs
```

### `vesting/` (Academy Vesting Contract)

```
vesting/
├── Cargo.toml
└── src/
    ├── lib.rs               # AcademyVestingContract
    └── test.rs              # Unit & smoke tests
```

### `contract/Cargo.toml`

- `soroban-sdk = "21.0.0"` with `alloc`
- `soroban-sdk` `testutils` in `[dev-dependencies]`
- `[profile.release]` — `opt-level = "z"`, `lto = true`, `panic = "abort"`
- `crate-type = ["cdylib"]`

### `contract/src/lib.rs`

The `#[contract]` entry. Logic is split across the modules above. Notable public methods include `initialize(token, admin)`, `subscribe` / `charge` / `pay_per_use` / `cancel`, batch operations, `contract_health_check`, `migrate(users)`, `get_schema_version`, and two-step `propose_upgrade` / `commit_upgrade`. Full ABI: [`API.md`](API.md).

---

## `frontend/`

The React + TypeScript single-page application (Vite).

```
frontend/
├── .env.example
├── .prettierrc
├── eslint.config.js
├── index.html
├── package.json             # npm run dev | build | test | lint
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── stellar.ts           # Soroban SDK / RPC wrappers
    ├── stellarBatchCharge.ts
    ├── constants.ts
    ├── types.ts
    ├── setupTests.ts
    ├── components/          # UI (including components/admin/)
    ├── pages/
    │   └── AdminDashboard.tsx
    ├── hooks/
    ├── context/
    ├── services/
    ├── utils/
    └── __tests__/
```

`frontend/src/pages/AdminDashboard.tsx` hosts admin tools (including the admin `SubscriptionRepairPanel`). There are two `SubscriptionRepairPanel.tsx` files: `components/admin/` (admin dashboard) and `components/` (duplicate at the components root). Component-level reference: [`FRONTEND-COMPONENTS.md`](FRONTEND-COMPONENTS.md).

### `frontend/src/stellar.ts`

Contract interaction layer. `@stellar/stellar-sdk` usage is concentrated here. See [`FRONTEND.md`](FRONTEND.md).

### `frontend/src/hooks/`

Wallet, subscription, admin, network, accessibility, and form hooks (`useWallet.ts`, `useAdmin.ts`, `useSubscription.ts`, and others listed in git).

### `frontend/src/services/`

```
frontend/src/services/
├── PollingManager.ts
├── rpcCache.ts
├── scval.ts
├── txQueue.ts
└── wallets/
    ├── WalletAdapter.ts
    ├── FreighterAdapter.ts
    ├── HanaAdapter.ts
    ├── LobstrAdapter.ts
    └── XBullAdapter.ts
```

### `frontend/src/utils/`

`addressValidation.ts`, `subscriptionValidation.ts`, `errors.ts`, `format.ts`, `network.ts`, `notificationPriority.ts`.

### `frontend/src/context/`

`RpcHealthContext.tsx`, `ShortcutRegistry.tsx`.

---

## `scripts/`

Operational TypeScript. Run with `npx tsx` from the repository root (or `cd scripts && npm install` then local `tsx`). Catalog: [`scripts/README.md`](../scripts/README.md).

```
scripts/
├── package.json             # typecheck, keeper, indexer, pre-upgrade-check, tests
├── deploy-pipeline.ts       # Build → stellar contract deploy → initialize → health → fee → whitelist
├── health-check.ts          # Shallow / --deep contract probes
├── pre-upgrade-check.ts
├── migrate-contract.ts
├── testnet-setup.ts
├── keeper.ts
├── indexer.ts
├── soroban-admin.ts
├── Dockerfile
├── docker-compose.yml
├── grafana-dashboard.json
├── __tests__/               # Vitest (deploy-pipeline, merchant queries, …)
├── data/                    # Benchmarks and testnet fixtures
├── fixtures/
└── …                        # Allowance, analytics, webhook, snapshot, DLQ helpers
```

---

## `deployments/`

Consumed by `scripts/deploy-pipeline.ts`.

```
deployments/
├── config.json              # Checked-in example is testnet
└── manifest.json            # Pipeline step progress and contract ID
```

---

## `docs/`

```
docs/
├── API.md
├── ARCHITECTURE.md
├── COMPLIANCE.md
├── CONTRIBUTING-CONTRACT.md
├── CONTRIBUTING-FRONTEND.md
├── DAILY-LIMITS.md
├── DEPLOYMENT.md
├── ERROR-CODES.md
├── EVENT-DRIVEN-GUIDE.md
├── EVENTS.md
├── FRONTEND-COMPONENTS.md
├── FRONTEND.md
├── GLOSSARY.md
├── INTEGRATION-GUIDE.md
├── KEEPER.md
├── MAINNET-DEPLOYMENT.md
├── MERCHANT-INTEGRATION.md
├── MULTI-TOKEN.md
├── ONBOARDING.md
├── REFERRAL.md              # Compatibility stub → REFERRALS.md
├── REFERRALS.md
├── SECURITY.md
├── SECURITY-REVIEW.html
├── STRUCTURE.md             # This file
├── SUBSCRIBER-LIFECYCLE.md
├── TESTING.md
├── architecture/
│   ├── storage_and_ttl.md
│   └── two-step-auth.md
├── development/
│   ├── ci-workflows.md
│   ├── network-matrix.md
│   ├── performance-benchmarking.md
│   └── testing_runbook.md
├── integrations/
│   └── frontend_integration.md
├── operations/
│   ├── keeper_runbook.md
│   ├── troubleshooting.md
│   └── two_step_admin_playbooks.md
├── security/
│   ├── audit-preparation.md
│   └── threat_matrix.md
└── spec/
    └── lifecycle_spec.md
```

---

## `tests/`

```
tests/
├── alert-failed-charges.test.ts
└── fixtures/
    └── batch-results.json
```

Root `package.json` `npm test` runs `tsx --test tests/*.test.ts`.

---

## Root files

| File / path                         | Description                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `.gitignore`                        | Excludes `target/`, `node_modules/`, `dist/`, `.env*`, `.soroban/`, `*.wasm` |
| `.env.example`                      | Keeper/indexer template (`KEEPER_SECRET`, `NETWORK_PASSPHRASE`, …)          |
| `package.json`                      | `typecheck`, `build:frontend`, `backend:test`, `backend:typecheck`          |
| `CONTRIBUTING.md`                   | How to contribute                                                           |
| `LICENSE`                           | MIT                                                                         |
| `SECURITY.md`                       | Security policy (Testnet-only until audit)                                  |
| `config.ts` / `keeper.ts` / `indexer.ts` | Root copies of operational entrypoints                                 |
| `AGENTS.md`                         | High-level architecture for agents                                          |
| `CHANGELOG.md`, `TODO.md`, `UIDesign.md` | Project notes                                                          |
| `issue.md`, `Issue.md`, `Issues.md` | Tracked issue dumps                                                         |
| `code.md`, `md`, `contract_validation_tasks.ipynb` | Additional tracked notes                                  |
| `test_migration.rs`                 | Root-level migration test file (canonical tests live in `contract/src/`)    |
| `alert-failed-charges.ts`, `query-events.ts`, `replay-events.ts` | Root script copies            |

---

## Related docs

- [`DEPLOYMENT.md`](DEPLOYMENT.md) — deploy pipeline and health gates
- [`FRONTEND.md`](FRONTEND.md) — frontend architecture
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — contract design
