# PayFlow Documentation

This is the documentation index for PayFlow (FlowPay) — decentralized subscriptions and recurring payments on Stellar (Soroban).

Use this page to navigate the guides under `docs/`. Every link below resolves to a file in this repository; if you find a link that does not resolve, run [`check-doc-links.mjs`](../check-doc-links.mjs) from the repository root to surface it.

## Project overview

| Document | Purpose |
|----------|---------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, storage tiers, module map, TTL strategy |
| [`API.md`](API.md) | Full contract function reference (auth, errors, events) |
| [`SECURITY.md`](SECURITY.md) | Security model, threat model, auth matrix, responsible disclosure |
| [`DAILY-LIMITS.md`](DAILY-LIMITS.md) | Per-user daily spending caps for `pay_per_use` / `pay_per_use_to` |
| [`limits.md`](limits.md) | Batch and pagination caps enforced by the contract |
| [`TESTING.md`](TESTING.md) | Running contract, frontend, and scripts tests |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Deploy pipeline and health gates |
| [`MAINNET-DEPLOYMENT.md`](MAINNET-DEPLOYMENT.md) | Mainnet go-live checklist |
| [`REFERRALS.md`](REFERRALS.md) | Referral system — data model, subscribe auth, self-referral, events, frontend |
| [`FRONTEND.md`](FRONTEND.md) | Frontend architecture guide |
| [`FRONTEND-COMPONENTS.md`](FRONTEND-COMPONENTS.md) | Frontend component reference (props, hooks, services) |
| [`KEEPER.md`](KEEPER.md) | Keeper runtime, flags, and configuration |
| [`ONBOARDING.md`](ONBOARDING.md) | Contributor onboarding walkthrough |

## Integrations

| Document | Purpose |
|----------|---------|
| [`integrations/frontend_integration.md`](integrations/frontend_integration.md) | Frontend integration guide — read-only vs authenticated invocations, subscription status enums, paginated index processing, client-side rendering patterns, error handling, best practices |

This guide is aligned with [`FRONTEND.md`](FRONTEND.md) and the codebase under `frontend/src/` (notably `stellar.ts` and `frontend/src/components`).

## Development

| Document | Purpose |
|----------|---------|
| [`development/ci-workflows.md`](development/ci-workflows.md) | Current CI behavior and recommended Vitest / scripts typecheck YAML |
| [`development/network-matrix.md`](development/network-matrix.md) | Aligning frontend, scripts, and contract tests on the same network |
| [`development/performance-benchmarking.md`](development/performance-benchmarking.md) | Contract benchmark interpretation and regression detection |
| [`development/testing_runbook.md`](development/testing_runbook.md) | Contract test patterns: ledger time, mocking, panic testing |

## Operations

| Document | Purpose |
|----------|---------|
| [`operations/keeper_runbook.md`](operations/keeper_runbook.md) | Keeper runbook |
| [`operations/troubleshooting.md`](operations/troubleshooting.md) | Troubleshooting runbook |
| [`operations/two_step_admin_playbooks.md`](operations/two_step_admin_playbooks.md) | Two-step admin playbooks |

## Security

| Document | Purpose |
|----------|---------|
| [`security/audit-preparation.md`](security/audit-preparation.md) | Security audit preparation guide |
| [`security/threat_matrix.md`](security/threat_matrix.md) | Threat matrix |

## Specification

| Document | Purpose |
|----------|---------|
| [`spec/lifecycle_spec.md`](spec/lifecycle_spec.md) | Subscription lifecycle specification |

## Root documents

| Document | Purpose |
|----------|---------|
| [`../README.md`](../README.md) | Project overview (what it is, architecture, quickstart, license) |
| [`../SECURITY.md`](../SECURITY.md) | Security policy / vulnerability reporting |

## Contributing

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the contract- and frontend-specific guides linked from it.
Start here. Documents are grouped by what you are trying to do; every Markdown file under `docs/` is linked from this page.

## Getting started

- [Onboarding: first issue to first PR](ONBOARDING.md)
- [Testnet quickstart: deploy → subscribe → charge → withdraw (10 min)](TESTNET-QUICKSTART.md)
- [Subscriber & merchant FAQ](FAQ.md)
- [Project structure](STRUCTURE.md) — what lives where in the repository
- [Glossary](GLOSSARY.md)

## Integrating as a merchant or dApp

- [Integration guide](INTEGRATION-GUIDE.md) — end-to-end developer walkthrough
- [Merchant integration cookbook](MERCHANT-INTEGRATION.md)
- [Event-driven integration cookbook](EVENT-DRIVEN-GUIDE.md)
- [Webhook reference](WEBHOOKS.md) — payloads, headers, verification, retries, and DLQ
- [Frontend integration guide](FRONTEND.md)
- [Subscriber lifecycle guide](SUBSCRIBER-LIFECYCLE.md)
- [Daily spending limits](DAILY-LIMITS.md)
- [Multi-token architecture](MULTI-TOKEN.md)
- [Referral system](REFERRALS.md) (canonical; [REFERRAL.md](REFERRAL.md) is a compatibility stub)
- [Compliance and audit trails](COMPLIANCE.md)

