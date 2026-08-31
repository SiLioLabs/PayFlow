# CI Workflows — Current Behavior and Recommendations

This document describes what GitHub Actions **enforces today** on pull requests to `master`, and provides copy-pastable **recommended** YAML for checks that are not yet wired (frontend Vitest, scripts TypeScript typecheck). Implementing the recommended blocks is tracked separately (backend scripts CI — issue #087); this doc does **not** merge those workflow changes by itself.

Workflow files live under [`.github/workflows/`](../../.github/workflows/).

---

## Summary

| Area | Workflow file | Enforced today | Recommended (not merged here) |
| --- | --- | --- | --- |
| Contract (Rust) | `rust.yml` | clippy, build, `cargo test` | — |
| Frontend | `frontend.yml` | ESLint, Prettier check, `tsc`+Vite build | Vitest unit tests (`npm run test`) |
| Scripts (TypeScript) | *(none)* | nothing | `npm run typecheck` in `scripts/` |

---

## Backend (Rust) — enforced

**File:** [`.github/workflows/rust.yml`](../../.github/workflows/rust.yml)

**Triggers:** `push` and `pull_request` to `master`.

**Job `build`** (`runs-on: ubuntu-latest`, default `working-directory: contract`):

| Step | Command | Purpose |
| --- | --- | --- |
| Checkout | `actions/checkout@v4` | Clone repo |
| WASM target | `rustup target add wasm32-unknown-unknown` | Soroban build target |
| Clippy | `cargo clippy -- -D warnings` | Lint (warnings fail) |
| Build | `cargo build --verbose` | Compile contract |
| Test | `cargo test --verbose` | Full contract test suite (includes benchmarks as tests) |

**Local equivalent:**

```bash
cd contract
rustup target add wasm32-unknown-unknown
cargo clippy -- -D warnings
cargo test
```

---

## Frontend — enforced vs gap

**File:** [`.github/workflows/frontend.yml`](../../.github/workflows/frontend.yml)

**Triggers:** `push` and `pull_request` to `master`.

**Job `build`** (`working-directory: frontend`, **Node 20**, npm cache on `frontend/package-lock.json`):

| Step | Command | Enforced |
| --- | --- | --- |
| Install | `npm ci` | yes |
| Lint | `npm run lint` | yes |
| Format | `npx prettier --check .` | yes |
| Build | `npm run build` (`tsc && vite build`) | yes |
| **Unit tests** | `npm run test` / Vitest | **no — not in workflow** |

Vitest is installed (`vitest` in `devDependencies`, `vitest.config.ts` present) but **`frontend/package.json` does not define a `test` script on all branches** and CI does not invoke Vitest. Contributors must run tests locally before opening a PR; do not assume CI catches frontend unit test regressions.

**Local equivalent (recommended before every frontend PR):**

```bash
cd frontend
npm ci
npm run lint
npx prettier --check .
npm run build
npm run test    # add script below if missing
```

### Recommended: add Vitest to `frontend.yml`

**Prerequisite** — ensure `frontend/package.json` includes:

```json
"scripts": {
  "test": "vitest --run --config vitest.config.ts"
}
```

**Insert after the Format check step** in `.github/workflows/frontend.yml`:

```yaml
      - name: Unit tests (Vitest)
        run: npm run test
```

Full recommended job for clarity (enforced steps unchanged; **new** step marked):

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Format check
        run: npx prettier --check .
      - name: Unit tests (Vitest)   # RECOMMENDED — not enforced today
        run: npm run test
      - name: Build
        run: npm run build
```

**Acceptance criteria when adopted:** PRs fail if any Vitest test fails; Node 20 and cache path match existing workflow.

---

## Scripts (TypeScript) — not enforced

There is **no** GitHub Actions workflow for `scripts/` today. Backend ops code is validated only by local runs and review.

**Package script** (already in [`scripts/package.json`](../../scripts/package.json)):

```json
"typecheck": "tsc --noEmit"
```

**Local equivalent:**

```bash
cd scripts
npm ci
npm run typecheck
```

### Recommended: new `scripts.yml` workflow

Create [`.github/workflows/scripts.yml`](../../.github/workflows/scripts.yml):

```yaml
name: Scripts (TypeScript)

on:
  push:
    branches: ["master"]
  pull_request:
    branches: ["master"]

defaults:
  run:
    working-directory: scripts

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: scripts/package-lock.json
      - name: Install dependencies
        run: npm ci
      - name: Typecheck
        run: npm run typecheck
```

**Alternative:** append a second job to `frontend.yml` only if you prefer one Node workflow file — a dedicated `scripts.yml` keeps Rust/frontend/scripts boundaries clear (matches repo layout).

**Acceptance criteria when adopted:** PRs touching `scripts/` fail on `tsc --noEmit` errors; Node 20; cache path `scripts/package-lock.json`.

Related: issue **#087** (scripts CI implementation).

---

## Contributor checklist

| If you changed… | Run locally | CI enforces today |
| --- | --- | --- |
| `contract/` | `cargo clippy -- -D warnings && cargo test` | yes |
| `frontend/` | `npm run lint && npx prettier --check . && npm run build` (+ `npm run test` recommended) | lint, format, build only |
| `scripts/` | `npm run typecheck` | no |

See also [`docs/ONBOARDING.md`](../ONBOARDING.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
