# Contributing to FlowPay

Thank you for considering a contribution to FlowPay. This document covers everything you need to know to get your changes merged cleanly.

> **New to the project?** If this is your first contribution, start with [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — a step-by-step walkthrough from environment setup to your first merged PR. Backend/keeper contributors: see [§2.5 Backend / scripts path](docs/ONBOARDING.md#25-backend--scripts-path-keeper--indexer). Come back here as the reference once you're up and running.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Good First Issues](#good-first-issues)
- [Development Setup](#development-setup)
- [CI workflows](#ci-workflows)
- [Branching & Workflow](#branching--workflow)
- [Contract Contribution Guidelines](#contract-contribution-guidelines)
- [Frontend Contribution Guidelines](#frontend-contribution-guidelines)
- [Dependency Management](#dependency-management)
- [Commit Style](#commit-style)
- [Generated TypeScript Bindings](#generated-typescript-bindings)
- [Documentation Naming Convention](#documentation-naming-convention)
- [Changelog and versioning](#changelog-and-versioning)
- [Pull Request Checklist](#pull-request-checklist)
- [Questions](#questions)

---

## Code of Conduct

Be respectful. We welcome contributors of all experience levels. Harassment, gatekeeping, or dismissive behaviour will not be tolerated.

---

## Ways to Contribute

- Fix a bug (open an issue first if it's non-trivial)
- Add a feature from the roadmap
- Improve documentation or fix typos
- Write additional contract tests
- Build a keeper/scheduler service
- Review open pull requests

---

## Good First Issues

These are well-scoped tasks that don't require deep knowledge of the whole codebase:

| Task                                                                | Area     | Difficulty |
| ------------------------------------------------------------------- | -------- | ---------- |
| Add USDC / custom SAC token support                                 | Contract | Medium     |
| Build a Node.js keeper service that calls `charge()` on a schedule  | Backend  | Medium     |
| Add subscription pause/resume functions                             | Contract | Medium     |
| Improve frontend error messages with human-readable contract panics | Frontend | Easy       |
| Add `test_pay_per_use` unit test                                    | Contract | Easy       |
| Add `test_double_initialize` unit test                              | Contract | Easy       |
| Display transaction history using contract events                   | Frontend | Hard       |

---

## Development Setup

### Contract

```bash
# Install Rust
curl https://sh.rustup.rs -sSf | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli

# Run all contract tests from the Cargo workspace root
cargo test --workspace

# Or test one contract package
cargo test -p flowpay
cargo test -p academy-vesting
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in VITE_CONTRACT_ID
npm run dev
```

### Scripts (keeper / indexer / ops)

```bash
cd scripts
npm install
cp .env.example .env   # Testnet placeholders only — never commit secrets
npm run typecheck
```

See [`scripts/README.md`](scripts/README.md) and [`docs/ONBOARDING.md`](docs/ONBOARDING.md#25-backend--scripts-path-keeper--indexer).

---

## CI workflows

Two GitHub Actions workflows run automatically on every PR and push to `master`:

- **`scripts-ci.yml`** — runs TypeScript typecheck, ESLint lint, duplicate lint (`npm run lint:duplicates` and `node lint-duplicates.mjs`), and Vitest tests for the `scripts/` package, with Node 22 and `NODE_OPTIONS=--experimental-sqlite`.
- **`security-audit.yml`** — runs `cargo audit` against `contract/Cargo.lock` and `vesting/Cargo.lock`, and `npm audit --omit=dev` for the root, `frontend/`, and `scripts/` packages; also runs on a weekly schedule (every Monday). High-severity dependency vulnerabilities block the PR.

See [`docs/development/CI-WORKFLOWS.md`](docs/development/CI-WORKFLOWS.md) for the full command reference and local equivalents.

---

## Branching & Workflow

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```
3. Make your changes
4. Run tests — they must all pass before opening a PR
5. Push your branch and open a Pull Request against `main`

Branch naming conventions:

- `feat/` — new feature
- `fix/` — bug fix
- `docs/` — documentation only
- `test/` — adding or improving tests
- `refactor/` — code changes with no behaviour change

---

## Contract Contribution Guidelines

- Keep `#![no_std]` — Soroban contracts cannot use the Rust standard library
- Every new public function **must** have at least one test in `test.rs`
- Any function that moves funds or mutates user state **must** call `user.require_auth()`
- Use `env.storage().persistent()` for user data, `env.storage().instance()` for contract-wide config
- Emit an event via `env.events().publish()` for every state-changing action
- Do not introduce floating point — use integer arithmetic in stroops (1 XLM = 10,000,000 stroops)
- Run `cargo clippy` and resolve all warnings before submitting

---

## Frontend Contribution Guidelines

See the full guide: [`docs/CONTRIBUTING-FRONTEND.md`](docs/CONTRIBUTING-FRONTEND.md).

- All contract calls must go through `src/stellar.ts` — React components should never import `@stellar/stellar-sdk` directly
- Do not add external UI component libraries — keep the bundle minimal
- Use TypeScript strictly — no `any` unless absolutely necessary and commented
- Keep components small and focused on a single responsibility
- Run `npm run lint` to check for ESLint errors before submitting
- Run `npm run format` to auto-format all source files with Prettier
- Run `npm run build` to confirm there are no TypeScript errors before submitting

---

## Dependency Management

PayFlow uses **Dependabot** to automatically create pull requests for dependency updates on a weekly schedule. See [Dependency Management Policy](docs/DEPENDENCIES.md) for full details.

### For PRs Triggered by Dependabot

1. **Review the changes**: Check the release notes or changelog for breaking changes
2. **Run tests**: Verify all tests pass locally
3. **Update documentation**: If there are API changes, update relevant docs
4. **Approve & merge**: If tests pass and changes are compatible, approve the PR

### Adding New Dependencies

When adding new dependencies:

1. Use exact or pinned versions initially (e.g., `soroban-sdk = "21.0.0"` or `"^12.0.0"`)
2. Document why the dependency is needed in your PR description
3. Ensure it aligns with the project's tech stack (Rust/Soroban for contract, React/TypeScript for frontend)
4. Dependabot will automatically manage updates from that point forward

See [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) for the full policy.

---

## Commit Style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add pause/resume subscription functions
fix: prevent double-initialize on contract
docs: expand DEPLOYMENT.md with mainnet steps
test: add pay_per_use unit test
refactor: extract token client helper in lib.rs
```

---

## Generated TypeScript Bindings

FlowPay uses auto-generated TypeScript types derived directly from the Soroban contract ABI. These bindings live at:

```
frontend/src/generated/contract.ts
```

### Purpose

Generated bindings provide compile-time type safety for every contract call made from the frontend. Instead of manually defining TypeScript interfaces that mirror the contract's public API, the `soroban contract bindings typescript` command reads the contract's ABI and produces accurate type definitions automatically.

### Why This Matters — Preventing ABI Drift

When the contract adds a new function, changes a parameter type, or renames a field, the generated bindings update automatically. Without them, the frontend types would silently diverge from the contract (ABI drift), causing runtime errors that TypeScript cannot catch. Regenerating bindings after every contract change ensures the compiler catches mismatches immediately.

### When to Regenerate

Re-run the binding generator whenever:

- You add, remove, or rename a public contract function
- You change the signature (parameters or return type) of any public function
- You modify any struct or enum that appears in the contract's public interface
- You deploy a new version of the contract

To regenerate:

```bash
npm run generate:types
```

This invokes `scripts/generate-types.sh`, which requires either:

- `CONTRACT_ID` env var pointing to a deployed contract, or
- A compiled WASM artifact at `target/wasm32-unknown-unknown/release/flowpay.wasm`

### Output Location

All generated files are written to `frontend/src/generated/`. Do not manually edit files in this directory — they will be overwritten on the next generation run.

---

## Documentation Naming Convention

All Markdown files under `docs/` use `UPPER-KEBAB.md`: uppercase letters and digits joined by hyphens, ending in `.md` (e.g. `DEPLOYMENT.md`, `TWO-STEP-AUTH.md`, `TESTING-RUNBOOK.md`). This is enforced by `node check-doc-links.mjs`, which fails on any `docs/**/*.md` file that does not match `^[A-Z0-9]+(-[A-Z0-9]+)*\.md$`.

When adding a new doc:

- Name it `UPPER-KEBAB.md` and place it in the matching subdirectory (`architecture/`, `development/`, `frontend/`, `operations/`, `security/`, `spec/`) or at the top level of `docs/`.
- Link it from [`docs/README.md`](docs/README.md) — files under `docs/` that nothing links to are reported as orphans and also fail the check.
- Rename with `git mv` so history is preserved, then update every link target (the checker validates all relative links and `#anchor`s).

Rationale: one convention keeps links greppable and avoids case-sensitivity surprises across macOS/Windows/Linux checkouts (see issue #1500).

## Changelog and versioning

Keep [`CHANGELOG.md`](CHANGELOG.md) in Keep a Changelog format with `[Unreleased]` at the top and category headings for `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.

Use SemVer for a release: MAJOR for incompatible contract/ABI changes, MINOR for backward-compatible additions, and PATCH for behavior fixes. Any storage schema or migration change must state the old and current schema versions and whether existing deployments require `migrate(users)`.

Prefix incompatible contract changes with `**BREAKING**`. Include the affected public function or storage field and the required off-chain or deployment action. Update [docs/API.md](docs/API.md) and run `node scripts/check-contract-api.mjs` when public contract functions change.

---

## Pull Request Checklist

Before opening a PR, confirm:

- [ ] `cargo test` passes (contract changes)
- [ ] `npm run lint` passes with no errors (frontend changes)
- [ ] `npm run build` passes (frontend changes)
- [ ] `npm run docs:check-all` passes (documentation changes)
- [ ] New functions have tests
- [ ] No secrets or `.env` files committed
- [ ] PR description explains what changed and why
- [ ] Linked to a relevant issue if one exists
- [ ] CI passes (scripts-ci and security-audit workflows green)

For documentation changes, see [Documentation Guards](docs/DOC-GUARDS.md) for details on running checks locally.

---

## Questions

Open a GitHub Discussion or leave a comment on the relevant issue. We're happy to help you get unstuck.
