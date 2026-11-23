# CI Workflows — Local Checks

Pull requests run the checks below automatically where a workflow exists; run the same commands locally before opening a PR.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`docker-smoke.yml`](../../.github/workflows/docker-smoke.yml) | PRs touching `scripts/**` or the workflow itself | Builds the `scripts/Dockerfile` image, starts a mock Soroban RPC, runs a keeper `--dry-run --once` cycle, and verifies SIGTERM shutdown for the keeper, indexer and metrics containers. |

Everything else (contract, frontend, scripts typecheck/tests) is still enforced manually — there is no workflow for those yet.

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
