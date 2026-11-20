# PayFlow Documentation

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
- [Frontend integration guide](integrations/frontend_integration.md)
- [Subscriber lifecycle guide](SUBSCRIBER-LIFECYCLE.md)
- [Daily spending limits](DAILY-LIMITS.md)
- [Multi-token architecture](MULTI-TOKEN.md)
- [Referral system](REFERRALS.md) (canonical; [REFERRAL.md](REFERRAL.md) is a compatibility stub)
- [Compliance and audit trails](COMPLIANCE.md)

## Understanding the contract

- [Contract API reference](API.md)
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
| `cd scripts && npx tsx lint-duplicates.ts` (or `npm run lint:duplicates`) | Every script under `scripts/` parses and has no duplicate declarations or object keys (baseline in `scripts/.duplicate-lint-baseline.json`). |
| `cd scripts && node lint-duplicates.mjs` | No `.ts` file under `scripts/` has two non-type imports from the same module. |

Copy-paste all of the root-level checks at once:

```bash
node check-doc-links.mjs
node scripts/emit-caps-table.mjs --check
node scripts/gen-undocumented-scripts.mjs --check
node scripts/check-quicklinks.mjs
node scripts/check-error-codes.mjs
```
