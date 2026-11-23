# CI Workflows

Two GitHub Actions workflows now run automatically on every pull request and push to `master`. They mirror the checks you would run locally, so a green CI run is a reliable signal before merge.

---

## scripts-ci

**File:** `.github/workflows/scripts-ci.yml`

**Triggers:** pull requests (all branches) and pushes to `master`.

**Job:** `scripts` — runs on `ubuntu-latest`, Node 22.

| Step | Command | Notes |
| --- | --- | --- |
| Install | `npm ci` | Run inside `scripts/` |
| Typecheck | `npm run typecheck` | `tsc --noEmit` against `scripts/tsconfig.json` |
| Lint | `npm run lint` | ESLint |
| Duplicate lint (TS) | `npm run lint:duplicates` | Fails on baseline mismatch against `scripts/.duplicate-lint-baseline.json` |
| Duplicate lint (MJS) | `node lint-duplicates.mjs` | Checks for duplicate same-module imports in `.ts` files |
| Tests | `npm test` | Vitest; sets `NODE_OPTIONS: --experimental-sqlite` |

### Why `--experimental-sqlite`

`scripts/vitest.config.mts` aliases `node:sqlite` to `scripts/__tests__/support/node-sqlite.ts`, which calls `createRequire(import.meta.url)("node:sqlite")`. Node's built-in SQLite module is behind the `--experimental-sqlite` flag in Node 22; without it, the alias resolves but the `createRequire` call fails at import time and the affected tests silently error. The workflow pins `node-version: '22'` specifically because that is the first LTS line that ships `node:sqlite`.

---

## security-audit

**File:** `.github/workflows/security-audit.yml`

**Triggers:** pull requests (all branches), pushes to `master`, and a weekly schedule (every Monday at 06:00 UTC, cron `0 6 * * 1`).

### cargo-audit job

Runs on `ubuntu-latest`.

| Step | Detail |
| --- | --- |
| Install toolchain | `actions-rust-lang/setup-rust-toolchain@v1` (stable) |
| Cache | `~/.cargo/registry` and `~/.cargo/git`, keyed on `Cargo.lock` hashes |
| Install auditor | `cargo install cargo-audit --locked` |
| Audit contract | `cargo audit --file contract/Cargo.lock --deny warnings --config audit.toml` |
| Audit vesting | `cargo audit --file vesting/Cargo.lock --deny warnings --config audit.toml` |

Both invocations use `--deny warnings`, so any RUSTSEC advisory that is not listed in `audit.toml` fails the step. The `audit.toml` allowlist lives at the repository root; see [`docs/development/SECURITY-AUDITS.md`](SECURITY-AUDITS.md) for its format and how to add an exception.

### npm-audit job

Runs on `ubuntu-latest`.

| Package root | Command |
| --- | --- |
| `.` (repo root) | `npm audit --audit-level=high --omit=dev` |
| `frontend/` | `npm audit --audit-level=high --omit=dev` |
| `scripts/` | `npm audit --audit-level=high --omit=dev` |

`--omit=dev` restricts the audit to production dependencies. Any finding at severity `high` or above fails the step. There is no npm allowlist — resolve or pin away from a vulnerable package rather than suppressing the finding.
Pull requests run the checks below automatically where a workflow exists; run the same commands locally before opening a PR.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`docker-smoke.yml`](../../.github/workflows/docker-smoke.yml) | PRs touching `scripts/**` or the workflow itself | Builds the `scripts/Dockerfile` image, starts a mock Soroban RPC, runs a keeper `--dry-run --once` cycle, and verifies SIGTERM shutdown for the keeper, indexer and metrics containers. |

Everything else (contract, frontend, scripts typecheck/tests) is still enforced manually — there is no workflow for those yet.
This repository ships two GitHub Actions workflow files in `.github/workflows/`:

| Workflow | File | Triggers |
| --- | --- | --- |
| Contract CI | `.github/workflows/contract.yml` | PRs and pushes to `main` touching `contract/` |
| Frontend CI | `.github/workflows/frontend.yml` | PRs and pushes to `main` touching `frontend/` |

Both workflows must pass before a PR can be merged. Failing `clippy` or a type error blocks the PR.

---

## Contributor checklist

Run these locally before opening a PR. The CI workflows mirror them exactly; failing locally is faster feedback than waiting for CI.

| If you changed… | Run locally |
| --- | --- |
| Rust workspace | `cargo clippy --workspace && cargo test --workspace` (or `npm run backend:test` / `npm run backend:vesting:test`) |
| `frontend/` | `npm run typecheck`, then `cd frontend && npm run lint && npm run test && npm run build` |
| `scripts/` | `cd scripts && npm run typecheck && npm run lint && npm run lint:duplicates && node lint-duplicates.mjs && NODE_OPTIONS=--experimental-sqlite npm test` |
| Any `*.md` file | `node check-doc-links.mjs` (see [docs/README.md § Documentation tooling](../README.md#documentation-tooling)) |
| Rust dependencies | `cargo audit --file contract/Cargo.lock --config audit.toml` and `cargo audit --file vesting/Cargo.lock --config audit.toml` (see [SECURITY-AUDITS.md](SECURITY-AUDITS.md)) |
| npm dependencies | `npm audit --audit-level=high --omit=dev` in the relevant package directory |

`cargo test` also runs the benchmark tests in `contract/src/bench.rs` (they are plain `#[test]` functions), so a benchmark that exceeds its `MAX_*_INSTRUCTIONS` threshold fails the local test run. See [PERFORMANCE-BENCHMARKING.md](PERFORMANCE-BENCHMARKING.md).

The CI workflows do not replace local checks — they are a safety net. Running locally before pushing catches problems before they block other contributors.

---

## Contract (Rust)

```bash
rustup target add wasm32-unknown-unknown
cargo clippy --workspace
cargo build --workspace
cargo test --workspace
```

## Frontend

```bash
cd frontend
npm ci
npm run lint
npx prettier --check .
npm run typecheck
npm run test     # Vitest
npm run build    # tsc && vite build
```

## Scripts (TypeScript)

```bash
cd scripts
npm ci
npm run typecheck
npm run lint
npm run lint:duplicates
node lint-duplicates.mjs
NODE_OPTIONS=--experimental-sqlite npm test
```

See also [`docs/ONBOARDING.md`](../ONBOARDING.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
