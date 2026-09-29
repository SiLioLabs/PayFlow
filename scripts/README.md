# FlowPay Scripts

Operational and analytics scripts for the FlowPay contract.  All scripts are written in TypeScript and run with `ts-node`.

---

## Setup
# PayFlow Scripts

Operational scripts for the FlowPay recurring-billing contract. All scripts are
written in TypeScript and executed with [tsx](https://github.com/privatenumber/tsx)
(no compile step needed for local use).

## Scope of this guide

This README's **operations guide** covers four areas only:

- **Keeper** (`keeper.ts`)
- **Indexer** (`indexer.ts`)
- **Metrics server** (`metrics-server.ts`) plus the Grafana dashboard JSON
- **Docker Compose** (`docker-compose.yml` / `Dockerfile`)

It does **not** document every other script in this directory (allowance alerts,
analytics, deploy pipeline, snapshots, and so on). Those remain listed under
[Other scripts](#other-scripts) for discovery only.

DLQ / replay and RPC failover already have dedicated docs; this guide links them
instead of duplicating them. See [DLQ, replay, and failover](#dlq-replay-and-failover).

## Prerequisites

- Node.js 20+
- `npm install` inside this directory

```bash
cd scripts
npm install
```

All scripts read configuration from environment variables.  Copy `.env.example` at the repo root and fill in the required values:

```bash
cp .env.example .env
# edit .env with your CONTRACT_ID, RPC_URL, SOROBAN_SOURCE_ACCOUNT, etc.
```

---

## Scripts Reference

### top-merchants.ts

Fetches the top merchants by subscriber count using the on-chain `get_top_merchants_by_subs` getter.

**Contract limit:** The contract enforces a hard cap of **20** per call (`BatchTooLarge` panic if exceeded).  Use `--limit` and `--page-size` to stay within this boundary.

```bash
# Show top 10 merchants (default)
npx ts-node scripts/top-merchants.ts

# Show top 20 (contract maximum)
npx ts-node scripts/top-merchants.ts --limit 20

# Paginate: page 2, 5 per page
npx ts-node scripts/top-merchants.ts --limit 20 --page 2 --page-size 5

# JSON output
npx ts-node scripts/top-merchants.ts --json

# Dry-run (validate config without RPC call)
npx ts-node scripts/top-merchants.ts --dry-run
```

**Options:**

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `10` | Merchants to fetch from contract (1–20) |
| `--page <n>` | `1` | Page number (1-based) |
| `--page-size <n>` | `10` | Results per page (1–20) |
| `--contract <id>` | `$CONTRACT_ID` | Contract address |
| `--rpc-url <url>` | `$RPC_URL` | Soroban RPC endpoint |
| `--json` | `false` | Emit machine-readable JSON |
| `--dry-run` | `false` | Print config without calling RPC |

Closes [issue #896](https://github.com/SiLioLabs/PayFlow/issues/896).

---

### deploy-pipeline.ts

Hardened deployment pipeline with preflight checklist.  Run before any `upgrade()` call.

```bash
# Full preflight with WASM hash verification
npx ts-node scripts/deploy-pipeline.ts \
  --wasm target/wasm32-unknown-unknown/release/flowpay.wasm \
  --contract $CONTRACT_ID \
  --source $SOROBAN_SOURCE_ACCOUNT

# Dry-run (validate config, skip all network calls)
npx ts-node scripts/deploy-pipeline.ts --dry-run

# Custom summary output path
npx ts-node scripts/deploy-pipeline.ts --summary-out ci-artifacts/deploy-summary.json
```

**Preflight gates:**

| Gate | Failure behaviour |
| --- | --- |
| RPC health | Aborts pipeline |
| WASM hash (local vs on-chain) | Aborts on mismatch; warns if on-chain hash unavailable |
| Schema version | Warns if migration pending (does not abort) |

**Options:**

| Flag | Default | Description |
| --- | --- | --- |
| `--wasm <path>` | — | Path to compiled `.wasm` file |
| `--contract <id>` | `$CONTRACT_ID` | Deployed contract address |
| `--rpc-url <url>` | `$RPC_URL` | Soroban RPC endpoint |
| `--source <addr>` | `$SOROBAN_SOURCE_ACCOUNT` | Source account for read queries |
| `--summary-out <path>` | `deploy-summary.json` | Machine-readable JSON summary |
| `--dry-run` | `false` | Skip all network calls |

The summary artifact is always written, even on failure, so CI can archive it as a build artefact.

Closes [issue #897](https://github.com/SiLioLabs/PayFlow/issues/897).

---

### pre-upgrade-check.ts

Standalone pre-upgrade validator (also called internally by `deploy-pipeline.ts`).  Run this as a lightweight gate in CI before building a release.

```bash
npx ts-node scripts/pre-upgrade-check.ts \
  --wasm path/to/flowpay.wasm \
  --contract $CONTRACT_ID \
  --source $SOROBAN_SOURCE_ACCOUNT
```

Checks: WASM file exists & non-empty, contract ID format, RPC reachable, source account funded, schema version readable.

Closes [issue #897](https://github.com/SiLioLabs/PayFlow/issues/897).

---

### backup-indexer-db.ts

Online-safe backup and restore helper for the indexer SQLite database (`data/events.db`).

The backup uses SQLite's `backup()` API (hot copy — no write lock on source).  After writing, an integrity check (`PRAGMA integrity_check`) is run on the backup file.  Restore verifies integrity of the backup before touching the live database.

#### Backup

```bash
# Default: backup to data/backups/events-<timestamp>.db
npx ts-node scripts/backup-indexer-db.ts backup

# Custom paths
npx ts-node scripts/backup-indexer-db.ts backup \
  --db data/events.db \
  --out /mnt/backups/events-2026-08-29.db

# Overwrite if destination exists
npx ts-node scripts/backup-indexer-db.ts backup --force

# Dry-run
npx ts-node scripts/backup-indexer-db.ts backup --dry-run
```

#### Restore

```bash
# Restore from a backup
npx ts-node scripts/backup-indexer-db.ts restore \
  --from data/backups/events-2026-08-29.db

# Overwrite live DB
npx ts-node scripts/backup-indexer-db.ts restore \
  --from data/backups/events-2026-08-29.db \
  --force

# Dry-run (verify backup integrity, print plan, do not overwrite)
npx ts-node scripts/backup-indexer-db.ts restore \
  --from data/backups/events-2026-08-29.db \
  --dry-run
```

**Restore safety rules:**
1. Backup integrity check (`PRAGMA integrity_check`) must return `ok`.
2. If destination exists, `--force` is required.
3. Destination directory is created if it does not exist.

**Options (backup):**

| Flag | Default | Description |
| --- | --- | --- |
| `--db <path>` | `$INDEXER_DB_PATH` or `data/events.db` | Source database |
| `--out <path>` | `data/backups/events-<ts>.db` | Backup destination |
| `--force` | `false` | Overwrite destination if it exists |
| `--dry-run` | `false` | Print plan without writing files |

**Options (restore):**

| Flag | Default | Description |
| --- | --- | --- |
| `--from <path>` | — (required) | Backup file to restore from |
| `--db <path>` | `$INDEXER_DB_PATH` or `data/events.db` | Restore destination |
| `--force` | `false` | Overwrite destination if it exists |
| `--dry-run` | `false` | Verify + print plan without writing |

**Optional: S3 lifecycle policies**

For production deployments you may want to ship backups to S3 and apply lifecycle rules to expire old backups automatically.  This is not implemented in the script but can be added by piping the backup output to `aws s3 cp`:

```bash
npx ts-node scripts/backup-indexer-db.ts backup --out /tmp/events-backup.db
aws s3 cp /tmp/events-backup.db s3://my-bucket/flowpay-backups/
```

Closes [issue #898](https://github.com/SiLioLabs/PayFlow/issues/898).

---

## Running Tests

```bash
cd scripts
npm test
```

Tests use [Vitest](https://vitest.dev/) with Node environment.  All tests mock file I/O and SQLite — no running database or network connection is needed.

```bash
# Typecheck only
npm run typecheck
```

---

## Environment Variables

| Variable | Used by | Description |
| --- | --- | --- |
| `CONTRACT_ID` / `VITE_CONTRACT_ID` | all | Deployed FlowPay contract ID |
| `RPC_URL` / `VITE_RPC_URL` | all | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` / `VITE_NETWORK_PASSPHRASE` | all | Stellar network passphrase |
| `SOROBAN_SOURCE_ACCOUNT` | deploy-pipeline, top-merchants | Source account for read-only RPC queries |
| `SOROBAN_SECRET_KEY` | keeper (not in this dir) | Keeper signing key |
| `INDEXER_DB_PATH` | backup-indexer-db | Override default `data/events.db` |
| `BACKUP_DIR` | backup-indexer-db | Override default `data/backups/` |
| `PAGE_SIZE` | keeper | Batch size for `batch_charge` (max **20**) |

---

## See Also

- [`docs/KEEPER.md`](../docs/KEEPER.md) — Full keeper runbook (env vars, DLQ, dry-run, ChargeResult table)
- [`docs/API.md`](../docs/API.md) — Contract function reference
- [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — Contract deployment and migration guide
---

## Scripts

| Script                         | Purpose                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `keeper.ts`                    | Autonomous keeper — calls `batch_charge` on a schedule; supports dry-run |
| `watch-events.ts`              | Real-time contract event monitor                                         |
| `check-allowances.ts`          | Audit subscriber token allowances                                        |
| `alert-expiring-allowances.ts` | Alert on allowances expiring within a configurable window                |
| `indexer.ts`                   | Persist contract events to SQLite                                        |
| `query-events.ts`              | Query the SQLite event database                                          |
| `health-check.ts`              | Contract responsiveness check                                            |
| `subscription-snapshot.ts`     | Snapshot all subscription states                                         |
| `daily-revenue-summary.ts`     | Daily revenue report                                                     |
| `export-merchant-report.ts`    | Per-merchant activity report                                             |
| Script                         | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `keeper.ts`                    | Autonomous keeper — calls `batch_charge` on a schedule; supports dry-run  |
| `watch-events.ts`              | Real-time contract event monitor                          |
| `check-allowances.ts`          | Audit subscriber token allowances                         |
| `alert-expiring-allowances.ts` | Alert on allowances expiring within a configurable window |
| `indexer.ts`                   | Persist contract events to SQLite                         |
| `query-events.ts`              | Query the SQLite event database                           |
| `health-check.ts`              | Contract responsiveness check                             |
| `subscription-snapshot.ts`     | Snapshot all subscription states                          |
| `daily-revenue-summary.ts`     | Daily revenue report                                      |
| `export-merchant-report.ts`    | Per-merchant activity report                              |

## Testnet quick start

Copy-pastable **testnet** commands. Use placeholder keys only; do not put Mainnet
secrets in this file or in committed `.env` files.

```bash
cd scripts
npm install
cp .env.example .env
# edit .env — set CONTRACT_ID (C…), KEEPER_PUBLIC_KEY (G…), KEEPER_SECRET (S…)

# Keeper (package script) — export the vars above, or pass them inline
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npm run keeper
# equivalent: tsx keeper.ts

# Dry-run one cycle (no live submit)
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... DRY_RUN=true tsx keeper.ts --once

# Indexer (package script)
CONTRACT_ID=C... npm run indexer
# equivalent: CONTRACT_ID=C... tsx indexer.ts

# Metrics exporter (no package.json script — run directly)
tsx metrics-server.ts

# Docker Compose (all services: keeper + indexer + metrics)
docker compose up -d
docker compose logs -f
docker compose down

# Docker Compose (keeper only)
docker compose up -d keeper

# Docker Compose (keeper + indexer, no metrics)
docker compose up -d keeper indexer
```

`scripts/package.json` defines `keeper` → `tsx keeper.ts` and `indexer` →
`tsx indexer.ts`. There is no npm script for `metrics-server.ts`. Root
`package.json` does not wrap these commands.

---

## Keeper

The keeper bot uses `buildOptimizedBatches()` to select only ready subscribers
(ordered by grace urgency and overdue age) and calls `batch_charge()` on each
batch, then sleeps until the next cycle. Supports a `DRY_RUN` mode that
simulates charges without submitting any transactions.

### Purpose

The keeper is an off-chain loop that selects ready subscribers with
`buildOptimizedBatches()` (grace urgency and overdue age) and invokes
`batch_charge` so recurring charges run without a user in the loop. Soroban has
no native scheduler; keepers supply that cadence.

`DRY_RUN=true` simulates with `get_batch_charge_estimate` and does not submit
transactions. Flags: `--once` (one cycle then exit), `--help` / `-h`.

### Prerequisites

- Testnet (or other) FlowPay **contract ID**
- A funded Stellar account: **public key always required**; **secret key**
  required unless `DRY_RUN=true`
- Reachable Soroban RPC
- Node 20+ and dependencies from `npm install` in `scripts/`

### Required environment variables

| Variable        | Required           | Notes                                                  |
| --------------- | ------------------ | ------------------------------------------------------ |
| `CONTRACT_ID`   | yes                | Empty value exits 1                                    |
| `KEEPER_SECRET` | yes (live signing) | Secret key `S…`; first config block always requires it |
| Variable | Required | Notes |
| --- | --- | --- |
| `CONTRACT_ID` | yes | Empty value fails `validateEnv` |
| `KEEPER_PUBLIC_KEY` | yes | Source account `G…`; required even in dry-run |
| `KEEPER_SECRET` | yes unless `DRY_RUN=true` | Secret key `S…` for live signing |

`scripts/.env.example` lists `CONTRACT_ID` and `KEEPER_SECRET` plus
`CHARGE_INTERVAL_MS` / `PAGE_SIZE` / `MAX_RETRIES` / `LOG_LEVEL`. **Current
`keeper.ts` does not read those four tuning names.** Add `KEEPER_PUBLIC_KEY`
(and optionally `DRY_RUN`, `BATCH_SIZE`, `INTERVAL_SECONDS`, `REPORT_DIR`)
yourself. Compose loads `.env` as-is.

### Testnet startup

```bash
cd scripts

# Live mode
CONTRACT_ID=C... \
KEEPER_PUBLIC_KEY=G... \
KEEPER_SECRET=S... \
tsx keeper.ts

# Dry-run (simulate only, no transactions submitted)
CONTRACT_ID=C... \
KEEPER_PUBLIC_KEY=G... \
DRY_RUN=true \
tsx keeper.ts --once
```

Or `npm run keeper` after exporting the same variables. Docker: see
[Docker Compose](#docker-compose).

### Expected health / behavior

- Local process: logs `Keeper started in LIVE mode` or
  `Keeper started in DRY-RUN mode — no transactions will be submitted` at INFO
  level, with `mode` field in context. There is **no** SIGINT/SIGTERM handler;
  loop mode sleeps `INTERVAL_SECONDS` between cycles. `--once` exits 0 unless
  the cycle had errors and `totalCharged === 0` (then exit 1).
- Docker image `HEALTHCHECK`: `wget` POST `getHealth` to
  `${RPC_URL:-https://soroban-testnet.stellar.org}` and grep
  `"status":"healthy"` (60 s interval). This probes **RPC**, not the keeper
  loop itself.
- Compose: `restart: unless-stopped`, `stop_grace_period: 60s`.

Smoke after Compose:

```bash
docker compose logs keeper | grep '"message":"Keeper started'
```

### Logs and metrics

- Structured logger: keeper uses the shared `logger.ts` with child context
  `{script, contract, rpc}` bound on every line. `LOG_LEVEL` (default `info`)
  is respected; set `LOG_FORMAT=json` for JSON lines (required in Docker).
- A representative JSON log line emitted at startup:

  ```json
  {"timestamp":"2026-08-30T17:45:00.123Z","level":"INFO","message":"Keeper started in LIVE mode","script":"keeper","contract":"CAAAA...","rpc":"https://soroban-testnet.stellar.org","mode":"live"}
  ```

- Prometheus metrics are implemented in `metrics-server.ts`. **`keeper.ts` does
  not import that module**, so running the keeper alone does not expose
  `/metrics`. Run the metrics server separately if you need scrape targets.

### Additional variables the file reads

| Variable             | Default                        | Description                                          |
| -------------------- | ------------------------------ | ---------------------------------------------------- |
| `RPC_URL`            | testnet RPC                    | Soroban RPC endpoint                                 |
| `NETWORK_PASSPHRASE` | testnet passphrase             | Stellar network passphrase                           |
| `BATCH_SIZE`         | `50`                           | Subscribers per `batch_charge` call (max 50)         |
| `INTERVAL_SECONDS`   | `3600` (1 h)                   | Seconds between full charge cycles                   |
| `DRY_RUN`            | `false`                        | Set `true` to simulate charges without submitting    |
| `REPORT_DIR`         | `<script_dir>/data/benchmarks` | Directory for dry-run reports and live-cycle pointer |
| Variable             | Default                          | Description                                         |
| -------------------- | -------------------------------- | --------------------------------------------------- |
| `RPC_URL`            | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint                          |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET`               | Stellar network passphrase                          |
| `BATCH_SIZE`         | on-chain `get_max_batch_size()`, else `50` | Subscribers per `batch_charge` call (legacy paging only); always clamped ≤ live on-chain max and ≤ 200 ceiling — logged at startup |
| `INTERVAL_SECONDS`   | `3600` (min 1)                   | Seconds between full charge cycles                  |
| `DRY_RUN`            | unset → live (`=== "true"` only) | Simulate with `get_batch_charge_estimate`           |
| `LOG_LEVEL`          | `info`                           | Minimum log level: `debug` \| `info` \| `warn` \| `error` |
| `LOG_FORMAT`         | unset → human text               | Set to `json` for JSON-lines output (recommended in Docker) |
| `REPORT_DIR`         | `<script_dir>/data/benchmarks`   | Dry-run reports and live-cycle pointer              |

The `keeper.ts` file header still says `get_batch_charge_estimate` does not
check allowances. **The contract now does** (see
[`docs/API.md`](../docs/API.md#get_batch_charge_estimate)). Treat the header as
stale; the ABI wins.

### Grace-urgency ordering (default) vs. legacy paging

By default the keeper uses `buildOptimizedBatches()` from `batch-optimizer.ts`,
which sorts subscribers by **grace-period urgency** (closest to grace expiry
first) and **overdue age** (most overdue first). This reduces grace lapses
because urgent subscribers are charged in earlier batches.

To revert to the legacy sequential offset-based paging (charges in subscriber
index insertion order):

```bash
KEEPER_USE_LEGACY_PAGING=true tsx keeper.ts
```

| Mode | Env var | Behavior |
| --- | --- | --- |
| **Optimized** (default) | unset | Grace-urgency + overdue sorting via `buildOptimizedBatches()` |
| **Legacy** | `KEEPER_USE_LEGACY_PAGING=true` | Sequential offset/limit paging through subscriber index |

Both modes emit **lapsed-vs-charged metrics** in cycle logs:

```
Grace metrics: urgentCharged=12 urgentLapsed=0 normalCharged=45 normalLapsed=1
```

Dry-run reports (`keeper-dryrun-report-*.json`) include a `pagingMode` field
(`"optimized"` or `"legacy"`) and a `graceMetrics` object for comparison.

See [`keeper-benchmark.ts`](keeper-benchmark.ts) header for instructions on
comparing the two modes with dry-run fixtures.

### Debug logging

Set `LOG_LEVEL=debug` to see per-subscriber ordering rationale in the optimized
path (batch assignment, urgency classification, and deferral decisions).

### Dry-run report

Every time the keeper completes a cycle in `DRY_RUN=true` mode, it writes a
timestamped JSON report to `REPORT_DIR`:

```
keeper-dryrun-report-2026-08-26T10-00-00.000Z.json
```

The report contains:

- **`estimatedOutcomes`** — aggregate counts: `totalChecked`, `totalCharged`,
  `totalVolumeStroops`, and `skipCounts` keyed by decoded `ChargeResult`
  variant names (including `AllowanceInsufficient` when the contract returns it).
- **`candidates`** — full per-subscriber detail: address, decoded
  `ChargeResult` variant, and the subscription amount in stroops (for
  `Charged` entries).
- **`lastLiveCycle`** — snapshot from the most recent live cycle
  (`keeper-latest-live.json`), or `null` if no live cycle has run yet.
- **`comparison`** — delta between this dry-run and the last live cycle
  (`checkedDelta`, `chargedDelta`, `volumeDelta`) plus `lastLiveAgeHuman`
  (e.g. `"24.0 hours"`).
- **`errors`** — any per-batch errors that occurred during the cycle.

After every **live** cycle, the keeper overwrites
`REPORT_DIR/keeper-latest-live.json` with a compact summary so the next dry
run can compute a comparison.

See [`data/benchmarks/keeper-dryrun-report-sample.json`](./data/benchmarks/keeper-dryrun-report-sample.json)
for the full expected shape.

> **Note:** The benchmark files produced by `keeper-benchmark.ts`
> (`keeper-bench-*.json`) have a completely different schema (submission and
> confirmation latency percentiles) and are unrelated to these reports.
> `keeper.ts` currently contains two overlapping configuration blocks. Docker and
> `.env.example` follow the first. The second also reads:

| Variable            | Default in that block                   | Role                                           |
| ------------------- | --------------------------------------- | ---------------------------------------------- |
| `DRY_RUN`           | `"true"` (boolean if equal to `"true"`) | Simulation mode; secret not required when true |
| `KEEPER_PUBLIC_KEY` | `""`                                    | Required by `validateEnv` in that block        |
| `BATCH_SIZE`        | `50` (clamped 1–50)                     | Page size in that block                        |
| `INTERVAL_SECONDS`  | `3600` (min 1)                          | Loop interval in that block                    |

Set the variables that match how you start the process. Prefer the
`.env.example` names for Compose.

---

## Indexer

### Purpose

Polls Soroban RPC `getEvents` for the configured contract and upserts events
into a local SQLite database. On restart it resumes from `meta.last_ledger`
so the same events are not re-fetched as duplicates (upsert key
`tx_hash:event_name`).

**Pause lifecycle events:** the indexer should track `paused`, `resumed`, and
`subscription_auto_resumed` events to maintain accurate pause state for each
subscriber. `pause_until` subscriptions auto-resume on the next `charge` or
`batch_charge` after their expiry — the expiry timestamp is in the `paused`
event payload. See [docs/architecture/pause-lifecycle.md](../docs/architecture/pause-lifecycle.md#keeper-and-indexer-guidance) for the full event-driven
tracking guide.

### Prerequisites

- `CONTRACT_ID`
- Reachable Soroban RPC
- Write permission for the SQLite path (`DATA_DIR` / `DB_FILE`)
- Node 20+ (uses `node:sqlite` `DatabaseSync`)

### Environment variables

| Variable           | Default                               | Purpose                               |
| ------------------ | ------------------------------------- | ------------------------------------- |
| `CONTRACT_ID`      | (required)                            | Contract to filter                    |
| `RPC_URL`          | `https://soroban-testnet.stellar.org` | Soroban RPC                           |
| `POLL_INTERVAL_MS` | `10000`                               | Poll interval                         |
| `LOG_LEVEL`        | `info`                                | `debug` \| `info` \| `error`          |
| `DATA_DIR`         | `data`                                | Directory for the DB file             |
| `DB_FILE`          | `resolve(DATA_DIR, "events.db")`      | Full path override                    |
| `START_LEDGER`     | unset → latest ledger                 | First-run start when no `last_ledger` |

The indexer header mentions `NETWORK_PASSPHRASE`; the implementation does **not**
read that env var.

### Startup

```bash
cd scripts
CONTRACT_ID=C... tsx indexer.ts
# or
npm run indexer
```

### Persistence and `events.db`

See [events.db persistence](#eventsdb-persistence) below. Schema: tables `meta`
and `events`; WAL mode; `mkdirSync` on the DB directory. Poll limit 200 events
per RPC call. Graceful SIGINT/SIGTERM (exit 0).

### Expected health / behavior

- Missing `CONTRACT_ID` → stderr + exit 1
- First run: “First run” path, start ledger = `START_LEDGER` if `> 0`, else
  `getLatestLedger().sequence`
- Subsequent runs: resume from stored `last_ledger`
- Fatal DB or config errors → exit 1

### Query stored events

`query-events.ts` is a companion, not part of the four-area ops stack beyond
reading the same DB:

```bash
tsx query-events.ts --recent --pretty
tsx query-events.ts --address GXYZ... --pretty
tsx query-events.ts --type charged --pretty
tsx query-events.ts --ledger 500000 --to 510000
```

---

## Metrics server

### Purpose

Standalone Prometheus exporter (`prom-client`) for keeper-oriented metrics.
Starts an HTTP server and serves Prometheus text on **every path** (documented
scrape URL is `/metrics`).

### Startup

There is **no** `package.json` script. From `scripts/`:

```bash
tsx metrics-server.ts
```

From repo root (as the file header states):

```bash
tsx scripts/metrics-server.ts
```

### Environment

| Variable             | Default | Actually read?            |
| -------------------- | ------- | ------------------------- |
| `METRICS_PORT`       | `9090`  | **Yes** — listen port     |
| `CONTRACT_ID`        | —       | Header only; **not** read |
| `RPC_URL`            | —       | Header only; **not** read |
| `NETWORK_PASSPHRASE` | —       | Header only; **not** read |

### Endpoint / port

- Listen: `METRICS_PORT` (default **9090**)
- Content-Type: `text/plain; version=0.0.4`
- If the port is in use: logs that the keeper would continue without metrics
  and does not crash the process

Exposed series (plus Node default metrics):

- `keeper_charges_total{status}`
- `keeper_batch_duration_seconds`
- `keeper_rpc_errors_total`
- `keeper_active_subscribers`
- `keeper_batch_size`
- `keeper_cycles_total`

`startMetricsServer()` is exportable for embedding, but **nothing else in
`scripts/` currently imports this module**. Compose does not run it. Scrapes
stay empty unless a process records into this registry.

### Grafana

Dashboard JSON: [`grafana-dashboard.json`](grafana-dashboard.json)

| Property            | Value                                       |
| ------------------- | ------------------------------------------- |
| Title               | PayFlow Keeper                              |
| uid                 | `payflow-keeper`                            |
| Tags                | `payflow`, `keeper`, `prometheus`           |
| Datasource template | `DS_PROMETHEUS` (Prometheus)                |
| Refresh             | 10s, timezone `utc`, default range `now-6h` |

Import the JSON into Grafana and select a Prometheus datasource that scrapes
the metrics server. This repository does **not** ship a Grafana or Prometheus
Compose service.

---

## Docker Compose

### Services and topology

`docker-compose.yml` defines **three** services:

```text
.host .env
    ├── keeper (container_name: payflow-keeper)
    │       ├── command: node dist/keeper.js (default)
    │       ├── env_file: .env
    │       ├── volume: events-data → /app/data
    │       ├── restart: unless-stopped
    │       ├── stop_grace_period: 60s
    │       └── healthcheck: RPC getHealth
    │
    ├── indexer (container_name: payflow-indexer)
    │       ├── command: node dist/indexer.js
    │       ├── env_file: .env
    │       ├── volume: events-data → /app/data
    │       ├── restart: unless-stopped
    │       ├── stop_grace_period: 30s
    │       └── healthcheck: RPC getHealth
    │
    └── metrics (container_name: payflow-metrics)
            ├── command: node dist/metrics-server.js
            ├── env_file: .env
            ├── ports: ${METRICS_PORT:-9090}:9090
            ├── restart: unless-stopped
            ├── stop_grace_period: 10s
            └── healthcheck: HTTP GET /metrics
```

All three services share the same Docker image (`payflow-keeper:latest`) built
from `Dockerfile`. The `command:` override selects which script runs.

### Ports

| Service  | Container port | Host port        | Purpose                          |
| -------- | -------------- | ---------------- | -------------------------------- |
| keeper   | none           | —                | No HTTP listener                 |
| indexer  | none           | —                | No HTTP listener                 |
| metrics  | 9090           | `${METRICS_PORT}` | Prometheus `/metrics` endpoint |

### Environment

Compose loads `scripts/.env` via `env_file`. Copy from `.env.example` and set
the required variables:

```bash
cd scripts
cp .env.example .env
# Required: CONTRACT_ID, KEEPER_PUBLIC_KEY, KEEPER_SECRET
# Optional: RPC_URL, NETWORK_PASSPHRASE, DRY_RUN, etc.
```

The `.env` file is **not** baked into the image.

### Persistent volumes

Named volume `events-data` mounted at `/app/data` in all three services.
The indexer writes `events.db` (SQLite) to this path. The keeper and metrics
services share the volume for potential future use (e.g., keeper reports).

| Service  | Writes to `/app/data`? | Reads from `/app/data`? |
| -------- | ---------------------- | ----------------------- |
| keeper   | Yes (benchmarks)       | No                      |
| indexer  | Yes (`events.db`)      | Yes (resume cursor)     |
| metrics  | No                     | No                      |

To persist data across container restarts, the named volume is used
automatically. To back up the database:

```bash
docker compose exec indexer cat /app/data/events.db > events-backup.db
```

### Healthchecks

All services have health checks configured:

| Service  | Check method          | Interval | Timeout | Start period | Retries |
| -------- | --------------------- | -------- | ------- | ------------ | ------- |
| keeper   | RPC `getHealth`       | 60s      | 10s     | 15s          | 3       |
| indexer  | RPC `getHealth`       | 60s      | 10s     | 15s          | 3       |
| metrics  | HTTP GET `/metrics`   | 30s      | 5s      | 10s          | 3       |

Check service health:

```bash
docker compose ps
docker compose inspect --format='{{.State.Health.Status}}' payflow-keeper
```

### Startup / shutdown

Start all services (keeper + indexer + metrics):

```bash
cd scripts
cp .env.example .env   # then set CONTRACT_ID, KEEPER_PUBLIC_KEY, KEEPER_SECRET
docker compose up -d
docker compose logs -f
```

Start only the keeper:

```bash
docker compose up -d keeper
```

Start keeper + indexer (without metrics):

```bash
docker compose up -d keeper indexer
```

View logs for a specific service:

```bash
docker compose logs -f keeper
docker compose logs -f indexer
docker compose logs -f metrics
```

Stop all services:

```bash
docker compose down
```

Stop and remove volumes (deletes events.db):

```bash
docker compose down -v
```

Build without Compose:

```bash
cd scripts
docker build -t payflow-keeper .
docker run --rm --env-file .env --name payflow-keeper payflow-keeper
```

### Dockerfile

Single stage (`scripts/Dockerfile`):

1. **runtime** (`node:20-alpine`): production `npm ci --omit=dev`, installs `tsx`
   globally, creates `/app/data` directory, copies all source files, runs as
   non-root `node` user. `CMD ["tsx", "keeper.js"]` (Compose overrides for
   indexer/metrics with `tsx indexer.ts` / `tsx metrics-server.ts`).

The Dockerfile uses `tsx` for runtime TypeScript execution (matching local
development), avoiding a separate compilation step. The `HEALTHCHECK` command
uses `RPC_URL` to probe the Soroban RPC endpoint.

| Property            | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Base image          | `node:20-alpine`                                                        |
| Run user            | `node` (non-root)                                                       |
| Default CMD         | `tsx keeper.ts`                                                          |
| Health check        | `wget` → RPC `getHealth` (60 s / timeout 10 s / start 15 s / retries 3) |
| Restart policy      | `unless-stopped`                                                        |
| Log driver          | `json-file` (max-size 10m, max-file 5)                                  |
| Resources (keeper)  | limits 0.50 CPU / 256M; reservations 0.05 / 64M                         |
| Resources (indexer) | limits 0.50 CPU / 256M; reservations 0.05 / 64M                         |
| Resources (metrics) | limits 0.25 CPU / 128M; reservations 0.05 / 32M                         |

---

## Environment matrix

Variables actually used by keeper, indexer, metrics-server, Compose, or the
keeper Dockerfile. Defaults are from source or `.env.example`.

| Variable | Default / example | Used by | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `CONTRACT_ID` | empty; `.env.example` blank | keeper, indexer | Deployed contract ID | Required (validateEnv / indexer exit 1). Metrics header lists it but does not read it. Compose via `.env`. |
| `KEEPER_SECRET` | empty | keeper | Sign keeper transactions | Required unless `DRY_RUN=true`. Testnet `S…` only in examples. |
| `KEEPER_PUBLIC_KEY` | `""` | keeper | Source account pubkey | Required by `validateEnv` (including dry-run). **Not** in `.env.example`. |
| `DRY_RUN` | unset → live | keeper | Simulation vs live | Only `"true"` enables dry-run. Not in `.env.example`. |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | keeper, indexer, Dockerfile HEALTHCHECK | Soroban RPC | Compose via `.env`. Metrics header only. |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET` / `.env.example`: `Test SDF Network ; September 2015` | keeper | Network passphrase | Indexer header only — not read by indexer. |
| `BATCH_SIZE` | `50` (clamped 1–50) | keeper | Page size for `batch_charge` | Not in `.env.example`. |
| `INTERVAL_SECONDS` | `3600` (min 1) | keeper | Loop interval | Not in `.env.example`. |
| `REPORT_DIR` | `<script_dir>/data/benchmarks` | keeper | Dry-run reports / live pointer | Not in `.env.example`. |
| `CHARGE_INTERVAL_MS` | `3600000` in `.env.example` | **none (stale example)** | — | Listed in `.env.example`; **not read** by current `keeper.ts`. |
| `PAGE_SIZE` | `100` in `.env.example` | **none (stale example)** | — | Listed in `.env.example`; **not read** by current `keeper.ts`. |
| `MAX_RETRIES` | `3` in `.env.example` | **none (stale example)** | — | Listed in `.env.example`; **not read** by current `keeper.ts`. |
| `LOG_LEVEL` | `info` | keeper, indexer | Log verbosity | All four core scripts (keeper, indexer, health-check, alert-failed-charges) now use the shared logger and respect `LOG_LEVEL`. Set `LOG_FORMAT=json` for JSON-lines output. |
| `DATA_DIR` | `data` | indexer | SQLite directory | Compose volume is `/app/data` if indexer is run there. Not in `.env.example`. |
| `DB_FILE` | `DATA_DIR/events.db` | indexer | SQLite path override | Not in `.env.example`. |
| `POLL_INTERVAL_MS` | `10000` | indexer | Event poll interval | Not in `.env.example`. |
| `START_LEDGER` | unset → latest | indexer | First-run start ledger | Not in `.env.example`. |
| `METRICS_PORT` | `9090` | metrics-server | HTTP listen port | Not in `.env.example` or Compose. |
| `NODE_ENV` | `production` (image) | Docker runtime | Node environment | Set in Dockerfile. |
| `NODE_OPTIONS` | `--unhandled-rejections=throw` | Docker runtime | Crash on unhandled rejections | Set in Dockerfile. |
| Variable             | Default / example                                                        | Used by                                 | Purpose                       | Notes                                                                                           |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `CONTRACT_ID`        | empty; `.env.example` blank                                              | keeper, indexer                         | Deployed contract ID          | Required (exit 1 if missing). Metrics header lists it but does not read it. Compose via `.env`. |
| `KEEPER_SECRET`      | empty                                                                    | keeper                                  | Sign keeper transactions      | Required in the primary config block. Testnet `S…` only in examples.                            |
| `KEEPER_PUBLIC_KEY`  | empty; `.env.example` blank                                              | keeper                                  | Source account pubkey         | Required by `validateEnv`. Now included in `.env.example`.                                      |
| `DRY_RUN`            | `false`; `.env.example`                                                  | keeper                                  | Simulation vs live            | Set `"true"` to enable dry-run. Included in `.env.example`.                                     |
| `RPC_URL`            | `https://soroban-testnet.stellar.org`                                    | keeper, indexer, Dockerfile HEALTHCHECK | Soroban RPC                   | Compose via `.env`. Metrics header only.                                                        |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET` / `.env.example`: `Test SDF Network ; September 2015` | keeper                                  | Network passphrase            | Indexer header only — not read by indexer.                                                      |
| `BATCH_SIZE`         | `50` (clamped 1–50)                                                      | keeper                                  | Page size for `batch_charge`  | Included in `.env.example`.                                                                     |
| `INTERVAL_SECONDS`   | `3600`                                                                   | keeper                                  | Loop interval                 | Included in `.env.example`.                                                                     |
| `KEEPER_USE_LEGACY_PAGING` | `false`                                                            | keeper                                  | Use legacy sequential paging | Included in `.env.example`.                                                                     |
| `LOG_LEVEL`          | `info`                                                                   | keeper, indexer                         | Log verbosity                 | Indexer: `debug` \| `info` \| `error`.                                                          |
| `DATA_DIR`           | `data`                                                                   | indexer                                 | SQLite directory              | In Docker, mounted to `/app/data` via shared volume. Included in `.env.example`.                |
| `DB_FILE`            | `DATA_DIR/events.db`                                                     | indexer                                 | SQLite path override          | Optional. Included in `.env.example` (commented out).                                           |
| `POLL_INTERVAL_MS`   | `10000`                                                                  | indexer                                 | Event poll interval           | Included in `.env.example`.                                                                     |
| `START_LEDGER`       | unset → latest                                                           | indexer                                 | First-run start ledger        | Optional. Included in `.env.example` (commented out).                                           |
| `METRICS_PORT`       | `9090`                                                                   | metrics-server                          | HTTP listen port              | Included in `.env.example`.                                                                     |
| `REPORT_DIR`         | `<script_dir>/data/benchmarks`                                           | keeper                                  | Dry-run reports / live pointer | Not in `.env.example`.                                                                          |
| `NODE_ENV`           | `production` (image)                                                     | Docker runtime                          | Node environment              | Set in Dockerfile.                                                                              |
| `NODE_OPTIONS`       | `--unhandled-rejections=throw`                                           | Docker runtime                          | Crash on unhandled rejections | Set in Dockerfile.                                                                              |

Compose itself declares no `environment:` keys; it only loads `.env`.

---

## events.db persistence

| Question                          | Answer                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is it stored?               | Default `data/events.db` relative to the process cwd (`DATA_DIR` + `events.db`), or `DB_FILE` if set. In Docker, mounted at `/app/data/events.db` via the `events-data` named volume.                                                                                                                                         |
| Which component uses it?          | **`indexer.ts`** (and `query-events.ts` when pointed at the same file). The keeper writes benchmark reports to the same volume. The metrics server does not access the database.                                                                                                                                              |
| Must it survive restarts?         | **Yes**, if you need cursor continuity. `meta.last_ledger` lives in the same file.                                                                                                                                                                                                                                            |
| Docker volume?                    | Compose mounts named volume `events-data` at `/app/data` for all three services. The indexer writes `events.db` here. The keeper writes benchmark files to `/app/data/benchmarks/`.                                                                                                                                           |
| If the database is deleted/reset? | A new empty DB is opened and schema is recreated. `last_ledger` is missing, so the indexer takes the first-run path: `START_LEDGER` if set and `> 0`, otherwise the **latest** ledger. Local event history is gone; the indexer does not walk the full chain unless you set `START_LEDGER` (and RPC still has those ledgers). |
| Backup / replay?                  | Back up the SQLite file (and WAL) if you need history. Historical backfill is documented in [`docs/EVENT-DRIVEN-GUIDE.md`](../docs/EVENT-DRIVEN-GUIDE.md) via [`replay-events.ts`](replay-events.ts) — that is a separate RPC replay path, not an automatic restore of `events.db`.                                           |

---

## DLQ, replay, and failover

This ops guide does not reproduce those playbooks:

| Topic                             | Where                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Keeper overview + runbook pointer | [`docs/KEEPER.md`](../docs/KEEPER.md)                                                                              |
| Dead-letter queue recovery        | [`docs/operations/keeper_runbook.md`](../docs/operations/keeper_runbook.md) (section “Dead-Letter Queue Recovery”) |
| RPC failover (runbook)            | Same file, section “RPC Failover Configuration”                                                                    |
| TS DLQ replay helper              | [`replay-dlq.ts`](replay-dlq.ts) (default `DLQ_FILE=dlq/failed-batches.jsonl`)                                     |
| Event backfill                    | [`docs/EVENT-DRIVEN-GUIDE.md`](../docs/EVENT-DRIVEN-GUIDE.md), [`replay-events.ts`](replay-events.ts)              |
| **Charge outcome encoding**       | **[`docs/charge-results.md`](../docs/charge-results.md)** - `scvU32` discriminants, event `scvSymbol` keys, DLQ row schema, `null` vs failure |
| Multi-endpoint RPC helper         | [`rpc-client.ts`](rpc-client.ts) (`RPC_URLS`) — **not** imported by the current keeper/indexer entrypoints         |

`replay-dlq.ts` states that `keeper.ts` writes the JSONL DLQ. Confirm that path
against the keeper you actually run before relying on it in production.

### Reading charge outcomes

If you are building anything that needs to know *which subscribers were charged*,
read [`docs/charge-results.md`](../docs/charge-results.md) first. The short
version, because it is easy to get wrong:

- `batch_charge` returns a `Vec<ChargeResult>` where **each element is an
  `scvU32` holding a variant discriminant 0-6** - *not* an `scvSymbol` and not
  a string. Map `0..6` to `Charged`, `Skipped`, `NoSubscription`, `Inactive`,
  `Paused`, `GracePeriodElapsed`, `AllowanceInsufficient`.
- `scvSymbol` appears only in the `batch_charge_skips` event: as `topics[0]`, and
  as the keys of the event's `scvMap` (snake_case field names such as
  `not_due` and `allowance_insufficient`).
- A DLQ row records a **transaction-level** abort. It carries no per-subscriber
  outcome, `tx_xdr` is always `null`, and `error` is free-form text.
- `AllowanceInsufficient` is a successful transaction that transferred nothing
  for one subscriber. It never reaches the DLQ, so alerting on it has to come
  from the event.

The doc also carries drop-in TypeScript and Python decoders, a worked XDR
example with hex and base64, and a list of the in-repo decoders that currently
assume the wrong encoding.

---

## Module Map: Entrypoints, Shared Libraries, and Harnesses

Every script in this directory falls into one of three categories:

| Category | Purpose | Examples |
| --- | --- | --- |
| **Entrypoint** | Runnable CLI tools invoked by operators or CI. Have a `main` function, parse CLI args, and exit with a status code. | `keeper.ts`, `indexer.ts`, `metrics-server.ts`, `deploy-pipeline.ts`, `pre-upgrade-check.ts`, `top-merchants.ts`, `check-allowances.ts`, `alert-expiring-allowances.ts`, `health-check.ts`, `subscription-snapshot.ts`, `daily-revenue-summary.ts`, `export-merchant-report.ts`, `watch-events.ts`, `query-events.ts`, `onboard-merchant.ts`, `rotate-fee-collector.ts`, `migrate-contract.ts`, `replay-dlq.ts`, `replay-events.ts`, `backup-indexer-db.ts`, `grace-period-monitor.ts`, `alert-failed-charges.ts`, `batch-optimizer.ts`, `churn-analysis.ts`, `merchant-analytics.ts`, `subscriber-churn-report.ts`, `subscriber-health-dashboard.ts`, `topup-allowance.ts`, `fee-revenue-report.ts`, `audit-trail.ts`, `snapshot-diff.ts`, `renewal-forecast.ts`, `testnet-setup.ts`, `validate-config.ts`, `soroban-admin.ts` |
| **Shared Library (`lib/`)** | Reusable helpers imported by entrypoints. No `main`; export pure functions or classes. | `lib/dry-run-stats.ts`, `lib/forecast.ts`, `lib/scval-helpers.ts` |
| **Internal Harness** | Benchmarking, testing, or development tools not meant for production operations. | `keeper-benchmark.ts`, `watch-events.ts` (also entrypoint), `contrast-check.mjs`, `lint-duplicates.ts`, `lint-duplicates.mjs`, `generate-types.sh` |

### Shared Helper Locations

| Helper | Location | Purpose |
| --- | --- | --- |
| ScVal encoding/decoding | `lib/scval-helpers.ts` | Soroban Value (ScVal) serialization helpers for contract interaction |
| Structured logging | `logger.ts` | JSON/human log formatter with child context binding |
| Configuration parsing | `config.ts` | Zod schema for env vars, deprecation alias handling (`KEEPER_SECRET`→`SECRET_KEY`, `NETWORK_PASSTHRASE`→`NETWORK_PASSPHRASE`) |
| RPC client with failover | `rpc-client.ts` | Multi-endpoint RPC client (`RPC_URLS`) |
| Dry-run statistics | `lib/dry-run-stats.ts` | Aggregation of `ChargeResult` pages for keeper dry-run reports |
| Forecasting utilities | `lib/forecast.ts` | Renewal forecasting math |
| Database schema | `db/schema.ts` | SQLite schema for indexer |
| Node SQLite mock | `__tests__/support/node-sqlite.ts` | Test mock for `node:sqlite` |

---

## Other scripts

Out of scope for this ops-guide revision. Existing helpers include (non-exhaustive):
`watch-events.ts`, `check-allowances.ts`, `alert-expiring-allowances.ts`,
`health-check.ts`, `subscription-snapshot.ts`, `daily-revenue-summary.ts`,
`export-merchant-report.ts`, `pre-upgrade-check.ts`, `snapshot-diff.ts`,
`deploy-pipeline.ts`, `replay-dlq.ts`, `replay-events.ts`.

**Adding a charge-outcome column to an export?** The report scripts read the
indexer's stored events, so they work from the `batch_charge_skips` aggregate
rather than from per-subscriber results. If you need per-subscriber outcomes,
read the return value, and get the encoding right:
[`docs/charge-results.md`](../docs/charge-results.md). The two spellings of the
same outcome differ (`Charged` vs `charged`, `Skipped` vs `not_due`), and mixing
them up is the usual cause of an export that reports every subscriber as
unpaid.

### Daily revenue delivery

Generate the previous UTC day's report, cache it under `data/reports/`, and
optionally deliver it as JSON:

```bash
WEBHOOK_URL=https://hooks.example.com/payflow \
  tsx daily-revenue-summary.ts [--date YYYY-MM-DD] [--webhook <url>] [--force]
```

Set `SLACK_WEBHOOK_URL` to deliver a Slack Block Kit message. A cached report
is skipped, including delivery, unless `--force` is provided. Webhook failures
are logged but do not change the successful report exit status.

### check-allowances

Audit whether subscriber allowances cover their next charge:

```bash
CONTRACT_ID=C... tsx check-allowances.ts --file subscribers.txt
CONTRACT_ID=C... tsx check-allowances.ts GXYZ... GABC...
CONTRACT_ID=C... tsx check-allowances.ts --json --file subscribers.txt
```

### alert-expiring-allowances

Alert on allowances expiring within a configurable ledger window (default 17280 ≈ 24 h):

```bash
CONTRACT_ID=C... tsx alert-expiring-allowances.ts --file subscribers.txt
CONTRACT_ID=C... WEBHOOK_URL=https://hooks.example.com tsx alert-expiring-allowances.ts --file subscribers.txt
CONTRACT_ID=C... tsx alert-expiring-allowances.ts --dry-run --file subscribers.txt
```

Exits with code `1` if any allowances are expiring soon.

### health-check

Contract health check with **shallow** and **deep** modes.
See [`docs/MAINNET-DEPLOYMENT.md`](../docs/MAINNET-DEPLOYMENT.md#3-health).

**Shallow mode** (default): calls `get_schema_version` + `get_active_count`.
Suitable for Docker health checks and lightweight cron monitoring.

**Deep mode** (`--deep` flag or `HEALTH_DEEP=true`):
1. Calls `contract_health_check()` to obtain a full `HealthReport` and validates
   critical invariants: contract not paused, token and admin configured,
   instance TTL above threshold.
2. Calls `get_batch_charge_estimate` with an empty address list to verify the
   charge path is responsive (catches schema drift, RPC decode errors,
   paused-contract state that shallow probes miss).
3. Exits non-zero on any failed invariant.

**JSON output** (`--json`): writes structured JSON to stdout instead of
human-readable log lines. Useful for CI pipelines and log aggregation.

```bash
# Shallow (default)
CONTRACT_ID=C... tsx health-check.ts

# Deep checks
CONTRACT_ID=C... tsx health-check.ts --deep

# JSON output
CONTRACT_ID=C... tsx health-check.ts --json

# Deep + JSON
CONTRACT_ID=C... tsx health-check.ts --deep --json

# Deep via env var (no --deep flag needed)
CONTRACT_ID=C... HEALTH_DEEP=true tsx health-check.ts
```

Exit codes:
- `0` — healthy (all probes passed, no invariant violations)
- `1` — unhealthy (probe failure, paused contract, or failed invariant)

Environment variables:
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `CONTRACT_ID` | yes | — | FlowPay contract ID |
| `RPC_URL` | no | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK` | no | `testnet` | Set `mainnet` for public network |
| `HEALTH_DEEP` | no | `false` | Set `true` to enable deep checks |

JSON output shape:
```json
{
  "status": "healthy|unhealthy",
  "mode": "shallow|deep",
  "contract": "C...",
  "timestamp": "2026-08-30T...",
  "probes": [
    { "name": "get_schema_version", "ok": true, "detail": "..." },
    { "name": "get_active_count", "ok": true, "detail": "..." },
    { "name": "contract_health_check", "ok": true, "detail": "all invariants pass", "data": {...} },
    { "name": "get_batch_charge_estimate", "ok": true, "detail": "empty list accepted, charge path responsive" }
  ],
  "healthReport": { ... },
  "batchEstimate": "..."
}
```

---

## Subscriber health dashboard

### Purpose

Aggregate per-subscriber health for the entire subscriber set. Output JSON
fields are aligned 1:1 with the on-chain `SubscriptionHealth` struct returned
by `get_subscription_health`:

| Field | Type | Description |
| --- | --- | --- |
| `active` | `bool` | Subscription is active |
| `charge_due` | `bool` | Billing interval elapsed, charge is due |
| `within_grace` | `bool` | Subscriber is in the grace window |
| `has_sufficient_allowance` | `bool` | Token allowance covers the subscription amount |
| `is_paused` | `bool` | Subscription is paused |
| `trial_active` | `bool` | Trial period is active |
| `daily_limit_set` | `bool` | A daily spending cap has been configured |

Plus an `address` identity field and ops-specific extensions: `amount`,
`allowance`, `token`, `ttl_remaining`, `expiring_ttl`, `requires_restore`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All subscribers healthy (none paused, no charge due, allowance sufficient) |
| `1` | Any subscriber unhealthy (paused, charge due, no allowance, requires restore) |
| `2` | Hard failure (RPC error, fixture parse error, script crash) |

### Usage

```bash
# Live RPC scan
CONTRACT_ID=C... tsx subscriber-health-dashboard.ts

# Table output
CONTRACT_ID=C... tsx subscriber-health-dashboard.ts --format table

# Fixture-driven run (no RPC needed)
tsx subscriber-health-dashboard.ts --fixtures data/healthy-subscribers.json
# → exit 0 (all healthy)

ntsx subscriber-health-dashboard.ts --fixtures data/unhealthy-subscribers.json
# → exit 1 (at least one unhealthy)

# Write per-subscriber CSV
CONTRACT_ID=C... tsx subscriber-health-dashboard.ts --detail subscribers.csv
```

### JSON output shape

```json
{
  "status": "healthy|unhealthy",
  "summary": {
    "total": 3,
    "total_active": 3,
    "total_healthy": 3,
    "total_unhealthy": 0,
    "paused_count": 0,
    "charge_due_count": 0,
    "grace_period_active_count": 1,
    "no_allowance_count": 0,
    "trial_active_count": 1,
    "daily_limit_set_count": 0,
    "expiring_ttl_count": 0,
    "requires_restore_count": 0,
    "total_indexed": 3,
    "scanned": 3
  },
  "subscribers": [
    {
      "address": "GAZ...",
      "active": true,
      "charge_due": false,
      "within_grace": false,
      "has_sufficient_allowance": true,
      "is_paused": false,
      "trial_active": false,
      "daily_limit_set": false,
      "amount": "10000000",
      "allowance": "50000000",
      "token": "CBDE...",
      "ttl_remaining": 1000000,
      "expiring_ttl": false,
      "requires_restore": false
    }
  ]
}
```

### Fixture files

Fixture files in `data/` enable testing without a live RPC connection:

| File | Description | Expected exit |
| --- | --- | --- |
| `data/healthy-subscribers.json` | All subscribers healthy | `0` |
| `data/unhealthy-subscribers.json` | Mixed health (paused + no allowance + charge due) | `1` |

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `CONTRACT_ID` | — | Required (or use `--fixtures`) |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET` | Stellar network passphrase |
| `PAGE_SIZE` | `50` | Subscriber page size (max 50) |
| `LEDGER_ENTRY_BATCH` | `100` | getLedgerEntries batch size (max 200) |
| `EXPIRING_TTL_LEDGERS` | `500000` | TTL threshold for expiring entries |
| `PROGRESS` | `1` | Set `0` to suppress progress output |

---

## Undocumented operator scripts

The eight maintenance tools below are the ones most likely to be needed during
an incident, and all of them are runnable with nothing but the repository. Each
entry gives the purpose, a command that works as written, and the environment
variables it reads.

| Script | Purpose |
| ------ | ------- |
| [`alert-expiring-allowances.ts`](#alert-expiring-allowancests) | Warn about token allowances about to expire |
| [`churn-analysis.ts`](#churn-analysists) | Cohort retention, churn and projection report |
| [`keeper-benchmark.ts`](#keeper-benchmarkts) | Measure keeper throughput and batch economics |
| [`metrics-server.ts`](#metrics-serverts) | Prometheus exporter for keeper metrics |
| [`migrate-contract.ts`](#migrate-contractts) | Run the storage schema migration |
| [`onboard-merchant.ts`](#onboard-merchantts) | Whitelist merchants, singly or from a CSV |
| [`renewal-forecast.ts`](#renewal-forecastts) | Project upcoming renewals per subscriber |
| [`topup-allowance.ts`](#topup-allowancets) | Top up a subscriber's token allowance |

Run these from the `scripts/` directory, or with `npx tsx scripts/<file>`
from the repository root. They are ESM TypeScript run with `tsx`, not
`ts-node`; see [`docs/KEEPER.md`](../docs/KEEPER.md#runtime-and-invocation).

Flags and environment variables at a glance:

<!-- BEGIN undocumented-scripts -->
| Script | Flags | Environment variables |
| ------ | ----- | --------------------- |
| `alert-expiring-allowances.ts` | `--dry-run`, `--file`, `--help` | `CONTRACT_ID`, `NETWORK_PASSPHRASE`, `ALERT_WINDOW_LEDGERS`, `CONCURRENCY`, `MAX_RETRIES`, `RETRY_BASE_MS`, `WEBHOOK_URL` |
| `churn-analysis.ts` | `--format`, `--db`, `--out`, `--resubscription-logic` | `INDEXER_DB_PATH`, `INDEXER_DB` |
| `keeper-benchmark.ts` | `--dry-run`, `--fixture`, `--simulate` | `CONTRACT_ID`, `KEEPER_SECRET_KEY`, `NETWORK_PASSPHRASE`, `RPC_URL` |
| `metrics-server.ts` | none | `METRICS_PORT` |
| `migrate-contract.ts` | `--dry-run` | `VITE_CONTRACT_ID`, `VITE_NETWORK_PASSPHRASE`, `VITE_RPC_URL` |
| `onboard-merchant.ts` | `--batch`, `--contractId`, `--rpcUrl` | `MERCHANT_ONBOARD_WEBHOOK_URL` |
| `renewal-forecast.ts` | `--db`, `--stdin`, `--json`, `--out` | `DATA_DIR`, `DB_FILE` |
| `topup-allowance.ts` | `--simulate` | `CONTRACT_ID`, `TOKEN_ADDRESS`, `USER_ADDRESS`, `USER_SECRET`, `AMOUNT`, `EXPIRY_LEDGERS`, `NETWORK_PASSPHRASE`, `RPC_URL` |
<!-- END undocumented-scripts -->

`node scripts/gen-undocumented-scripts.mjs --check` fails if any flag or
variable in that table stops matching the source, or if one of these sections
disappears.

### alert-expiring-allowances.ts

Scans live subscriptions and warns about token allowances that are about to
expire, so subscribers can be nudged before a charge starts failing with
`AllowanceInsufficient`. See
[`docs/charge-results.md`](../docs/charge-results.md) for what that outcome
means.

```bash
# Scan and POST each alert to a webhook
CONTRACT_ID=C... WEBHOOK_URL=https://hooks.example.com/payflow \
  npx tsx alert-expiring-allowances.ts

# See what would be sent, without sending it
CONTRACT_ID=C... npx tsx alert-expiring-allowances.ts --dry-run

# Write the alert list to a file instead of POSTing
CONTRACT_ID=C... npx tsx alert-expiring-allowances.ts --file expiring.json

# Flags and their defaults
npx tsx alert-expiring-allowances.ts --help
```

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `CONTRACT_ID` | - | Required. Deployed FlowPay contract ID. |
| `NETWORK_PASSPHRASE` | testnet | Must match the deployment network. |
| `ALERT_WINDOW_LEDGERS` | `17280` | How far ahead to look. 17280 ledgers is roughly 24 hours at 5s blocks. |
| `CONCURRENCY` | `5` | Subscriptions checked in parallel. |
| `MAX_RETRIES` | `3` | RPC retries per subscription. |
| `RETRY_BASE_MS` | `300` | Base backoff between retries. |
| `WEBHOOK_URL` | - | Optional. Without it the script only logs. |

### churn-analysis.ts

Builds a cohort retention and churn report from the indexer's event database:
30- and 90-day retention per monthly cohort, per-merchant churn, and a
projection of next month's churn. Falls back to RPC if the SQLite database is
absent, and says which source it used in `data_source`.

```bash
# Human-readable report from the local indexer DB
npx tsx churn-analysis.ts

# Machine-readable, to a file
npx tsx churn-analysis.ts --format json --out churn.json

# CSV for a spreadsheet
npx tsx churn-analysis.ts --format csv --out churn.csv

# Point at a specific indexer DB
npx tsx churn-analysis.ts --db data/events.db

# Treat a resubscribe as a retention win rather than a new subscriber
npx tsx churn-analysis.ts --resubscription-logic retention
```

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `INDEXER_DB_PATH` | `indexer.db` | Path to the indexer SQLite database. |
| `INDEXER_DB` | `indexer.db` | Fallback when `INDEXER_DB_PATH` is unset. `--db` beats both. |

`--format` accepts `json` or `csv`; anything else is ignored and the default
is used. `--resubscription-logic` accepts `new` (default) or `retention`.

### keeper-benchmark.ts

Measures how the keeper behaves at different batch sizes, so you can pick a
`BATCH_SIZE` from data rather than guesswork. Compares throughput, fee cost
and simulation time across sizes.

```bash
# Run against the live contract, simulating only
CONTRACT_ID=C... npx tsx keeper-benchmark.ts --dry-run

# Repeat the sweep without submitting anything
CONTRACT_ID=C... npx tsx keeper-benchmark.ts --simulate

# Replay a recorded fixture, no RPC at all
npx tsx keeper-benchmark.ts --fixture data/benchmarks/keeper-dryrun-report-sample.json
```

| Variable | Notes |
| -------- | ----- |
| `CONTRACT_ID` | Deployed FlowPay contract ID. Also read from `VITE_CONTRACT_ID`. |
| `KEEPER_SECRET_KEY` | Signing key, for the non-dry-run path. Also read from `SECRET_KEY`. |
| `NETWORK_PASSPHRASE` | Also read from `VITE_NETWORK_PASSPHRASE`. |
| `RPC_URL` | Also read from `VITE_RPC_URL`. |

Use `--fixture` to iterate on keeper changes with no network dependency, and
[`docs/limits.md`](../docs/limits.md) to check the result against the caps
the contract actually enforces.

### metrics-server.ts

Standalone Prometheus exporter for the metrics the keeper records. Useful when
you want metrics without running a keeper cycle, or to confirm the exporter
works before wiring up a full deployment.

```bash
# Default port 9090
npx tsx metrics-server.ts

# Somewhere else
METRICS_PORT=9999 npx tsx metrics-server.ts

# Then
curl -s localhost:9090/metrics | grep flowpay
```

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `METRICS_PORT` | `9090` | HTTP port serving `/metrics`. |

The keeper starts this itself on the same port, so run this script **only** if
you want the exporter without a keeper. Running both will collide on the port.
See [Metrics server](#metrics-server) for the endpoint and Grafana wiring.

### migrate-contract.ts

Runs the contract's storage schema migration and verifies the schema version
actually incremented. Used after a WASM upgrade that introduced a new schema
version.

```bash
# Verify against the manifest, no network write
npx tsx migrate-contract.ts --dry-run

# For real, against a specific contract
VITE_CONTRACT_ID=C... VITE_NETWORK_PASSPHRASE="Public Testnet Stellar Network ; September 2022" \
  VITE_RPC_URL=https://soroban-testnet.stellar.org \
  npx tsx migrate-contract.ts
```

| Variable | Notes |
| -------- | ----- |
| `VITE_CONTRACT_ID` | Contract to migrate. Also read from `CONTRACT_ID`. |
| `VITE_NETWORK_PASSPHRASE` | Also read from `NETWORK_PASSPHRASE`. |
| `VITE_RPC_URL` | Also read from `RPC_URL`. |

The script exits non-zero if the schema version does not increment, which is
the signal that the migration did not apply. Requires the admin key. See
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md#state-migration) for the wider
procedure and [`pre-upgrade-check.ts`](pre-upgrade-check.ts) for the gate that
should run first.

### onboard-merchant.ts

Adds merchants to the contract whitelist, either one at a time or in bulk from
a CSV. Verifies the write landed before reporting success, and can notify a
webhook.

```bash
# One merchant
npx tsx onboard-merchant.ts GABC...

# A CSV of addresses
npx tsx onboard-merchant.ts --batch merchants.csv

# Override the manifest, e.g. against testnet
npx tsx onboard-merchant.ts GABC... --contractId C... --rpcUrl https://soroban-testnet.stellar.org
```

| Variable | Notes |
| -------- | ----- |
| `MERCHANT_ONBOARD_WEBHOOK_URL` | Optional. POSTs the outcome of each onboarding. |

By default the contract ID, RPC URL and network come from
`deployments/manifest.json`; the flags override that. The merchant key must
authorize the write. The batch size is bounded by the contract's whitelist cap
- see [`docs/limits.md`](../docs/limits.md#batch-operations) - and the script
chunks to it.

### renewal-forecast.ts

Projects the next renewal date and amount for every active subscription, so you
can see upcoming revenue and spot subscribers who will fail. Reads either a
SQLite database or a JSON array on stdin.

```bash
# From the local database
npx tsx renewal-forecast.ts --db data/subscriptions.db

# From stdin, as JSON
echo "$SUBSCRIPTIONS" | npx tsx renewal-forecast.ts --stdin

# Machine-readable output to a file
npx tsx renewal-forecast.ts --db data/subscriptions.db --json --out renewals.json
```

| Variable | Notes |
| -------- | ----- |
| `DATA_DIR` | Base directory for the default database location. |
| `DB_FILE` | Explicit database path. `--db` beats both. |

Subscribers that cannot be forecast, e.g. a non-positive subscription amount,
get a `reason` of `validation_error` and a `null` renewal date rather than
being dropped. Filter on that field to find accounts needing attention.

### topup-allowance.ts

Approves a token allowance on behalf of a subscriber, so their next charge
succeeds. This is the direct remedy for
`ChargeResult::AllowanceInsufficient`.

```bash
# Simulate only
CONTRACT_ID=C... TOKEN_ADDRESS=C... USER_ADDRESS=G... \
USER_SECRET=S... AMOUNT=5000000000 \
  npx tsx topup-allowance.ts --simulate

# For real
CONTRACT_ID=C... TOKEN_ADDRESS=C... USER_ADDRESS=G... \
USER_SECRET=S... AMOUNT=5000000000 \
  npx tsx topup-allowance.ts
```

| Variable | Notes |
| -------- | ----- |
| `CONTRACT_ID` | Required. FlowPay contract that will spend the allowance. |
| `TOKEN_ADDRESS` | Required. The SAC token being approved. |
| `USER_ADDRESS` | Required. The subscriber's public key. |
| `USER_SECRET` | Required to sign. The subscriber's own secret. |
| `AMOUNT` | Required. Allowance in stroops. |
| `EXPIRY_LEDGERS` | Optional. Approvals default to expiring. |
| `NETWORK_PASSPHRASE`, `RPC_URL` | Standard overrides. |

**This script needs the subscriber's secret key.** That is the subscriber's
own authority to spend their balance, and it is not something an operator
should hold in bulk. Prefer asking the subscriber to raise their own allowance;
use this for a one-off rescue, and always with `--simulate` first. `AMOUNT`
is in stroops, so 1 XLM is `10000000`.

## Environment variable reference

All scripts read configuration from environment variables. The full set used
across all scripts:

| Variable               | Used by                                         | Description                                                                          |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CONTRACT_ID`          | all                                             | Deployed FlowPay contract ID                                                         |
| `RPC_URL`              | all                                             | Soroban RPC endpoint                                                                 |
| `NETWORK_PASSPHRASE`   | keeper, check-allowances                        | Stellar network passphrase                                                           |
| `KEEPER_PUBLIC_KEY`    | keeper                                          | Source account public key (must be funded on the network)                            |
| `KEEPER_SECRET`        | keeper                                          | Stellar secret key (S…) for signing transactions (required in live mode)             |
| `DRY_RUN`              | keeper                                          | Set `true` to simulate charges without submitting transactions                       |
| `BATCH_SIZE`           | keeper                                          | Subscriptions per batch_charge call (default 50, max 50)                             |
| `INTERVAL_SECONDS`     | keeper                                          | Seconds between charge cycles (default 3600)                                         |
| `REPORT_DIR`           | keeper                                          | Directory for dry-run reports and live-cycle pointer (default: `data/benchmarks`)    |
| `WEBHOOK_URL`          | alert-expiring-allowances, alert-failed-charges | Webhook POST target                                                                  |
| `ALERT_WINDOW_LEDGERS` | alert-expiring-allowances                       | Expiry alert threshold                                                               |
| `DATA_DIR`             | indexer, query-events                           | SQLite database directory                                                            |
| `DB_FILE`              | indexer, query-events                           | SQLite database path override                                                        |
| `POLL_INTERVAL_MS`     | indexer                                         | Event polling interval                                                               |
| `START_LEDGER`         | indexer                                         | First-run start ledger                                                               |
| `LOG_LEVEL`            | keeper, indexer, health-check, alert-failed-charges | Log verbosity (`debug` \| `info` \| `warn` \| `error`, default `info`)          |
| `LOG_FORMAT`           | keeper, indexer, health-check, alert-failed-charges | Set to `json` for JSON-lines output (recommended in Docker)                     |
| Variable               | Used by                                         | Description                                                                       |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `CONTRACT_ID`          | all                                             | Deployed FlowPay contract ID                                                      |
| `RPC_URL`              | all                                             | Soroban RPC endpoint                                                              |
| `NETWORK_PASSPHRASE`   | keeper, check-allowances                        | Stellar network passphrase                                                        |
| `KEEPER_PUBLIC_KEY`    | keeper                                          | Source account public key (must be funded on the network)                         |
| `KEEPER_SECRET`        | keeper                                          | Stellar secret key (S…) for signing transactions (required in live mode)          |
| `DRY_RUN`              | keeper                                          | Set `true` to simulate charges without submitting transactions                    |
| `BATCH_SIZE`           | keeper                                          | Subscriptions per batch_charge call (default 50, max 50)                          |
| `INTERVAL_SECONDS`     | keeper                                          | Seconds between charge cycles (default 3600)                                      |
| `REPORT_DIR`           | keeper                                          | Directory for dry-run reports and live-cycle pointer (default: `data/benchmarks`) |
| `WEBHOOK_URL`          | alert-expiring-allowances, alert-failed-charges | Webhook POST target                                                               |
| `ALERT_WINDOW_LEDGERS` | alert-expiring-allowances                       | Expiry alert threshold                                                            |
| `DATA_DIR`             | indexer, query-events                           | SQLite database directory                                                         |
| `DB_FILE`              | indexer, query-events                           | SQLite database path override                                                     |
| `POLL_INTERVAL_MS`     | indexer                                         | Event polling interval                                                            |
| `START_LEDGER`         | indexer                                         | First-run start ledger                                                            |
| `LOG_LEVEL`            | keeper, indexer                                 | Log verbosity                                                                     |

## Related

- Mainnet gates: [`docs/MAINNET-DEPLOYMENT.md`](../docs/MAINNET-DEPLOYMENT.md)
- Keeper handbook: [`docs/KEEPER.md`](../docs/KEEPER.md)
- Contract API (`batch_charge`, health, estimates): [`docs/API.md`](../docs/API.md)
## Contract Upgrades (Ops Section)

When upgrading the FlowPay smart contract, it is crucial to ensure that the internal state remains safe and consistent. The \pre-upgrade-check.ts\ tool, along with snapshots and migration scripts, provides a robust automated runbook for safe upgrades.

### Upgrade Runbook

1. **Take a Pre-Upgrade Snapshot**
   Capture the exact state of all subscriptions before any migration takes place:
   \\\ash
   npx tsx scripts/subscription-snapshot.ts --out before-upgrade.json
   \\\

2. **Run Automated Pre-Upgrade Checks**
   Verify the schema version, fee configurations, and active_count drift against your snapshot:
   \\\ash
   CONTRACT_ID=<C...> npx tsx scripts/pre-upgrade-check.ts \
     --snapshot before-upgrade.json \
     --max-drift 0 \
     --report pre-upgrade-report.json \
     --wasm ./target/wasm32-unknown-unknown/release/flowpay.wasm
   \\\
   - **Schema Version**: Ensures the existing on-chain schema is safe to upgrade to the new version.
   - **Active Count Drift**: Cross-checks \get_active_count()\ with the snapshot \count\. Fails (CI-like exit code \1\) if the drift exceeds \--max-drift\.
   - **Fee Config**: Asserts the fee configurations remain intact.
   - **Report Artifact**: A \pre-upgrade-report.json\ file is generated, which can be saved in CI artifacts.

3. **Migrate the Contract**
   If \pre-upgrade-check.ts\ passes successfully, proceed with the actual WASM upgrade and migration step (e.g. via \migrate-contract.ts\).

4. **Verify Post-Upgrade State**
   Take another snapshot and compare the differences:
   \\\ash
   npx tsx scripts/subscription-snapshot.ts --out after-upgrade.json
   npx tsx scripts/snapshot-diff.ts before-upgrade.json after-upgrade.json
   \\\
   This will fail with an exit code \1\ if unexpected changes occurred.
