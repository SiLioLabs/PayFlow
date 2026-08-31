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
# Current keeper.ts requires KEEPER_PUBLIC_KEY even though .env.example omits it.

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

# Docker Compose (keeper service only)
docker compose up -d
docker compose logs -f keeper
docker compose down
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

- Local process: logs `[LIVE] Keeper started in LIVE mode` or
  `[DRY-RUN] Keeper started in DRY-RUN mode — no transactions will be submitted`.
  There is **no** SIGINT/SIGTERM handler; loop mode sleeps `INTERVAL_SECONDS`
  between cycles. `--once` exits 0 unless the cycle had errors and
  `totalCharged === 0` (then exit 1).
- Docker image `HEALTHCHECK`: `wget` POST `getHealth` to
  `${RPC_URL:-https://soroban-testnet.stellar.org}` and grep
  `"status":"healthy"` (60 s interval). This probes **RPC**, not the keeper
  loop itself.
- Compose: `restart: unless-stopped`, `stop_grace_period: 60s`.

Smoke after Compose:

```bash
docker compose logs keeper | grep -E "Keeper started in (LIVE|DRY-RUN) mode"
```

### Logs and metrics

- Prefix logger: `[DRY-RUN]` or `[LIVE]` on stdout. `keeper.ts` does **not**
  read `LOG_LEVEL`.
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

`docker-compose.yml` defines **one** service:

```text
.host .env
    └── keeper (container_name: payflow-keeper, image: payflow-keeper:latest)
            ├── env_file: .env
            ├── volume: keeper-data → /app/data
            ├── restart: unless-stopped
            └── stop_grace_period: 60s
```

There is **no** `depends_on`, **no** `ports:` mapping, and **no** indexer,
metrics-server, Prometheus, or Grafana service.

### Ports

None published. The keeper does not listen for HTTP. Metrics, if run on the
host, use `METRICS_PORT` (default 9090) outside Compose.

### Environment

Compose loads `scripts/.env` via `env_file`. Copy from `.env.example`. The
`.env` file is **not** baked into the image.

### Persistent volumes

Named volume `keeper-data` mounted at `/app/data`. The Compose comment says
this is for the SQLite DB written by `indexer.ts`. The Compose file **does not
start the indexer**, so `/app/data` stays empty unless you run indexer yourself
with `DATA_DIR=/app/data` (or bind-mount the same volume).

### Startup / shutdown

```bash
cd scripts
cp .env.example .env   # then set CONTRACT_ID, KEEPER_PUBLIC_KEY, KEEPER_SECRET
docker compose up -d
docker compose logs -f keeper
docker compose down
```

Build without Compose:

```bash
cd scripts
docker build -t payflow-keeper .
docker run --rm --env-file .env --name payflow-keeper payflow-keeper
```

### Dockerfile

Two stages (`scripts/Dockerfile`):

1. **builder** (`node:20-alpine`): `npm ci --frozen-lockfile`, copies
   `keeper.ts` only, compiles via `npm run build` (`tsconfig.build.json`
   includes **only** `keeper.ts`) → `/build/dist/keeper.js`. Current
   `keeper.ts` imports `./batch-optimizer`, which this `COPY` list does not
   include — confirm `docker build` succeeds in your tree before relying on
   Compose.
2. **runtime**: production `npm ci --omit=dev`, `USER node`, `CMD`
   `["node", "dist/keeper.js"]`, `NODE_ENV=production`,
   `NODE_OPTIONS=--unhandled-rejections=throw`

`HEALTH_CHECK_URL` is mentioned in a comment; the `HEALTHCHECK` command uses
`RPC_URL` only.

| Property            | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Base image          | `node:20-alpine`                                                        |
| Run user            | `node` (non-root)                                                       |
| Entrypoint / CMD    | `node dist/keeper.js`                                                   |
| Health check        | `wget` → RPC `getHealth` (60 s / timeout 10 s / start 15 s / retries 3) |
| Restart policy      | `unless-stopped`                                                        |
| Log driver          | `json-file` (max-size 10m, max-file 5)                                  |
| Resources (Compose) | limits 0.50 CPU / 256M; reservations 0.05 / 64M                         |

---

## Environment matrix

