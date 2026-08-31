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
# Keeper Bot Operations Guide

A keeper is an off-chain service that calls `batch_charge()` on the FlowPay contract on a schedule. Because Soroban contracts cannot self-execute, recurring billing only works if a keeper triggers each charge cycle. Without an active keeper, no subscriptions are processed and merchants receive no revenue.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Running the Reference Keeper](#running-the-reference-keeper)
- [Configuration](#configuration)
- [Recommended Cadence](#recommended-cadence)
- [Monitoring and Alerting](#monitoring-and-alerting)
- [Handling Failed Charges](#handling-failed-charges)
- [Deployment Patterns](#deployment-patterns)
- [Operational Checklist](#operational-checklist)

---

## How It Works

Each subscription stores a `last_charged` timestamp and an `interval` (in seconds). A charge is due when:

```
current_time >= last_charged + interval
```

The contract also enforces a configurable grace period. If a charge is attempted after `last_charged + interval + grace_period`, the result is `GracePeriodElapsed` and the subscription is considered lapsed.

`batch_charge(users)` accepts a list of user addresses and processes each one independently — a failure on one address does not abort the rest. Each entry in the returned `Vec<ChargeResult>` is one of:

| Result                  | Meaning                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Charged`               | Funds transferred successfully                                                                                                                                                                                                                                                   |
| `Skipped`               | Interval has not elapsed yet                                                                                                                                                                                                                                                     |
| `NoSubscription`        | No subscription found for this address                                                                                                                                                                                                                                           |
| `Inactive`              | Subscription is cancelled                                                                                                                                                                                                                                                        |
| `Paused`                | Subscription is paused by the user                                                                                                                                                                                                                                               |
| `GracePeriodElapsed`    | Charge window expired; subscription lapsed                                                                                                                                                                                                                                       |
| `AllowanceInsufficient` | Subscriber's token allowance to the contract is below the gross subscription amount (`sub.amount`). No funds were transferred. The subscription remains active. The keeper should log the address and wait for the subscriber to increase their allowance before the next cycle. |

> **`AllowanceInsufficient` does not abort the batch.** Healthy subscribers before and after an under-allowanced subscriber are still charged normally.

The keeper must page through the full subscriber index using `get_subscriber_index_size()` and `get_subscriber_at(offset)`, then pass slices of addresses to `batch_charge()`.

---


>  **Panic warning**  
> While `batch_charge` returns a `ChargeResult` for normal skips, it **panics** (aborts the entire batch) if any user’s token allowance or balance is insufficient to cover the **gross** subscription amount (including protocol fees). The same happens if the token address is invalid.  
> Therefore, before calling `batch_charge`, always run `simulate_charge` (or `get_batch_charge_estimate`) on the candidate list, and use `check-allowances.ts` to verify that each user has enough allowance. See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#batch_charge-failure-semantics) for the full failure‑modes table.

## Running the Reference Keeper

### Prerequisites

- Python 3.9+
- Soroban RPC endpoint (testnet or mainnet)
- A funded Stellar keypair for the keeper account (minimum 100 XLM recommended)
- The deployed contract ID

### Install dependencies

```bash
pip install stellar-sdk
```

### Reference implementation

```python
#!/usr/bin/env python3
"""FlowPay reference keeper — calls batch_charge() on a schedule."""

import os
import time
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("keeper")

PAGE_SIZE = int(os.getenv("KEEPER_PAGE_SIZE", "100"))
INTERVAL_SECONDS = int(os.getenv("KEEPER_INTERVAL", "3600"))
CONTRACT_ID = os.environ["KEEPER_CONTRACT_ID"]
RPC_URL = os.environ["KEEPER_RPC_URL"]
KEEPER_SECRET = os.environ["KEEPER_SECRET_KEY"]


def get_client():
    from stellar_sdk import Keypair, SorobanServer
    server = SorobanServer(RPC_URL)
    keypair = Keypair.from_secret(KEEPER_SECRET)
    return server, keypair


def fetch_subscriber_page(server, keypair, offset: int, limit: int) -> list:
    """Return up to `limit` subscriber addresses starting at `offset`."""
    # Invoke get_subscriber_at for each position in the page range
    addresses = []
    for i in range(offset, offset + limit):
        result = invoke_read(server, keypair, "get_subscriber_at", {"offset": i})
        if result is None:
            break
        addresses.append(result)
    return addresses


def invoke_read(server, keypair, function_name: str, args: dict):
    """Read-only contract invocation. Returns None on any error."""
    try:
        # Use your preferred Soroban SDK invocation method here
        pass
    except Exception as e:
        logger.warning(f"read {function_name} failed: {e}")
        return None


def run_charge_cycle(server, keypair):
    """Page through all subscribers and call batch_charge() for each page."""
    offset = 0
    total_charged = 0

    while True:
        addresses = fetch_subscriber_page(server, keypair, offset, PAGE_SIZE)
        if not addresses:
            logger.info(f"Cycle complete — {total_charged} charged, {offset} processed")
            break

        try:
            results = invoke_batch_charge(server, keypair, addresses)
            charged = sum(1 for r in results if r == "Charged")
            total_charged += charged
            logger.info(f"Page offset={offset} size={len(addresses)}: {charged} charged")
        except Exception as e:
            logger.error(f"batch_charge failed at offset={offset}: {e}")
            alert("batch_charge_failure", {"offset": offset, "error": str(e)})

        offset += PAGE_SIZE

    return total_charged


def invoke_batch_charge(server, keypair, addresses: list) -> list:
    """Call batch_charge(users) and return the list of ChargeResult strings."""
    # Implement using your Soroban SDK bindings
    raise NotImplementedError


def alert(event: str, context: dict):
    """Send an alert to your monitoring system."""
    logger.critical(f"ALERT {event}: {context}")


def check_balance(server, keypair) -> float:
    """Return the keeper account balance in XLM."""
    # Implement using stellar_sdk account lookup
    return 0.0


def main():
    server, keypair = get_client()

    while True:
        balance = check_balance(server, keypair)
        if balance < 10:
            alert("keeper_balance_low", {"balance_xlm": balance})

        try:
            run_charge_cycle(server, keypair)
        except Exception as e:
            logger.error(f"Keeper loop error: {e}")
            alert("keeper_loop_error", {"error": str(e)})

        logger.info(f"Sleeping {INTERVAL_SECONDS}s until next cycle")
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
```

---

## Configuration

All configuration is read from environment variables. No config file is required.

| Variable                 | Required | Default | Description                                                       |
| ------------------------ | -------- | ------- | ----------------------------------------------------------------- |
| `KEEPER_CONTRACT_ID`     | Yes      | —       | Deployed FlowPay contract ID                                      |
| `KEEPER_RPC_URL`         | Yes      | —       | Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`) |
| `KEEPER_SECRET_KEY`      | Yes      | —       | Stellar secret key for the keeper account (starts with `S`)       |
| `KEEPER_INTERVAL`        | No       | `3600`  | Seconds between charge cycles                                     |
| `KEEPER_PAGE_SIZE`       | No       | `100`   | Addresses per `batch_charge()` call (max 100)                     |
| `KEEPER_ALERT_WEBHOOK`   | No       | —       | Webhook URL for alert notifications                               |
| `KEEPER_MIN_BALANCE_XLM` | No       | `10`    | Alert threshold for keeper account balance                        |

Store `KEEPER_SECRET_KEY` in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) — never commit it to source control.

---

## Recommended Cadence

The right interval depends on the shortest subscription interval used in your deployment.

| Shortest subscription interval | Recommended keeper cadence |
| ------------------------------ | -------------------------- |
| 1 day (86 400 s)               | Every hour                 |
| 1 week                         | Every 4–6 hours            |
| 1 month                        | Every 12–24 hours          |

Run the keeper more frequently than the shortest subscription interval so that users are charged promptly and the grace period buffer is not consumed by keeper downtime.

For most deployments, **hourly** is the correct default. The full charge cycle for 1 000 subscribers completes in under a minute on a healthy RPC node, so there is no cost to running frequently.

---

## Monitoring and Alerting

### Key metrics to track

| Metric                           | Warning threshold | Critical threshold | Action                    |
| -------------------------------- | ----------------- | ------------------ | ------------------------- |
| Keeper account balance           | < 50 XLM          | < 10 XLM           | Top up immediately        |
| Cycle duration                   | > 2 min           | > 5 min            | Check RPC health          |
| Failed `batch_charge` calls      | > 0               | > 5% of pages      | Review error logs         |
| Time since last successful cycle | > 1.5× interval   | > 2× interval      | Page on-call              |
| `GracePeriodElapsed` results     | Any               | —                  | Investigate missed cycles |

### Prometheus / Alertmanager example

```yaml
# keeper_alerts.yml
groups:
  - name: keeper
    rules:
      - alert: KeeperBalanceLow
        expr: keeper_balance_xlm < 10
        for: 5m
        annotations:
          summary: "Keeper account balance below 10 XLM — refund immediately"

      - alert: KeeperCycleMissed
        expr: time() - keeper_last_successful_cycle_timestamp > 7200
        for: 5m
        annotations:
          summary: "No successful keeper cycle in 2 hours"

      - alert: BatchChargeFailure
        expr: increase(keeper_batch_charge_errors_total[15m]) > 0
        annotations:
          summary: "batch_charge returned an error"
```

### Health endpoint (recommended)

Expose a `/health` HTTP endpoint that returns:

```json
{
  "status": "ok",
  "last_cycle_at": 1719443400,
  "last_cycle_charged": 312,
  "keeper_balance_xlm": 87.4,
  "cycle_duration_ms": 14200
}
```

This allows external uptime monitors (e.g. UptimeRobot, Pingdom) to verify the keeper is alive.

---

## Handling Failed Charges

### Per-address failures

`batch_charge()` returns a `ChargeResult` per address and never reverts the whole batch. Log each non-`Charged` result with the address and result type:

```
[2026-06-26T10:00:01Z] INFO  GCXXX...=Skipped
[2026-06-26T10:00:01Z] WARN  GDYYY...=GracePeriodElapsed
[2026-06-26T10:00:01Z] WARN  GEZZZ...=AllowanceInsufficient
```

`GracePeriodElapsed` results are worth alerting on — they indicate a subscription lapsed because the keeper was late. Investigate the cause (keeper downtime, network congestion).

`AllowanceInsufficient` means the subscriber's token allowance to the contract is below their gross subscription amount. No funds were moved and the subscription stays active. The keeper should log the address; no retry is useful until the subscriber increases their allowance. Consider surfacing these to a merchant dashboard or alert channel so subscribers can be notified.

### Full cycle failures

If `batch_charge()` throws an error (not just returns a bad result), the keeper should:

1. Log the error and page offset
2. Retry the same page up to 3 times with exponential backoff (1 s, 2 s, 4 s)
3. If all retries fail, skip that page, continue to the next, and alert

```python
MAX_RETRIES = 3

def batch_charge_with_retry(server, keypair, addresses):
    for attempt in range(MAX_RETRIES):
        try:
            return invoke_batch_charge(server, keypair, addresses)
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = 2 ** attempt
            logger.warning(f"Retrying in {wait}s after error: {e}")
            time.sleep(wait)
```

### Low keeper balance

If the keeper account has insufficient XLM for transaction fees, all invocations will fail. Set up an automated top-up or a balance alert well above the minimum. The keeper should abort the cycle and alert immediately when balance drops below the configured threshold.

### Contract paused

If the contract admin calls `pause_contract()`, all charges return `ContractPaused` (error code 18). The keeper should detect this, log a clear message, and stop cycling until the contract is unpaused. Do not fill logs with repeated failure attempts.

---

## Deployment Patterns

### Simple cron (non-HA)

Suitable for testnet or low-value deployments:

```bash
# /etc/cron.d/payflow-keeper
0 * * * * keeper /opt/keeper/run.py >> /var/log/keeper.log 2>&1
```

Risks: single point of failure; missed cycles if the host restarts.

### Systemd service (recommended for single-node)

```ini
# /etc/systemd/system/payflow-keeper.service
[Unit]
Description=PayFlow Keeper Bot
After=network.target

[Service]
User=keeper
EnvironmentFile=/etc/payflow/keeper.env
ExecStart=/opt/keeper/run.py
Restart=on-failure
RestartSec=30

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
systemctl enable --now payflow-keeper
journalctl -u payflow-keeper -f
```

### High-availability with leader election (production)

Run 2–3 keeper replicas. Only the elected leader executes charge cycles; followers monitor and take over on leader failure. Use Redis `SET NX EX` for a simple distributed lock:

```python
LEASE_TTL = 300  # seconds

def try_acquire_leader(redis_client, keeper_id: str) -> bool:
    return redis_client.set("keeper:leader", keeper_id, ex=LEASE_TTL, nx=True)
```

Renew the lease before it expires. If a leader crashes, the lock expires and a follower acquires it within `LEASE_TTL` seconds.

---

## Operational Checklist

### Before going live

- [ ] Keeper account funded with at least 100 XLM
- [ ] `KEEPER_CONTRACT_ID`, `KEEPER_RPC_URL`, and `KEEPER_SECRET_KEY` set and verified
- [ ] Pagination tested against the production subscriber index
- [ ] Alerting rules deployed and tested with a synthetic low-balance condition
- [ ] Health endpoint reachable and integrated with an uptime monitor
- [ ] Restart policy configured (`Restart=on-failure` or equivalent)

### Routine operations

- [ ] Check keeper balance weekly; automate top-up if possible
- [ ] Review `GracePeriodElapsed` counts after every deploy or maintenance window
- [ ] Rotate the keeper secret key on a regular schedule; update the secrets manager entry
- [ ] After a contract upgrade, verify the keeper ABI matches the new contract interface

### Incident response

| Symptom                                 | First check                     | Resolution                                           |
| --------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| No cycles for > 2 h                     | `journalctl -u payflow-keeper`  | Restart service; check balance                       |
| `GracePeriodElapsed` spikes             | Keeper uptime during the window | Manually invoke missed pages; investigate root cause |
| `batch_charge` throws `InvalidArgument` | Contract upgrade happened       | Redeploy keeper with updated ABI                     |
| Cycle takes > 5 min                     | RPC node latency                | Switch to a backup RPC endpoint                      |

---

## Related

- `batch_charge(users)` — contract function reference: [`docs/API.md`](API.md)
- **Admin ceremonies (upgrade / fee rotation):** pause keepers during WASM commits — [`docs/operations/two_step_admin_playbooks.md`](operations/two_step_admin_playbooks.md)
- Full operations runbook (pagination deep-dive, Terraform IaC, **DLQ recovery, multi-instance coordination, RPC failover, incident pause**): [`docs/operations/keeper_runbook.md`](operations/keeper_runbook.md)
- Full operations runbook (pagination deep-dive, Terraform IaC): [`docs/operations/keeper_runbook.md`](operations/keeper_runbook.md)
- Event-driven charge tracking / gap detection: [`docs/EVENT-DRIVEN-GUIDE.md`](EVENT-DRIVEN-GUIDE.md)
- Architecture and storage layout: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- Error codes: [`docs/ERROR-CODES.md`](ERROR-CODES.md)
- Deployment guide: [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)
