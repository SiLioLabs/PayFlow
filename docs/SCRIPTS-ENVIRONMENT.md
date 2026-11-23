# FlowPay Scripts — Environment Variable Reference

This is the single reference for every environment variable read by code under [`scripts/`](../scripts/). It is maintained by hand against the source; other documents (including [`scripts/README.md`](../scripts/README.md)) link here rather than restating it. For keeper-specific behaviour (batch-size resolution, DLQ, dry-run), see [KEEPER.md](KEEPER.md).

[`scripts/config.ts`](../scripts/config.ts) defines a Zod schema (`ConfigSchema`) that **validates** a subset of these variables (`CONTRACT_ID`, `RPC_URL`, `SECRET_KEY`, `BATCH_SIZE`, `INTERVAL_SECONDS`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_DLQ_FILE`, `NETWORK_PASSPHRASE`). It is used by `keeper.ts`, `validate-config.ts` and `smoke-config.ts`; most other scripts read `process.env` directly and are not schema-validated.

Many scripts accept a `VITE_`-prefixed fallback (`VITE_CONTRACT_ID`, `VITE_RPC_URL`, `VITE_NETWORK_PASSPHRASE`) so they can share `frontend/.env`; the [matrix](#script-to-variable-matrix) shows which.

## Shared variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONTRACT_ID` | none — required by every script that talks to the contract (`keeper-benchmark.ts` falls back to a placeholder ID) | Deployed FlowPay contract ID (`C…`, 56 chars) |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `RPC_URLS` | unset → single `RPC_URL` | Comma-separated RPC endpoints for failover; when set, takes priority over `RPC_URL` in every script that uses `rpc-client.ts` |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` (`Networks.TESTNET`) | Stellar network passphrase |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`, for every script using `logger.ts` (and `replay-dlq.ts`) |
| `LOG_FORMAT` | unset → human-readable | `json` for JSON-lines output (`logger.ts`) |
| `SOROBAN_SOURCE_ACCOUNT` | unset (`top-merchants.ts`: a fixed placeholder `G…` account) | Source account for read-only simulations |
| `ADMIN_SECRET_KEY` | none — required for admin-signed operations | Admin signing key, read by `loadSorobanConfig()` in `soroban-admin.ts` |
| `EVENT_DEDUP_CACHE_SIZE` | `1000` | Max entries in the event de-duplication LRU (`event-dedup.ts`) |
| `EVENT_DEDUP_TTL_MS` | `0` (no TTL) | Event de-duplication entry TTL in ms (`event-dedup.ts`) |

## Keeper (`keeper.ts`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `KEEPER_PUBLIC_KEY` | none — required, including dry-run | Source account public key (`G…`) |
| `SECRET_KEY` | none — required unless dry-run | Keeper signing key (`S…`). Deprecated alias: `KEEPER_SECRET` |
| `DRY_RUN` | `false` | Only `"true"` enables simulation mode (same as `--dry-run`) |
| `BATCH_SIZE` | on-chain `get_max_batch_size()`, else `50`; clamped to 1–200 | Batch size for the **legacy** paging path only — see [KEEPER.md § Batch size resolution](KEEPER.md#batch-size-resolution) |
| `KEEPER_USE_LEGACY_PAGING` | `false` | `"true"` uses sequential `offset` paging instead of `batch-optimizer.ts` |
| `INTERVAL_SECONDS` | `3600` | Seconds between charge cycles (schema requires ≥ 60) |
| `REPORT_DIR` | `<scripts>/data/benchmarks` | Dry-run reports and live-cycle pointer |
| `DLQ_FILE` | `dlq/failed-batches.jsonl` (relative to cwd) | Dead-letter queue for failed batches; also read by `replay-dlq.ts` |
| `MAX_BATCH_SIZE` | on-chain `get_max_batch_size()`, else `50` | Batch size for the default optimized path (`batch-optimizer.ts`) |
| `MAX_CYCLE_USERS` | unlimited | Max ready subscribers scheduled per cycle; the rest are deferred (`batch-optimizer.ts`) |
| `PAGE_SIZE` | `50`; clamped to 1–50 | Subscriber page size when listing via `get_subscriber_page` (`batch-optimizer.ts`, `subscriber-health-dashboard.ts`). It is **not** the `batch_charge` batch size |
| `METRICS_PORT` | `9090` | Prometheus `/metrics` listen port (`metrics-server.ts`, started by the keeper) |

## Script-specific variables

| Variable | Default | Read by | Purpose |
> **Source of truth:** [`scripts/config.ts`](../scripts/config.ts) — the canonical variables are validated by the Zod schema in that file. Keep them in sync.
>
> **The example file:** [`scripts/.env.example`](../scripts/.env.example) documents *every* variable read by a script under `scripts/`, including the ones that are not part of the Zod schema. It is the file `smoke-config.ts` and `validate-config.ts` check.

## Env file lookup

`scripts/validate-config.ts` looks for an env file in this order:

1. `scripts/.env.local`
2. `scripts/.env`
3. `<repo root>/.env.local`
4. `<repo root>/.env`
5. `scripts/.env.example` (fallback, so the shipped example can be checked in CI)

`--env-file <path>` validates an explicit file instead. The repository-root
`.env.example` documents the root tooling's variables only.

## Canonical Variables

| Variable | Required | Type | Constraints / Default | Used By | Purpose |
| --- | --- | --- | --- | --- | --- |
| `CONTRACT_ID` | Yes | string | Non-empty; starts with `C`; 56-char base32 | All scripts | Deployed FlowPay contract ID |
| `RPC_URL` | Yes | string | Valid http/https URL | All scripts | Soroban RPC endpoint |
| `SECRET_KEY` | Yes* | string | Stellar secret key: starts with `S`, 56 chars | keeper | Keeper signing key (live mode) |
| `KEEPER_PUBLIC_KEY` | Yes | string | Stellar public key: starts with `G`, 56 chars | keeper | Source account public key |
| `BATCH_SIZE` | No | integer (coerce) | 1–200; default `50` | keeper | Subscribers per `batch_charge` call. The 200 ceiling mirrors the contract’s `MAX_BATCH_SIZE_CEILING` (`contract/src/caps.rs`) |
| `INTERVAL_SECONDS` | No | integer (coerce) | ≥ 60; default `3600` | keeper | Seconds between charge cycles |
| `WEBHOOK_URL` | No | string | Valid http/https URL | alert-expiring-allowances, alert-failed-charges | Webhook POST target |
| `WEBHOOK_SECRET` | No | string | Non-empty if provided | alert-expiring-allowances, alert-failed-charges | HMAC-SHA256 signing key for webhooks |
| `WEBHOOK_DLQ_FILE` | No | string | File path | alert-expiring-allowances, alert-failed-charges | Dead-letter queue for failed webhooks |
| `NETWORK_PASSPHRASE` | No | string | Default: `Test SDF Network ; September 2015` | keeper, check-allowances | Stellar network passphrase |
| `ALLOW_MAINNET` | No | boolean | `"true"` required to use the mainnet passphrase; default `false` | keeper | Mainnet safety gate — startup fails if the mainnet passphrase is selected without it |
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

## Additional Variables (not part of the Zod schema)

These are read by individual scripts. They are documented with their
defaults in [`scripts/.env.example`](../scripts/.env.example).

| Variable | Type | Default | Used By | Purpose |
| --- | --- | --- | --- | --- |
| `ADMIN_SECRET_KEY` | string | — | soroban-admin, onboard-merchant | Admin signing key. Secret |
| `KEEPER_SECRET_KEY` | string | falls back to `SECRET_KEY` | keeper-benchmark | Benchmark signing key. Secret |
| `USER_SECRET` | string | — | topup-allowance | Subscriber signing key. Secret |
| `RPC_URLS` | string (CSV) | `RPC_URL` | rpc-client | Failover list of RPC endpoints |
| `DLQ_FILE` | string | `dlq/failed-batches.jsonl` | keeper, replay-dlq | Dead-letter queue path |
| `KEEPER_MAX_RETRIES` | integer | `3` | replay-dlq | Retry attempts per DLQ entry |
| `KEEPER_RETRY_BASE_MS` | integer | `1000` | replay-dlq | Base retry delay (ms) |
| `MAX_BATCH_SIZE` | integer | on-chain value, else `50` | batch-optimizer | Batch-size override (clamped to 200) |
| `MAX_CYCLE_USERS` | integer | unlimited | batch-optimizer | Ready subscribers scheduled per cycle |
| `PAGE_SIZE` | integer | `50` (max 50) | batch-optimizer, subscriber-health-dashboard | Subscriber page size |
| `TOKEN_ADDRESS` | string | — | topup-allowance | SAC token whose allowance is topped up |
| `USER_ADDRESS` | string | — | topup-allowance | Allowance owner |
| `AMOUNT` | string | — | topup-allowance | Allowance amount in stroops |
| `EXPIRY_LEDGERS` | integer | `17280` | topup-allowance | Ledgers the new allowance stays valid |
| `CONCURRENCY` | integer | `5` | alert-expiring-allowances, check-allowances | Parallel checks |
| `MAX_RETRIES` | integer | `3` | alert-expiring-allowances, check-allowances | Retry attempts |
| `RETRY_BASE_MS` | integer | `300` | alert-expiring-allowances, check-allowances | Base retry delay (ms) |
| `INDEXER_DB` | string | `indexer.db` | alert-failed-charges, churn-analysis | Indexer database path |
| `INDEXER_DB_PATH` | string | `data/events.db` | backup-indexer-db, churn-analysis, export-merchant-report | Indexer database path |
| `BACKUP_DIR` | string | `data/backups` | backup-indexer-db | Backup destination |
| `EVENT_DEDUP_TTL_MS` | integer | `0` | indexer, watch-events | Event dedup cache TTL (ms) |
| `EVENT_DEDUP_CACHE_SIZE` | integer | `10000` | event-dedup | Event dedup cache size |
| `EXPIRING_TTL_LEDGERS` | integer | `500000` | subscriber-health-dashboard | TTL considered `expiring` |
| `LEDGER_ENTRY_BATCH` | integer | `100` | subscriber-health-dashboard | Ledger entries per page |
| `GRACE_ALERT_THRESHOLD_PCT` | integer | `25` | grace-period-monitor | Grace-alert threshold (%) |
| `KEEPER_HEARTBEAT_PATH` | string | `<scripts>/data/keeper-heartbeat.json` | grace-period-monitor | Keeper heartbeat file |
| `ALERT_WEBHOOK_URL` | string | `WEBHOOK_URL` | grace-period-monitor | Grace-period alert target |
| `MERCHANT_ONBOARD_WEBHOOK_URL` | string | — | onboard-merchant | Onboarding result target |
| `SLACK_WEBHOOK_URL` | string | — | daily-revenue-summary | Daily revenue summary target |
| `FRIENDBOT_URL` | string | `https://friendbot.stellar.org` | testnet-setup | Testnet account funding |
| `NETWORK` | string | `testnet` | health-check | `mainnet` switches the passphrase |
| `HEALTH_DEEP` | boolean | `false` | health-check | Run the deep health checks |
| `DEBUG` | string | unset | watch-events | Verbose watch-events output |
| `PROGRESS` | string | unset | subscriber-health-dashboard | `0` disables progress output |
| `VITE_CONTRACT_ID` / `VITE_RPC_URL` / `VITE_NETWORK_PASSPHRASE` / `VITE_DEFAULT_TOKEN` | string | — | several | Frontend-style fallbacks |

## Deprecated Aliases (with fallback + warning)

| Deprecated Alias | Canonical Name | Status | Notes |
| --- | --- | --- | --- |
| `WEBHOOK_URL` | unset (required by `alert-failed-charges.ts`) | alert-expiring-allowances, alert-failed-charges, daily-revenue-summary, grace-period-monitor, watch-events | Webhook POST target |
| `ALERT_WEBHOOK_URL` | unset | grace-period-monitor | Fallback when `WEBHOOK_URL` is unset |
| `WEBHOOK_SECRET` | unset | watch-events | HMAC-SHA256 signing key for webhooks |
| `WEBHOOK_DLQ_FILE` | `data/webhook-dlq.jsonl` (relative to cwd) | watch-events | Dead-letter queue for failed webhooks |
| `SLACK_WEBHOOK_URL` | unset | daily-revenue-summary | Slack incoming-webhook target |
| `MERCHANT_ONBOARD_WEBHOOK_URL` | unset | onboard-merchant | Webhook notified after onboarding |
| `ALERT_WINDOW_LEDGERS` | `17280` (~24 h) | alert-expiring-allowances | Allowance-expiry alert threshold |
| `CONCURRENCY` | `5` | check-allowances, alert-expiring-allowances | Parallel RPC reads |
| `MAX_RETRIES` | `3` | check-allowances, alert-expiring-allowances | Retry attempts per transient error |
| `RETRY_BASE_MS` | `300` | check-allowances, alert-expiring-allowances | Base back-off delay |
| `KEEPER_MAX_RETRIES` | `3` | replay-dlq | Retry attempts per replayed batch |
| `KEEPER_RETRY_BASE_MS` | `1000` | replay-dlq | Base back-off delay |
| `KEEPER_SECRET` | none — required unless `--dry-run` | replay-dlq | Signing key. `replay-dlq.ts` reads only this name, not `SECRET_KEY` |
| `KEEPER_SECRET_KEY` | unset → `SECRET_KEY` | keeper-benchmark | Signing key for real (non-simulated) runs |
| `DATA_DIR` | `data` | indexer, query-events, renewal-forecast | SQLite database directory |
| `DB_FILE` | `<DATA_DIR>/events.db` | indexer, query-events, renewal-forecast | SQLite database path override |
| `POLL_INTERVAL_MS` | `10000` | indexer | Event polling interval |
| `START_LEDGER` | unset → latest ledger | indexer | First-run start ledger |
| `INDEXER_DB_PATH` | `data/events.db` (churn-analysis: falls back to `INDEXER_DB`) | backup-indexer-db, export-merchant-report, churn-analysis | Indexer SQLite path |
| `INDEXER_DB` | `indexer.db` | alert-failed-charges, daily-revenue-summary, churn-analysis | Indexer SQLite path (`--db` overrides) |
| `BACKUP_DIR` | `data/backups` | backup-indexer-db | Backup output directory |
| `HEALTH_DEEP` | `false` | health-check | `"true"` enables deep checks (same as `--deep`) |
| `NETWORK` | unset → testnet | health-check | `mainnet` selects the public network passphrase |
| `GRACE_ALERT_THRESHOLD_PCT` | `25` | grace-period-monitor | Alert when this % of the grace window remains |
| `KEEPER_HEARTBEAT_PATH` | `data/keeper-heartbeat.json` (relative to cwd) | grace-period-monitor | Keeper heartbeat file |
| `LEDGER_ENTRY_BATCH` | `100`; clamped to 1–200 | subscriber-health-dashboard | `getLedgerEntries` batch size |
| `EXPIRING_TTL_LEDGERS` | `500000` | subscriber-health-dashboard | TTL threshold for "expiring" entries |
| `PROGRESS` | `1` | subscriber-health-dashboard | `0` suppresses progress output |
| `DEBUG` | unset | watch-events | `1` or a value containing `payflow` enables debug logging |
| `TOKEN_ADDRESS` | none — required | topup-allowance | SAC token contract |
| `USER_ADDRESS` | none — required | topup-allowance | Subscriber account |
| `USER_SECRET` | none — required unless `--simulate` | topup-allowance | Subscriber signing key |
| `AMOUNT` | none — required | topup-allowance | Allowance amount in stroops |
| `EXPIRY_LEDGERS` | `17280` | topup-allowance | Allowance lifetime in ledgers |
| `FRIENDBOT_URL` | `https://friendbot.stellar.org` | testnet-setup | Friendbot endpoint |
| `VITE_DEFAULT_TOKEN` | Testnet native XLM SAC | testnet-setup | Token used for test subscriptions |

Docker runtime only (set in [`scripts/Dockerfile`](../scripts/Dockerfile), not read by script code): `NODE_ENV=production`, `NODE_OPTIONS=--unhandled-rejections=throw`.

## Deprecated aliases

| Deprecated alias | Canonical name | Notes |
| --- | --- | --- |
| `KEEPER_SECRET` | `SECRET_KEY` | Resolved by `normalizeEnv()` in `config.ts`; emits a deprecation warning; canonical wins if both are set. Exception: `replay-dlq.ts` still reads only `KEEPER_SECRET` |
| `NETWORK_PASSTHRASE` | `NETWORK_PASSPHRASE` | Typo alias; same handling |
| `CHARGE_INTERVAL_MS` | Stale | Listed in old `.env.example`; **not read** by current `keeper.ts` |
| `PAGE_SIZE` | Not stale | Read by `batch-optimizer.ts` and `subscriber-health-dashboard.ts` (page size, default 50) |
| `MAX_RETRIES` | Not stale | Read by `alert-expiring-allowances.ts` and `check-allowances.ts` (retry attempts, default 3) |
| `BACKFILL_START_LEDGER` | Stale | Removed from the root `.env.example`; the backfill facility only exists in the dead root `indexer.ts` stub |
| `BACKFILL_END_LEDGER` | Stale | Removed from the root `.env.example`; same as above |
| `BACKFILL_RATE_LIMIT` | Stale | Removed from the root `.env.example`; same as above |
| `BACKFILL_CHECKPOINT_FILE` | Stale | Removed from the root `.env.example`; same as above |

## Not read by any script

| Variable | Notes |
| --- | --- |
| `keeper.ts` | `CONTRACT_ID`, `RPC_URL`, `RPC_URLS`, `SECRET_KEY`/`KEEPER_SECRET`, `KEEPER_PUBLIC_KEY`, `DRY_RUN`, `BATCH_SIZE`, `INTERVAL_SECONDS`, `KEEPER_USE_LEGACY_PAGING`, `NETWORK_PASSPHRASE`/`NETWORK_PASSTHRASE`, `ALLOW_MAINNET`, `LOG_LEVEL`, `LOG_FORMAT`, `REPORT_DIR`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_DLQ_FILE`, `ALERT_WINDOW_LEDGERS` |
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
| `CHARGE_INTERVAL_MS` | Appeared in older `.env.example` files; use `INTERVAL_SECONDS` |

## Script-to-variable matrix

Shared modules pull in variables of their own; a script that imports one also reads its variables:

- **logger** (`logger.ts`): `LOG_LEVEL`, `LOG_FORMAT`
- **rpc-client** (`rpc-client.ts`): `RPC_URLS`, `RPC_URL`/`VITE_RPC_URL`, `NETWORK_PASSPHRASE`/`VITE_NETWORK_PASSPHRASE`, and `CONTRACT_ID`/`VITE_CONTRACT_ID` for the RPC event fallback
- **soroban-admin** (`loadSorobanConfig()` in `soroban-admin.ts`): `CONTRACT_ID`/`VITE_CONTRACT_ID`, `RPC_URL`/`VITE_RPC_URL`, `NETWORK_PASSPHRASE`/`VITE_NETWORK_PASSPHRASE`, `ADMIN_SECRET_KEY`
- **event-dedup** (`event-dedup.ts`): `EVENT_DEDUP_CACHE_SIZE`, `EVENT_DEDUP_TTL_MS`
- **batch-optimizer** (`batch-optimizer.ts`): its row below

`A/VITE_A` means `A`, falling back to `VITE_A`.

| Script / module | Reads directly | Via shared modules |
| --- | --- | --- |
| `alert-expiring-allowances.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `NETWORK_PASSPHRASE`, `ALERT_WINDOW_LEDGERS`, `WEBHOOK_URL`, `CONCURRENCY`, `MAX_RETRIES`, `RETRY_BASE_MS` | rpc-client |
| `alert-failed-charges.ts` | `WEBHOOK_URL`, `INDEXER_DB` | logger |
| `allowance-utils.ts` | — | — |
| `audit-trail.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL` | — |
| `backup-indexer-db.ts` | `INDEXER_DB_PATH`, `BACKUP_DIR` | — |
| `batch-optimizer.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `MAX_BATCH_SIZE`, `MAX_CYCLE_USERS`, `PAGE_SIZE` | — |
| `check-allowances.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `NETWORK_PASSPHRASE`, `CONCURRENCY`, `MAX_RETRIES`, `RETRY_BASE_MS` | logger, rpc-client |
| `churn-analysis.ts` | `INDEXER_DB_PATH`, `INDEXER_DB` | rpc-client |
| `config.ts` | — (validates the env object it is given; resolves `KEEPER_SECRET`, `NETWORK_PASSTHRASE`) | — |
| `daily-revenue-summary.ts` | `INDEXER_DB`, `WEBHOOK_URL`, `SLACK_WEBHOOK_URL` | logger |
| `deploy-pipeline.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `SOROBAN_SOURCE_ACCOUNT` | — |
| `event-dedup.ts` | `EVENT_DEDUP_CACHE_SIZE`, `EVENT_DEDUP_TTL_MS` | — |
| `export-merchant-report.ts` | `VITE_CONTRACT_ID`, `VITE_RPC_URL`, `VITE_NETWORK_PASSPHRASE` (only the `VITE_` names), `INDEXER_DB_PATH` | logger |
| `fee-revenue-report.ts` | — | logger |
| `grace-period-monitor.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `WEBHOOK_URL/ALERT_WEBHOOK_URL`, `GRACE_ALERT_THRESHOLD_PCT`, `KEEPER_HEARTBEAT_PATH` | — |
| `health-check.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK`, `VITE_NETWORK_PASSPHRASE`, `HEALTH_DEEP` | logger, rpc-client |
| `indexer.ts` | `CONTRACT_ID`, `RPC_URL`, `POLL_INTERVAL_MS`, `DATA_DIR`, `DB_FILE`, `START_LEDGER`, `EVENT_DEDUP_TTL_MS` | logger, rpc-client, event-dedup |
| `keeper-benchmark.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `KEEPER_SECRET_KEY/SECRET_KEY` | — |
| `keeper.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `DRY_RUN`, `KEEPER_PUBLIC_KEY`, `SECRET_KEY/KEEPER_SECRET`, `BATCH_SIZE`, `INTERVAL_SECONDS`, `REPORT_DIR`, `KEEPER_USE_LEGACY_PAGING`, `DLQ_FILE` | logger, rpc-client, batch-optimizer, `METRICS_PORT` (metrics-server); validated by config.ts |
| `lib/*.ts`, `utils/log.ts` | — | — |
| `lint-duplicates.ts` | — | — |
| `logger.ts` | `LOG_LEVEL`, `LOG_FORMAT` | — |
| `merchant-analytics.ts`, `merchant-queries.ts`, `snapshot-diff.ts` | — | — |
| `metrics-server.ts` | `METRICS_PORT` | — |
| `migrate-contract.ts` | `VITE_CONTRACT_ID/CONTRACT_ID`, `VITE_RPC_URL/RPC_URL`, `VITE_NETWORK_PASSPHRASE/NETWORK_PASSPHRASE` (the `VITE_` name wins here) | logger |
| `onboard-merchant.ts` | `MERCHANT_ONBOARD_WEBHOOK_URL` | soroban-admin |
| `pre-upgrade-check.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `SOROBAN_SOURCE_ACCOUNT` | — |
| `query-events.ts` | `DATA_DIR`, `DB_FILE` | — |
| `renewal-forecast.ts` | `DATA_DIR`, `DB_FILE` | — |
| `replay-dlq.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `KEEPER_SECRET`, `KEEPER_MAX_RETRIES`, `KEEPER_RETRY_BASE_MS`, `DLQ_FILE`, `LOG_LEVEL` | — |
| `replay-events.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL` | logger, rpc-client |
| `rotate-fee-collector.ts` | — | logger, soroban-admin |
| `rpc-client.ts` | `RPC_URLS`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `CONTRACT_ID/VITE_CONTRACT_ID` | — |
| `smoke-config.ts` | — (parses `scripts/.env.example` from disk and validates it with `ConfigSchema`) | logger |
| `soroban-admin.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `ADMIN_SECRET_KEY` | — |
| `subscriber-churn-report.ts` | — | logger |
| `subscriber-health-dashboard.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `PAGE_SIZE`, `LEDGER_ENTRY_BATCH`, `EXPIRING_TTL_LEDGERS`, `PROGRESS` | — |
| `subscription-snapshot.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE` | logger, rpc-client |
| `testnet-setup.ts` | `RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `FRIENDBOT_URL`, `VITE_DEFAULT_TOKEN` | logger |
| `top-merchants.ts` | `CONTRACT_ID/VITE_CONTRACT_ID`, `RPC_URL/VITE_RPC_URL`, `NETWORK_PASSPHRASE/VITE_NETWORK_PASSPHRASE`, `SOROBAN_SOURCE_ACCOUNT` | — |
| `topup-allowance.ts` | `CONTRACT_ID`, `RPC_URL`, `NETWORK_PASSPHRASE`, `TOKEN_ADDRESS`, `USER_ADDRESS`, `USER_SECRET`, `AMOUNT`, `EXPIRY_LEDGERS` | logger, rpc-client |
| `validate-config.ts` | — (parses the repo-root `.env.local` or `.env` from disk and validates it with `ConfigSchema`) | logger |
| `watch-events.ts` | `CONTRACT_ID`, `RPC_URL`, `DEBUG`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_DLQ_FILE`, `EVENT_DEDUP_TTL_MS` | logger, rpc-client, event-dedup |
| `webhook.ts` | — | logger |

## Validation test

A parity test at [`scripts/config.test.ts`](../scripts/config.test.ts) validates that:

- Canonical names take precedence over deprecated aliases
- Deprecation warnings are emitted when aliases are used
- The Zod schema accepts valid values and rejects invalid ones

Run it with:

```bash
cd scripts && npm test -- --reporter=verbose config.test.ts
```