Variables actually used by keeper, indexer, metrics-server, Compose, or the
keeper Dockerfile. Defaults are from source or `.env.example`.

| Variable             | Default / example                                                        | Used by                                 | Purpose                       | Notes                                                                                           |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `CONTRACT_ID`        | empty; `.env.example` blank                                              | keeper, indexer                         | Deployed contract ID          | Required (exit 1 if missing). Metrics header lists it but does not read it. Compose via `.env`. |
| `KEEPER_SECRET`      | empty                                                                    | keeper                                  | Sign keeper transactions      | Required in the primary config block. Testnet `S…` only in examples.                            |
| `KEEPER_PUBLIC_KEY`  | `""`                                                                     | keeper (second block)                   | Source account pubkey         | Required by that block's `validateEnv`. Not in `.env.example`.                                  |
| `DRY_RUN`            | `"true"` in second block                                                 | keeper (second block)                   | Simulation vs live            | Not in `.env.example`.                                                                          |
| `RPC_URL`            | `https://soroban-testnet.stellar.org`                                    | keeper, indexer, Dockerfile HEALTHCHECK | Soroban RPC                   | Compose via `.env`. Metrics header only.                                                        |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET` / `.env.example`: `Test SDF Network ; September 2015` | keeper                                  | Network passphrase            | Indexer header only — not read by indexer.                                                      |
| `CHARGE_INTERVAL_MS` | `3600000`                                                                | keeper (first block)                    | Sleep between full cycles     | `.env.example`                                                                                  |
| `PAGE_SIZE`          | `100` (capped at 100)                                                    | keeper (first block)                    | Page size for `batch_charge`  | `.env.example`                                                                                  |
| `MAX_RETRIES`        | `3`                                                                      | keeper (first block)                    | Per-page retries              | `.env.example`                                                                                  |
| `BATCH_SIZE`         | `50` (clamped 1–50)                                                      | keeper (second block)                   | Alternate page size           | Conflicts in name with `PAGE_SIZE`.                                                             |
| `INTERVAL_SECONDS`   | `3600`                                                                   | keeper (second block)                   | Alternate loop interval       |                                                                                                 |
| `LOG_LEVEL`          | `info`                                                                   | keeper, indexer                         | Log verbosity                 | Indexer: `debug` \| `info` \| `error`                                                           |
| `DATA_DIR`           | `data`                                                                   | indexer                                 | SQLite directory              | Compose volume is `/app/data` if indexer is run there. Not in `.env.example`.                   |
| `DB_FILE`            | `DATA_DIR/events.db`                                                     | indexer                                 | SQLite path override          | Not in `.env.example`.                                                                          |
| `POLL_INTERVAL_MS`   | `10000`                                                                  | indexer                                 | Event poll interval           | Not in `.env.example`.                                                                          |
| `START_LEDGER`       | unset → latest                                                           | indexer                                 | First-run start ledger        | Not in `.env.example`.                                                                          |
| `METRICS_PORT`       | `9090`                                                                   | metrics-server                          | HTTP listen port              | Not in `.env.example` or Compose.                                                               |
| `NODE_ENV`           | `production` (image)                                                     | Docker runtime                          | Node environment              | Set in Dockerfile.                                                                              |
| `NODE_OPTIONS`       | `--unhandled-rejections=throw`                                           | Docker runtime                          | Crash on unhandled rejections | Set in Dockerfile.                                                                              |
| Variable | Default / example | Used by | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `CONTRACT_ID` | empty; `.env.example` blank | keeper, indexer | Deployed contract ID | Required (validateEnv / indexer exit 1). Metrics header lists it but does not read it. Compose via `.env`. |
| `KEEPER_SECRET` | empty | keeper | Sign keeper transactions | Required unless `DRY_RUN=true`. Testnet `S…` only in examples. |
| `KEEPER_PUBLIC_KEY` | `""` | keeper | Source account pubkey | Required by `validateEnv` (including dry-run). **Not** in `.env.example`. |
| `KEEPER_USE_LEGACY_PAGING` | unset (optimized) | keeper | Use legacy sequential paging | Set `true` to disable grace-urgency ordering. Default uses `buildOptimizedBatches()`. |
| `DRY_RUN` | unset → live | keeper | Simulation vs live | Only `"true"` enables dry-run. Not in `.env.example`. |
| `RPC_URL` | `https://soroban-testnet.stellar.org` | keeper, indexer, Dockerfile HEALTHCHECK | Soroban RPC | Compose via `.env`. Metrics header only. |
| `NETWORK_PASSPHRASE` | `Networks.TESTNET` / `.env.example`: `Test SDF Network ; September 2015` | keeper | Network passphrase | Indexer header only — not read by indexer. |
| `BATCH_SIZE` | `50` (clamped 1–50) | keeper | Page size for `batch_charge` | Not in `.env.example`. |
| `INTERVAL_SECONDS` | `3600` (min 1) | keeper | Loop interval | Not in `.env.example`. |
| `REPORT_DIR` | `<script_dir>/data/benchmarks` | keeper | Dry-run reports / live pointer | Not in `.env.example`. |
| `CHARGE_INTERVAL_MS` | `3600000` in `.env.example` | **none (stale example)** | — | Listed in `.env.example`; **not read** by current `keeper.ts`. |
| `PAGE_SIZE` | `100` in `.env.example` | **none (stale example)** | — | Listed in `.env.example`; **not read** by current `keeper.ts`. |
| `MAX_RETRIES` | `3` in `.env.example` | **none (stale example)** | — | Listed in `.env.example`; **not read** by current `keeper.ts`. |
| `LOG_LEVEL` | `info` | indexer | Log verbosity | Indexer: `debug` \| `info` \| `error`. Keeper does not read it. `.env.example` still lists it. |
| `DATA_DIR` | `data` | indexer | SQLite directory | Compose volume is `/app/data` if indexer is run there. Not in `.env.example`. |
| `DB_FILE` | `DATA_DIR/events.db` | indexer | SQLite path override | Not in `.env.example`. |
| `POLL_INTERVAL_MS` | `10000` | indexer | Event poll interval | Not in `.env.example`. |
| `START_LEDGER` | unset → latest | indexer | First-run start ledger | Not in `.env.example`. |
| `METRICS_PORT` | `9090` | metrics-server | HTTP listen port | Not in `.env.example` or Compose. |
| `NODE_ENV` | `production` (image) | Docker runtime | Node environment | Set in Dockerfile. |
| `NODE_OPTIONS` | `--unhandled-rejections=throw` | Docker runtime | Crash on unhandled rejections | Set in Dockerfile. |

