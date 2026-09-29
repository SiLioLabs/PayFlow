# FlowPay Scripts — Environment Variable Reference

> **Source of truth:** [`scripts/config.ts`](../scripts/config.ts) — this document is generated from the Zod schema in that file. Keep them in sync.

## Canonical Variables

| Variable | Required | Type | Constraints / Default | Used By | Purpose |
| --- | --- | --- | --- | --- | --- |
| `CONTRACT_ID` | Yes | string | Non-empty; starts with `C`; 56-char base32 | All scripts | Deployed FlowPay contract ID |
| `RPC_URL` | Yes | string | Valid http/https URL | All scripts | Soroban RPC endpoint |
| `SECRET_KEY` | Yes* | string | Stellar secret key: starts with `S`, 56 chars | keeper | Keeper signing key (live mode) |
| `KEEPER_PUBLIC_KEY` | Yes | string | Stellar public key: starts with `G`, 56 chars | keeper | Source account public key |
| `BATCH_SIZE` | No | integer (coerce) | 1–200; default `50` | keeper | Subscriptions per `batch_charge` call |
| `INTERVAL_SECONDS` | No | integer (coerce) | ≥ 60; default `3600` | keeper | Seconds between charge cycles |
| `WEBHOOK_URL` | No | string | Valid http/https URL | alert-expiring-allowances, alert-failed-charges | Webhook POST target |
| `WEBHOOK_SECRET` | No | string | Non-empty if provided | alert-expiring-allowances, alert-failed-charges | HMAC-SHA256 signing key for webhooks |
| `WEBHOOK_DLQ_FILE` | No | string | File path | alert-expiring-allowances, alert-failed-charges | Dead-letter queue for failed webhooks |
| `NETWORK_PASSPHRASE` | No | string | Default: `Test SDF Network ; September 2015` | keeper, check-allowances | Stellar network passphrase |
| `DRY_RUN` | No | boolean | `"true"` enables; default `false` | keeper | Simulation mode (no live submissions) |
| `KEEPER_USE_LEGACY_PAGING` | No | boolean | `"true"` enables; default `false` | keeper | Use legacy sequential paging |
| `LOG_LEVEL` | No | string | `debug` \| `info` \| `warn` \| `error`; default `info` | keeper, indexer, health-check, alert-failed-charges | Log verbosity |
| `LOG_FORMAT` | No | string | `"json"` for JSON lines | keeper, indexer, health-check, alert-failed-charges | Log output format |
| `DATA_DIR` | No | string | Default `data` | indexer, query-events | SQLite database directory |
| `DB_FILE` | No | string | Default `DATA_DIR/events.db` | indexer, query-events | SQLite database path override |
| `POLL_INTERVAL_MS` | No | integer | Default `10000` | indexer | Event polling interval (ms) |
| `START_LEDGER` | No | integer | Unset → latest ledger | indexer | First-run start ledger |
| `METRICS_PORT` | No | integer | Default `9090` | metrics-server | HTTP listen port for `/metrics` |
| `REPORT_DIR` | No | string | Default `<script_dir>/data/benchmarks` | keeper | Dry-run reports & live-cycle pointer |
| `ALERT_WINDOW_LEDGERS` | No | integer | Default `17280` (~24h) | alert-expiring-allowances | Expiry alert threshold (ledgers) |
| `SOROBAN_SOURCE_ACCOUNT` | No | string | Stellar public key | deploy-pipeline, top-merchants | Source account for read-only RPC queries |

\* `SECRET_KEY` is required only in live mode (`DRY_RUN` not `"true"`).

## Deprecated Aliases (with fallback + warning)

| Deprecated Alias | Canonical Name | Status | Notes |
| --- | --- | --- | --- |
| `KEEPER_SECRET` | `SECRET_KEY` | Deprecated | Emits deprecation warning; canonical takes precedence if both set |
| `NETWORK_PASSTHRASE` | `NETWORK_PASSPHRASE` | Deprecated (typo) | Emits deprecation warning; canonical takes precedence if both set |

