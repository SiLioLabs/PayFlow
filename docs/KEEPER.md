# FlowPay Keeper Runbook

This runbook covers everything an operator needs to run the FlowPay keeper service: environment setup, running the TypeScript keeper, batch-charge tuning, dead-letter queue (DLQ) replay, dry-run mode, failover, monitoring, and an accurate reference for `ChargeResult` outcomes.

> **Note:** The keeper is implemented in **TypeScript** (`scripts/keeper.ts`). Legacy Python references have been removed. If you are looking for a Python integration, see [Legacy Python Keeper](#legacy-python-keeper) at the bottom.

---

## Overview

Soroban has no native cron or scheduler. The `charge(user)` and `batch_charge(users)` functions must be called externally on every billing cycle. The keeper is the service that does this.

```
Keeper loop
───────────
1. Fetch list of subscribers due for charge (from indexer or RPC)
2. Split into batches of ≤ PAGE_SIZE (contract max: 20)
3. Call batch_charge(users) on-chain
4. Parse ChargeResult for each user
5. Write failures to DLQ for replay
6. Sleep until next cycle
```

---

## Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| ts-node | 10+ | `npm install -g ts-node typescript` |
| @stellar/stellar-sdk | ^12 | installed via `scripts/package.json` |
| Soroban RPC | any | testnet: `https://soroban-testnet.stellar.org` |
| Funded keeper keypair | — | See [Keypair setup](#keypair-setup) |

Install dependencies:

```bash
cd scripts
npm install
```

---

## Environment Variables

Copy and fill in `.env` at the repo root (or export directly):

```bash
# Required
CONTRACT_ID=CABC...            # Deployed FlowPay contract ID
SOROBAN_SOURCE_ACCOUNT=GABC... # Keeper's Stellar public key
SOROBAN_SECRET_KEY=S...        # Keeper's Stellar secret key (keep safe!)

# Optional (with defaults)
RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
PAGE_SIZE=20                   # Users per batch_charge call (max 20)
KEEPER_INTERVAL_MS=60000       # Poll interval in milliseconds (default: 60s)
DLQ_PATH=data/dlq.json         # Path to dead-letter queue file
LOG_LEVEL=info                 # debug | info | warn | error
INDEXER_DB_PATH=data/events.db # SQLite indexer database path
```

> **`PAGE_SIZE` must not exceed 20.** The FlowPay contract enforces a hard limit
> of 20 addresses per `batch_charge` call. Exceeding this value causes the
> contract to panic with `BatchTooLarge` and the entire transaction fails.
> The keeper's batch optimizer (`scripts/batch-optimizer.ts`) enforces this
> cap automatically.

---

## Keypair Setup

The keeper needs a funded Stellar account to submit transactions.

**Testnet:**

```bash
# Generate a new keypair
soroban keys generate --global keeper --network testnet

# Fund it via Friendbot
curl "https://friendbot.stellar.org?addr=$(soroban keys address keeper)"
```

**Mainnet:** Use a hardware wallet or secrets manager. Never commit secret keys to the repository.

---

## Running the Keeper

### Normal mode

```bash
npx ts-node scripts/keeper.ts
```

The keeper will:

1. Connect to the Soroban RPC
2. Query the indexer for subscribers whose `next_charge_at <= now`
3. Split them into batches of `PAGE_SIZE` (≤ 20)
4. Submit `batch_charge` transactions
5. Write any failed/skipped users to the DLQ
6. Sleep for `KEEPER_INTERVAL_MS` and repeat

### Dry-run mode

Dry-run logs what the keeper *would* charge without submitting any transactions to the network. Use this to validate configuration or preview a billing cycle.

```bash
npx ts-node scripts/keeper.ts --dry-run
```

In dry-run mode:

- All RPC simulation calls are made normally
- No `batch_charge` transactions are broadcast
- Predicted `ChargeResult` per user is printed to stdout
- DLQ is not written

### Single-pass mode

Run one charge cycle and exit (useful for cron-based deployments):

```bash
npx ts-node scripts/keeper.ts --once
```

### Custom page size

```bash
PAGE_SIZE=10 npx ts-node scripts/keeper.ts
```

Note: `PAGE_SIZE` is capped at 20 by the keeper and the contract. Values above 20 are rejected before the transaction is built.

---

## Batch Optimizer

`scripts/batch-optimizer.ts` groups subscribers into optimal batches:

- Chunks the user list into slices of `≤ PAGE_SIZE`
- Prioritises users furthest past their due date (most overdue first)
- Falls back to address-order for same-overdue-time (stable tie-breaking)

The optimizer runs automatically as part of the keeper loop. You can also invoke it standalone to preview batch groupings:

```bash
npx ts-node scripts/batch-optimizer.ts --dry-run
```

---

## ChargeResult Reference

`batch_charge` returns a `Vec<ChargeResult>` — one entry per address in the input list, in the same order.

| Variant | Meaning | Keeper action |
| --- | --- | --- |
| `Charged` | Transfer succeeded; `last_charged` updated | Log success |
| `Skipped` | Interval has not elapsed yet | Ignore; retry next cycle |
| `NoSubscription` | No subscription found for this address | Remove from subscriber list |
| `Inactive` | Subscription is cancelled | Remove from subscriber list |
| `Paused` | Subscription is paused by the user | Skip until resumed |
| `GracePeriodElapsed` | Charge window has closed; subscription is overdue beyond grace | Log warning; notify operator |

A result of `Skipped` is normal and expected — it means the keeper is running more frequently than the billing interval. Results of `NoSubscription` or `Inactive` indicate the subscriber list needs pruning.

---

## Dead-Letter Queue (DLQ)

Failed charges (any result other than `Charged` or `Skipped`) are written to a DLQ file at `DLQ_PATH` (default: `data/dlq.json`).

### DLQ entry format

```json
{
  "user": "GABC...",
  "reason": "GracePeriodElapsed",
  "timestamp": "2026-08-29T12:00:00Z",
  "attempt": 1
}
```

### Inspecting the DLQ

```bash
cat data/dlq.json | jq '.[] | select(.reason != "Skipped")'
```

### Replaying the DLQ

`scripts/replay-dlq.ts` reads the DLQ file and retries each entry:

```bash
# Replay all entries
npx ts-node scripts/replay-dlq.ts

# Dry-run replay (preview only)
npx ts-node scripts/replay-dlq.ts --dry-run

# Replay a specific user
npx ts-node scripts/replay-dlq.ts --user GABC...

# Clear successfully replayed entries
npx ts-node scripts/replay-dlq.ts --clear-on-success
```

After replay, entries with `Charged` outcomes are removed from the DLQ. Persistent failures (e.g. `GracePeriodElapsed`) remain and increment `attempt`.

---

## Running as a Persistent Service

### PM2

```bash
npm install -g pm2
pm2 start "npx ts-node scripts/keeper.ts" --name flowpay-keeper
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY scripts/ ./scripts/
COPY package*.json ./
RUN npm ci
CMD ["npx", "ts-node", "scripts/keeper.ts"]
```

```bash
docker build -t flowpay-keeper .
docker run -d \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  --name flowpay-keeper \
  flowpay-keeper
```

The `data/` volume persists `events.db` and `dlq.json` across container restarts. See [scripts/README.md](../scripts/README.md#backup-indexer-db) for backup instructions.

### systemd

```ini
[Unit]
Description=FlowPay Keeper Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/flowpay
EnvironmentFile=/opt/flowpay/.env
ExecStart=/usr/bin/npx ts-node scripts/keeper.ts
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable flowpay-keeper
sudo systemctl start flowpay-keeper
```

---

## Failover & High Availability

- **Two keepers, one active:** Run a standby keeper with `KEEPER_INTERVAL_MS` staggered by 30 seconds. Because `batch_charge` is idempotent for `Skipped` results, duplicate charge attempts in the same cycle are safe.
- **RPC failover:** Set `RPC_URL` to a load-balanced endpoint or use a list of RPC URLs (comma-separated if your keeper supports it).
- **DLQ persistence:** Back up `data/dlq.json` alongside `data/events.db`. See [scripts/README.md](../scripts/README.md#backup-indexer-db).

---

## Monitoring

| Signal | What to watch |
| --- | --- |
| `Charged` rate | Should match expected subscriber count × billing interval |
| `GracePeriodElapsed` count | Persistent spikes indicate RPC or keeper downtime |
| DLQ depth | Should trend toward zero after replay |
| Keeper process uptime | Use PM2 or systemd watchdog |

Prometheus metrics export and alerting integration are documented in `docs/operations/keeper_runbook.md` (if present).

---

## PAGE_SIZE and Contract Limits

| Parameter | Value | Notes |
| --- | --- | --- |
| `PAGE_SIZE` (env var) | ≤ 20 | Set in `.env`; keeper clamps to 20 automatically |
| `batch_charge` hard cap | **20** | Contract panics `BatchTooLarge` if exceeded |
| `get_top_merchants_by_subs` cap | **20** | Same limit; see `scripts/top-merchants.ts` |
| Grace period | configurable | Set by admin via `set_grace_period(seconds)` |

Always keep `PAGE_SIZE ≤ 20`. The default of 20 is the maximum allowed by the contract.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `BatchTooLarge` panic | `PAGE_SIZE > 20` | Set `PAGE_SIZE=20` or lower |
| `IntervalNotElapsed` | Keeper running too frequently | Normal; result is `Skipped` |
| `GracePeriodElapsed` | Keeper was down for too long | Replay DLQ; check keeper uptime |
| `InsufficientAllowance` | User's token allowance expired | User must call `approve()` again |
| Keeper exits immediately | `SOROBAN_SECRET_KEY` missing | Set env var and retry |
| RPC `getAccount` 404 | Keeper account not funded | Fund account via Friendbot or transfer |

---

## Legacy Python Keeper

Earlier versions of this project included a Python keeper prototype. That implementation is **no longer supported** and should not be used in production.

If you have an existing Python-based keeper, migrate to `scripts/keeper.ts`:

1. Install Node.js 18+ and run `npm install` in the `scripts/` directory
2. Copy your `.env` — the same environment variables are used
3. Replace your Python cron entry with `npx ts-node scripts/keeper.ts --once`

The TypeScript keeper has full feature parity plus DLQ, dry-run, and batch optimizer support that the Python prototype did not have.

---

## See Also

- [`scripts/README.md`](../scripts/README.md) — All scripts reference
- [`docs/API.md`](API.md) — Contract function reference including `batch_charge`
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — System design and data flow
- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — Deploying the contract and migration
- [`docs/SECURITY.md`](SECURITY.md) — Security model and keeper key management