Compose itself declares no `environment:` keys; it only loads `.env`.

---

## events.db persistence

| Question                          | Answer                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is it stored?               | Default `data/events.db` relative to the process cwd (`DATA_DIR` + `events.db`), or `DB_FILE` if set.                                                                                                                                                                                                                         |
| Which component uses it?          | **`indexer.ts`** (and `query-events.ts` when pointed at the same file). The keeper image/CMD does not write this DB.                                                                                                                                                                                                          |
| Must it survive restarts?         | **Yes**, if you need cursor continuity. `meta.last_ledger` lives in the same file.                                                                                                                                                                                                                                            |
| Docker volume?                    | Compose mounts named volume `keeper-data` at `/app/data`. That path matches the indexer default directory name `data` only if the process cwd is `/app` **and** you run the indexer with `DATA_DIR=/app/data` (or default `data` from `/app`). Compose does not start the indexer.                                            |
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
| Multi-endpoint RPC helper         | [`rpc-client.ts`](rpc-client.ts) (`RPC_URLS`) — **not** imported by the current keeper/indexer entrypoints         |

`replay-dlq.ts` states that `keeper.ts` writes the JSONL DLQ. Confirm that path
against the keeper you actually run before relying on it in production.

---

## Other scripts

Out of scope for this ops-guide revision. Existing helpers include (non-exhaustive):
`watch-events.ts`, `check-allowances.ts`, `alert-expiring-allowances.ts`,
`health-check.ts`, `subscription-snapshot.ts`, `daily-revenue-summary.ts`,
`export-merchant-report.ts`, `pre-upgrade-check.ts`, `snapshot-diff.ts`,
`deploy-pipeline.ts`, `replay-dlq.ts`, `replay-events.ts`.

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

## Environment variable reference

All scripts read configuration from environment variables. The full set used
across all scripts:

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
