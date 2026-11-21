# CI Workflows — Local Checks

This repository does **not** ship any GitHub Actions workflow files (there is no `.github/workflows/` directory), so nothing is enforced automatically on pull requests. Every check below must be run locally before opening a PR.

---

## Contributor checklist

| If you changed… | Run locally (from the repo root) |
| --- | --- |
| `contract/` | `cd contract && cargo clippy -- -D warnings && cargo test` (or `npm run backend:test`) |
| `frontend/` | `npm run typecheck`, then `cd frontend && npm run lint && npm run test && npm run build` |
| `scripts/` | `npm run typecheck:scripts` and `npm run test:scripts` |
| Any `*.md` file | `node check-doc-links.mjs` (see [docs/README.md § Documentation tooling](../README.md#documentation-tooling)) |

`cargo test` also runs the benchmark tests in `contract/src/bench.rs` (they are plain `#[test]` functions), so a benchmark that exceeds its `MAX_*_INSTRUCTIONS` threshold fails the local test run. See [PERFORMANCE-BENCHMARKING.md](PERFORMANCE-BENCHMARKING.md).

---

## Contract (Rust)

```bash
cd contract
rustup target add wasm32-unknown-unknown
cargo clippy -- -D warnings
cargo build
cargo test
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
npm test
```

See also [`docs/ONBOARDING.md`](../ONBOARDING.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
