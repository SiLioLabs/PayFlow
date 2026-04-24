# Contributing to FlowPay

Thank you for considering a contribution to FlowPay. This document covers everything you need to know to get your changes merged cleanly.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Good First Issues](#good-first-issues)
- [Development Setup](#development-setup)
- [Branching & Workflow](#branching--workflow)
- [Contract Contribution Guidelines](#contract-contribution-guidelines)
- [Frontend Contribution Guidelines](#frontend-contribution-guidelines)
- [Commit Style](#commit-style)
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

| Task | Area | Difficulty |
| --- | --- | --- |
| Add USDC / custom SAC token support | Contract | Medium |
| Build a Node.js keeper service that calls `charge()` on a schedule | Backend | Medium |
| Add subscription pause/resume functions | Contract | Medium |
| Improve frontend error messages with human-readable contract panics | Frontend | Easy |
| Add `test_pay_per_use` unit test | Contract | Easy |
| Add `test_double_initialize` unit test | Contract | Easy |
| Display transaction history using contract events | Frontend | Hard |

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

# Run tests
cd contract
cargo test
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in VITE_CONTRACT_ID
npm run dev
```

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

- All contract calls must go through `src/stellar.ts` — React components should never import `@stellar/stellar-sdk` directly
- Do not add external UI component libraries — keep the bundle minimal
- Use TypeScript strictly — no `any` unless absolutely necessary and commented
- Keep components small and focused on a single responsibility
- Run `npm run lint` to check for ESLint errors before submitting
- Run `npm run format` to auto-format all source files with Prettier
- Run `npm run build` to confirm there are no TypeScript errors before submitting

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

## Pull Request Checklist

Before opening a PR, confirm:

- [ ] `cargo test` passes (contract changes)
- [ ] `npm run lint` passes with no errors (frontend changes)
- [ ] `npm run build` passes (frontend changes)
- [ ] New functions have tests
- [ ] No secrets or `.env` files committed
- [ ] PR description explains what changed and why
- [ ] Linked to a relevant issue if one exists

---

## Questions

Open a GitHub Discussion or leave a comment on the relevant issue. We're happy to help you get unstuck.