## Understanding the contract

- [Contract API reference](API.md)
- [Academy vesting crate](../vesting/README.md)
- [Architecture](ARCHITECTURE.md)
- [Events reference](EVENTS.md)
- [Error codes and recovery playbook](ERROR-CODES.md)
- [Batch and pagination caps](LIMITS.md)
- [`ChargeResult` wire encoding](CHARGE-RESULTS.md) and [`CancelResult` wire encoding](CANCEL-RESULTS.md)
- [Subscription lifecycle state specification](spec/LIFECYCLE-SPEC.md)
- Architecture deep-dives:
  - [Storage and TTL management](architecture/STORAGE-AND-TTL.md)
  - [Two-step authorization flows](architecture/TWO-STEP-AUTH.md)
  - [Pause lifecycle](architecture/PAUSE-LIFECYCLE.md)
  - [`batch_charge` estimate vs live execution](architecture/BATCH-ESTIMATE-VS-LIVE.md)

## Running the keeper and operating a deployment

- [Keeper runbook](KEEPER.md) — runtime, flags and configuration for `keeper.ts`
- [Keeper bot operations handbook](operations/KEEPER-RUNBOOK.md)
- [Troubleshooting runbook](operations/TROUBLESHOOTING.md)
- [Two-step admin operator playbooks](operations/TWO-STEP-ADMIN-PLAYBOOKS.md)
- [Scripts environment variable reference](SCRIPTS-ENVIRONMENT.md)
- [Scripts reference](../scripts/README.md) and [operational fixes](../scripts/README-OPERATIONAL-FIXES.md)
- [Deployment guide](DEPLOYMENT.md)
- [Mainnet deployment checklist](MAINNET-DEPLOYMENT.md)

## Frontend

- [Frontend architecture guide](FRONTEND.md)
- [Frontend component reference](FRONTEND-COMPONENTS.md)
- [Frontend component inventory](frontend/COMPONENTS.md)

## Security

- [Security model](SECURITY.md)
- [Security specification and threat matrix](security/THREAT-MATRIX.md)
- [Security audit preparation](security/AUDIT-PREPARATION.md)
- Vulnerability disclosure policy: [SECURITY.md](../SECURITY.md)

## Contributing and testing

- [Contributing guide](../CONTRIBUTING.md)
- [Contributing to the contract](CONTRIBUTING-CONTRACT.md)
- [Contributing to the frontend](CONTRIBUTING-FRONTEND.md)
- [Testing guide](TESTING.md)
- [Development testing runbook](development/TESTING-RUNBOOK.md)
- [Local checks to run before a PR](development/CI-WORKFLOWS.md)
- [Local development network matrix](development/NETWORK-MATRIX.md)
- [Performance benchmarking](development/PERFORMANCE-BENCHMARKING.md)
- [Changelog](../CHANGELOG.md)

## Documentation tooling

These checks keep the docs in sync with the code. Run them from the repository root unless noted; each exits non-zero on failure.

| Command | What it checks |
| --- | --- |
| `node check-doc-links.mjs` | Every relative link and `#anchor` in every Markdown file resolves; reports orphaned Markdown files (orphans under `docs/` fail — link them from this page); enforces `UPPER-KEBAB.md` filenames under `docs/` (see [CONTRIBUTING.md](../CONTRIBUTING.md#documentation-naming-convention)). |
| `node scripts/emit-caps-table.mjs --check` | [LIMITS.md](LIMITS.md) matches the constants in `contract/src/caps.rs`. Drop `--check` to print the table. |
| `node scripts/gen-undocumented-scripts.mjs --check` | The generated script-reference block in [scripts/README.md](../scripts/README.md) matches the flags and env vars the scripts read. Drop `--check` to print the block. |
| `node scripts/check-quicklinks.mjs` | The quick-link table in [scripts/README.md](../scripts/README.md) points at the correct heading anchors. |
| `node scripts/check-error-codes.mjs` | [ERROR-CODES.md](ERROR-CODES.md) lists every code in `contract/src/errors.rs`, with no duplicates. |
| `npm run check:contract-api` | [API.md](API.md) references every public `pub fn` in `contract/src/lib.rs`. |
| `cd scripts && npx tsx lint-duplicates.ts` (or `npm run lint:duplicates`) | Every script under `scripts/` parses and has no duplicate declarations or object keys (baseline in `scripts/.duplicate-lint-baseline.json`). |
| `cd scripts && node lint-duplicates.mjs` | No `.ts` file under `scripts/` has two non-type imports from the same module. |

Copy-paste all of the root-level checks at once:

```bash
node check-doc-links.mjs
node scripts/emit-caps-table.mjs --check
node scripts/gen-undocumented-scripts.mjs --check
node scripts/check-quicklinks.mjs
node scripts/check-error-codes.mjs
npm run check:contract-api
```
