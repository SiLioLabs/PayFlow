# PayFlow Scripts

Operational scripts for the FlowPay recurring-billing contract. All scripts are
written in TypeScript and executed with [tsx](https://github.com/privatenumber/tsx)
(no compile step needed for local use).

## Prerequisites

- Node.js 20+
- `npm install` inside this directory

```bash
cd scripts
npm install
```

---

## Scripts

| Script                         | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `keeper.ts`                    | Autonomous keeper — calls `batch_charge` on a schedule    |
| `watch-events.ts`              | Real-time contract event monitor                          |
| `check-allowances.ts`          | Audit subscriber token allowances                         |
| `alert-expiring-allowances.ts` | Alert on allowances expiring within a configurable window |
| `indexer.ts`                   | Persist contract events to SQLite                         |
| `query-events.ts`              | Query the SQLite event database                           |
| `health-check.ts`              | Contract responsiveness check                             |
| `subscription-snapshot.ts`     | Snapshot all subscription states                          |
| `daily-revenue-summary.ts`     | Daily revenue report                                      |
| `export-merchant-report.ts`    | Per-merchant activity report                              |

---

## Keeper

The keeper bot pages through every active subscription and invokes
`batch_charge(offset, limit)` until all pages are processed, then sleeps until
the next cycle.

### Run locally

```bash
CONTRACT_ID=C...  \
KEEPER_SECRET=S...  \
tsx keeper.ts
```

Optional variables (all have defaults):

| Variable             | Default            | Description                                     |
| -------------------- | ------------------ | ----------------------------------------------- |
| `RPC_URL`            | testnet RPC        | Soroban RPC endpoint                            |
| `NETWORK_PASSPHRASE` | testnet passphrase | Stellar network passphrase                      |
| `CHARGE_INTERVAL_MS` | `3600000` (1 h)    | Sleep between full charge cycles                |
| `PAGE_SIZE`          | `100`              | Subscriptions per `batch_charge` call (max 100) |
| `MAX_RETRIES`        | `3`                | Per-page retries before skipping                |
| `LOG_LEVEL`          | `info`             | `debug` \| `info` \| `warn` \| `error`          |

---

## Docker

### 1. Configure environment

Copy the example env file and fill in the required values:

```bash
cp .env.example .env
# edit .env — set CONTRACT_ID and KEEPER_SECRET at minimum
```

The `.env` file is loaded by Docker Compose at runtime and is **never baked
into the image**.

### 2. Build the image

```bash
# From the scripts/ directory:
docker build -t payflow-keeper .
```

The build uses two stages:

1. **builder** — installs all dependencies and compiles `keeper.ts` → `dist/keeper.js`
2. **runtime** — copies only `dist/` and production dependencies into a slim
   `node:20-alpine` image running as the non-root `node` user

### 3. Run with Docker Compose

```bash
docker compose up -d
```

To follow logs:

```bash
docker compose logs -f keeper
```

To stop:

```bash
docker compose down
```

### 4. Run with plain `docker run`

```bash
docker run --rm \
  --env-file .env \
  --name payflow-keeper \
  payflow-keeper
```

### 5. Smoke test

After the container starts, check that it logged a successful startup line:

```bash
docker compose logs keeper | grep '"msg":"FlowPay Keeper starting"'
```

A healthy keeper emits a JSON log line like:

```json
{
  "ts": "2026-01-01T00:00:00.000Z",
  "level": "info",
  "msg": "FlowPay Keeper starting",
  "contract": "C...",
  "keeper": "G...",
  "rpc": "https://...",
  "charge_interval_ms": 3600000,
  "page_size": 100,
  "max_retries": 3
}
```

### Docker image details

| Property       | Value                                    |
| -------------- | ---------------------------------------- |
| Base image     | `node:20-alpine`                         |
| Run user       | `node` (non-root, UID 1000)              |
| Entrypoint     | `node dist/keeper.js`                    |
| Health check   | `wget` → RPC `getHealth` (60 s interval) |
| Restart policy | `unless-stopped`                         |
| Log driver     | `json-file` (10 MB × 5 files)            |
| Graceful stop  | 60 s before SIGKILL                      |

---

## Event Indexer

Persists contract events to a local SQLite database (`data/events.db`).
Resumes from the last indexed ledger on restart.

```bash
CONTRACT_ID=C... tsx indexer.ts
```

Optional variables:

| Variable           | Default          | Description               |
| ------------------ | ---------------- | ------------------------- |
| `RPC_URL`          | testnet RPC      | Soroban RPC endpoint      |
| `DATA_DIR`         | `data`           | Directory for `events.db` |
| `DB_FILE`          | `data/events.db` | Full path override        |
| `POLL_INTERVAL_MS` | `10000` (10 s)   | Polling interval          |
| `START_LEDGER`     | latest ledger    | First-run start ledger    |
| `LOG_LEVEL`        | `info`           | Log verbosity             |

### Query stored events

```bash
# Most recent 20 events
tsx query-events.ts --recent --pretty

# All events for a subscriber
tsx query-events.ts --address GXYZ... --pretty

# Events of a specific type
tsx query-events.ts --type charged --pretty

# Events in a ledger range
tsx query-events.ts --ledger 500000 --to 510000
```

---

## Other Scripts

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

Verify the contract is responsive (suitable for cron or Docker `HEALTHCHECK`):

```bash
CONTRACT_ID=C... tsx health-check.ts
# exit 0 = healthy, exit 1 = unhealthy
```

---

## Environment variable reference

All scripts read configuration from environment variables. The full set used
across all scripts:

| Variable               | Used by                                         | Description                                      |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `CONTRACT_ID`          | all                                             | Deployed FlowPay contract ID                     |
| `RPC_URL`              | all                                             | Soroban RPC endpoint                             |
| `NETWORK_PASSPHRASE`   | keeper, check-allowances                        | Stellar network passphrase                       |
| `KEEPER_SECRET`        | keeper                                          | Stellar secret key (S…) for signing transactions |
| `CHARGE_INTERVAL_MS`   | keeper                                          | Sleep between charge cycles                      |
| `PAGE_SIZE`            | keeper                                          | Subscriptions per batch_charge page              |
| `MAX_RETRIES`          | keeper                                          | Per-page retry limit                             |
| `WEBHOOK_URL`          | alert-expiring-allowances, alert-failed-charges | Webhook POST target                              |
| `ALERT_WINDOW_LEDGERS` | alert-expiring-allowances                       | Expiry alert threshold                           |
| `DATA_DIR`             | indexer, query-events                           | SQLite database directory                        |
| `DB_FILE`              | indexer, query-events                           | SQLite database path override                    |
| `POLL_INTERVAL_MS`     | indexer                                         | Event polling interval                           |
| `START_LEDGER`         | indexer                                         | First-run start ledger                           |
| `LOG_LEVEL`            | keeper, indexer                                 | Log verbosity                                    |
