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