## Stale / Unread Variables (present in older examples, not read by current code)

| Variable | Status | Notes |
| --- | --- | --- |
| `CHARGE_INTERVAL_MS` | Stale | Listed in old `.env.example`; **not read** by current `keeper.ts` |
| `PAGE_SIZE` | Stale | Listed in old `.env.example`; **not read** by current `keeper.ts` |
| `MAX_RETRIES` | Stale | Listed in old `.env.example`; **not read** by current `keeper.ts` |

## Script-to-Variable Matrix

| Script | Reads These Variables |
| --- | --- |
| `keeper.ts` | `CONTRACT_ID`, `RPC_URL`, `RPC_URLS`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY`, `DRY_RUN`, `BATCH_SIZE`, `INTERVAL_SECONDS`, `KEEPER_USE_LEGACY_PAGING`, `NETWORK_PASSPHRASE`/`NETWORK_PASSTHRASE`, `LOG_LEVEL`, `LOG_FORMAT`, `REPORT_DIR`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_DLQ_FILE`, `ALERT_WINDOW_LEDGERS` |
| `indexer.ts` | `CONTRACT_ID`, `RPC_URL`, `RPC_URLS`, `DATA_DIR`, `DB_FILE`, `POLL_INTERVAL_MS`, `START_LEDGER`, `LOG_LEVEL`, `LOG_FORMAT` |
| `metrics-server.ts` | `METRICS_PORT` |
| `deploy-pipeline.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT`, `NETWORK_PASSPHRASE` |
| `pre-upgrade-check.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT`, `NETWORK_PASSPHRASE` |
| `top-merchants.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT`, `NETWORK_PASSPHRASE` |
| `check-allowances.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `KEEPER_PUBLIC_KEY` |
| `alert-expiring-allowances.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `KEEPER_PUBLIC_KEY`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `ALERT_WINDOW_LEDGERS` |
| `health-check.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `HEALTH_DEEP` |
| `subscription-snapshot.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `daily-revenue-summary.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT`, `WEBHOOK_URL`, `SLACK_WEBHOOK_URL` |
| `export-merchant-report.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `watch-events.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE` |
| `query-events.ts` | `CONTRACT_ID`, `DATA_DIR`, `DB_FILE` |
| `backup-indexer-db.ts` | `DATA_DIR`, `DB_FILE`, `BACKUP_DIR` |
| `replay-dlq.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY`, `DLQ_FILE` |
| `replay-events.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT`, `START_LEDGER` |
| `rotate-fee-collector.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY` |
| `migrate-contract.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY` |
| `onboard-merchant.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY` |
| `grace-period-monitor.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `alert-failed-charges.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY`, `WEBHOOK_URL`, `WEBHOOK_SECRET` |
| `batch-optimizer.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `churn-analysis.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `merchant-analytics.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `subscriber-churn-report.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `subscriber-health-dashboard.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `PAGE_SIZE`, `LEDGER_ENTRY_BATCH`, `EXPIRING_TTL_LEDGERS`, `PROGRESS` |
| `topup-allowance.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY` |
| `fee-revenue-report.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `audit-trail.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `snapshot-diff.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `renewal-forecast.ts` | `CONTRACT_ID`, `RPC_URL`, `SOROBAN_SOURCE_ACCOUNT` |
| `testnet-setup.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY` |
| `validate-config.ts` | All canonical variables (validates `.env`) |
| `soroban-admin.ts` | `CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY` |

## Validation Test

A parity test exists at [`scripts/config.test.ts`](../scripts/config.test.ts) that validates:
- Canonical names take precedence over deprecated aliases
- Deprecation warnings are emitted when aliases are used
- The Zod schema accepts valid values and rejects invalid ones

Run it with:
```bash
cd scripts && npm test -- --reporter=verbose config.test.ts
```