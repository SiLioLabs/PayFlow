# Contributor Onboarding: First Issue to First PR

Welcome! This guide walks you from "I just heard about FlowPay" to "my first PR is open," assuming only general Rust and TypeScript experience — no prior Soroban, Stellar, or smart-contract background required.

This is a narrative walkthrough. For reference material once you're up and running, see:

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — full contribution reference (branching, commit style, PR checklist)
- [`docs/CONTRIBUTING-CONTRACT.md`](CONTRIBUTING-CONTRACT.md) — contract/Rust conventions in depth
- [`docs/CONTRIBUTING-FRONTEND.md`](CONTRIBUTING-FRONTEND.md) — frontend/React conventions in depth
- [`docs/TESTING.md`](TESTING.md) — full testing guide

---

## Table of Contents

- [1. Environment Setup](#1-environment-setup)
- [2. First Run](#2-first-run)
- [3. Choosing an Issue](#3-choosing-an-issue)
- [4. Making a Change](#4-making-a-change)
- [5. Submitting a PR](#5-submitting-a-pr)
- [6. Troubleshooting](#6-troubleshooting)

---

## 1. Environment Setup

FlowPay has two halves: a Rust/Soroban smart contract (`contract/`) and a React/TypeScript frontend (`frontend/`), plus a handful of Node.js operational scripts (`scripts/`). You'll want the full toolchain even if you only plan to touch one side, since CI runs both.

### 1.1 Install Rust

```bash
curl https://sh.rustup.rs -sSf | sh
```

Follow the prompts (the default install option is fine), then restart your shell or run:

```bash
source "$HOME/.cargo/env"
```

Verify:

```bash
rustc --version
cargo --version
```

Expected output (your exact version may be newer):

```text
rustc 1.95.0 (59807616e 2026-04-14)
cargo 1.95.0 (f2d3ce0bd 2026-03-21)
```

### 1.2 Add the WASM compilation target

Soroban contracts compile to WebAssembly, so you need the `wasm32-unknown-unknown` target in addition to your native Rust toolchain:

```bash
rustup target add wasm32-unknown-unknown
```

Expected output:

```text
info: downloading component 'rust-std' for 'wasm32-unknown-unknown'
info: installing component 'rust-std' for 'wasm32-unknown-unknown'
```

(If it's already installed, you'll instead see `info: component rust-std for target wasm32-unknown-unknown is up to date` — that's fine too.)

### 1.3 Install the Soroban / Stellar CLI

```bash
cargo install --locked soroban-cli
```

This is a real compile-from-source install and can take several minutes. Verify with:

```bash
soroban --version
```

Expected output:

```text
stellar 26.0.0 (60f7458e7ecffddf2f2d91dc6d0d2db4fab03ecc)
stellar-xdr 26.0.0 (dd7a165a193126fd37a751d867bee1cb8f3b55a6)
xdr curr (cff714a5ebaaaf2dac343b3546c2df73f0b7a36e)
```

Don't be surprised that the CLI identifies itself as `stellar` rather than `soroban` — the tool was renamed upstream (Soroban CLI → Stellar CLI) but the `soroban` command name still works as an alias, and this repo's docs still refer to it as "the Soroban CLI." Both `soroban <args>` and `stellar <args>` invoke the same binary.

### 1.4 Install Node.js

You need Node 18 or newer (the frontend CI runs Node 20). Install via [nodejs.org](https://nodejs.org/) or a version manager (`nvm`, `fnm`, etc.). Verify:

```bash
node --version
npm --version
```

Expected output (any Node ≥18 / recent npm is fine):

```text
v20.20.2
10.8.2
```

### 1.5 Verify your setup end-to-end

```bash
rustc --version && cargo --version && rustup target list --installed | grep wasm32 && soroban --version && node --version && npm --version
```

If every command prints a version with no errors, you're ready for [First Run](#2-first-run).

---

## 2. First Run

### 2.1 Clone the repository

If you haven't already, fork the repo on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-username>/PayFlow.git
cd PayFlow
```

### 2.2 Run the contract test suite

```bash
cd contract
cargo test
```

The first run compiles every dependency from scratch and will take a minute or two. Expect output ending in something like:

```text
test test::test_subscriber_page_limit_capped_at_50 ... ok

test result: ok. 223 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 12.87s
```

(The exact test count will drift as the suite grows — what matters is `0 failed`.)

### 2.3 Run the frontend test suite

```bash
cd ../frontend
npm install
npm run test
```

Expected output:

```text
 Test Files  34 passed (34)
      Tests  214 passed (214)
```

If both suites are green, your environment is correctly set up end-to-end.

### 2.4 (Optional) Run the frontend locally

```bash
cp .env.example .env.local
npm run dev
```

You'll need a `VITE_CONTRACT_ID` in `.env.local` pointing at a deployed testnet contract to interact with real data — see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) if you want to deploy your own testnet instance. For contract-only or frontend-UI-only contributions, you generally don't need this step.

For a complete reference of all environment variables and how RPC, passphrase, and contract ID must align across frontend, scripts, and contract tests, see [`docs/development/network-matrix.md`](development/network-matrix.md).

---

## 3. Choosing an Issue

### Finding a good first issue

Start with the [Good First Issues](../CONTRIBUTING.md#good-first-issues) table in `CONTRIBUTING.md` — it lists well-scoped tasks (adding a unit test, improving an error message) that don't require understanding the whole codebase. Beyond that table, look at the repository's open issues for labels like `good first issue` or `documentation`.

### What "complexity" and "points" mean

Issues in this project are often labeled with a complexity tier (Low / Medium / High) and a point value (e.g., "200 points"). Treat these as a rough proxy for scope, not difficulty in an absolute sense:

- **Low/Easy** — a single, well-defined change in one file; usually a few hours (e.g., adding one unit test).
- **Medium** — touches a few files or requires understanding one subsystem end-to-end (e.g., adding a new contract function with its test, event, and docs).
- **High** — spans multiple files/subsystems, or is a substantial writing/design task (e.g., a new architectural document, a new cross-cutting feature). "200 points, High complexity" does **not** mean it requires deep prior expertise — it means it requires more time, more careful reading of existing conventions, and more thorough validation before it's mergeable.

If you're new, don't be scared off by "High" — read the issue's **Acceptance Criteria** and **Implementation Guidelines** sections carefully; they're written to make even a high-complexity task tractable by spelling out exactly what "done" looks like.

### Claiming an issue

Comment on the issue saying you'd like to work on it, and wait for a maintainer to assign it to you (or confirm it's unclaimed) before starting substantial work — this avoids two people duplicating effort on the same issue.

---

## 4. Making a Change

### 4.1 Create a branch

Branch off `master`, following the naming convention in [`CONTRIBUTING.md`](../CONTRIBUTING.md#branching--workflow):

```bash
git checkout -b docs/my-change      # or feat/, fix/, test/, refactor/
```

If the issue you claimed specifies a branch name, use that one.

### 4.2 The edit–compile–test loop

**Contract changes:**

```bash
cd contract
# edit src/*.rs
cargo check          # fast — type-checks without full codegen
cargo test            # run the full suite
cargo test test_name  # run one test while iterating
```

**Frontend changes:**

```bash
cd frontend
# edit src/**/*.tsx
npm run test          # run the Vitest suite
```

Keep this loop tight: make a small change, run the relevant tests, repeat. Don't write a large batch of changes before running tests for the first time — it makes failures much harder to isolate.

### 4.3 Run type checks and linters before you consider a change done

**Contract:**

```bash
cd contract
cargo clippy -- -D warnings   # must produce zero warnings — CI enforces this
cargo check
```

**Frontend:**

```bash
cd frontend
npm run lint      # ESLint — CI enforces zero errors (warnings are currently tolerated in this repo)
npm run format    # Prettier auto-format
npm run build     # tsc + vite build — catches TypeScript errors lint might miss
```

### 4.4 If you touched contract event/error/API surface

Cross-check [`docs/CONTRIBUTING-CONTRACT.md`](CONTRIBUTING-CONTRACT.md) — it has specific rules (every state-changing function emits an event, every new function needs a test covering happy path / auth / error / event, error variants need sequential discriminants, etc.) that reviewers will check for.

---

## 5. Submitting a PR

### What to include in the PR description

- **What changed and why** — one or two sentences of intent, not just a restatement of the diff.
- **Link to the issue** it addresses (e.g., "Closes #123").
- **How you validated it** — which commands you ran and that they passed (`cargo test`, `npm run test`, `npm run lint`, etc.).
- Anything a reviewer should pay special attention to (e.g., "I changed a storage key layout — flagging for extra review").

### How the review process works

1. Open the PR against `master` on the upstream repository (not your fork's `master`).
2. CI runs automatically — the `Backend (Rust)` and `Frontend` GitHub Actions workflows (see [`.github/workflows/`](../.github/workflows/)) must pass before a maintainer will review in depth.
3. A maintainer reviews for correctness, adherence to the conventions in `CONTRIBUTING*.md`, and test coverage.
4. Expect review feedback — this is normal, not a sign your PR was bad. Address comments with new commits (don't force-push over review history mid-review unless asked to).

### Common review feedback

- Missing a test for a new code path (happy path, auth failure, or event emission).
- A new contract function that doesn't call `user.require_auth()` before mutating state.
- Frontend component importing `@stellar/stellar-sdk` directly instead of going through `src/stellar.ts`.
- Documentation added without updating the corresponding reference doc (e.g., a new event not added to [`docs/EVENTS.md`](EVENTS.md)).
- PR description too thin to understand _why_ the change was made.

### PR checklist

Before opening, run through [`CONTRIBUTING.md`](../CONTRIBUTING.md#pull-request-checklist) — it's short and catches most of the above before a reviewer has to ask.

---

## 6. Troubleshooting

For environment variable alignment issues (RPC URL, network passphrase, contract ID mismatch between frontend/scripts), see the [network matrix](development/network-matrix.md).

| Problem                                                                              | Likely cause                                                                                                        | Fix                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error[E0463]: can't find crate for 'core'` (or similar) when building the contract  | Missing the `wasm32-unknown-unknown` target                                                                         | `rustup target add wasm32-unknown-unknown`                                                                                                                                |
| `cargo test` fails with `unresolved import` or dependency errors right after cloning | Stale/partial `Cargo.lock` or first-time dependency download interrupted                                            | `cd contract && cargo clean && cargo test`                                                                                                                                |
| `npm run test` / `npm run build` fails immediately with module-not-found errors      | `npm install` wasn't run, or was run in the wrong directory                                                         | Make sure you're in `frontend/` (not repo root) before running `npm install`                                                                                              |
| `cargo clippy -- -D warnings` fails on code you didn't touch                         | You're on a stale `master` that predates a clippy/toolchain update                                                  | `git fetch origin && git rebase origin/master`                                                                                                                            |
| Frontend dev server starts but the UI shows contract errors / can't fetch data       | `VITE_CONTRACT_ID` not set (or points at a contract that isn't deployed on the network your `VITE_RPC_URL` targets) | Follow [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) to deploy a testnet contract, then set `.env.local` accordingly — or skip running the live UI if your change doesn't need it. Also check the [network matrix](development/network-matrix.md) for alignment rules. |

If you hit something not covered here, open a GitHub Discussion or comment on your issue — see [Questions](../CONTRIBUTING.md#questions) in `CONTRIBUTING.md`.
