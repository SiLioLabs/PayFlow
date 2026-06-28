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

| Result | Meaning |
|--------|---------|
| `Charged` | Funds transferred successfully |
| `Skipped` | Interval has not elapsed yet |
| `NoSubscription` | No subscription found for this address |
| `Inactive` | Subscription is cancelled |
| `Paused` | Subscription is paused by the user |
| `GracePeriodElapsed` | Charge window expired; subscription lapsed |

The keeper must page through the full subscriber index using `get_subscriber_index_size()` and `get_subscriber_at(offset)`, then pass slices of addresses to `batch_charge()`.

---

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

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KEEPER_CONTRACT_ID` | Yes | — | Deployed FlowPay contract ID |
| `KEEPER_RPC_URL` | Yes | — | Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`) |
| `KEEPER_SECRET_KEY` | Yes | — | Stellar secret key for the keeper account (starts with `S`) |
| `KEEPER_INTERVAL` | No | `3600` | Seconds between charge cycles |
| `KEEPER_PAGE_SIZE` | No | `100` | Addresses per `batch_charge()` call (max 100) |
| `KEEPER_ALERT_WEBHOOK` | No | — | Webhook URL for alert notifications |
| `KEEPER_MIN_BALANCE_XLM` | No | `10` | Alert threshold for keeper account balance |

Store `KEEPER_SECRET_KEY` in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) — never commit it to source control.

---

## Recommended Cadence

The right interval depends on the shortest subscription interval used in your deployment.

| Shortest subscription interval | Recommended keeper cadence |
|-------------------------------|---------------------------|
| 1 day (86 400 s) | Every hour |
| 1 week | Every 4–6 hours |
| 1 month | Every 12–24 hours |

Run the keeper more frequently than the shortest subscription interval so that users are charged promptly and the grace period buffer is not consumed by keeper downtime.

For most deployments, **hourly** is the correct default. The full charge cycle for 1 000 subscribers completes in under a minute on a healthy RPC node, so there is no cost to running frequently.

---

## Monitoring and Alerting

### Key metrics to track

| Metric | Warning threshold | Critical threshold | Action |
|--------|-------------------|--------------------|--------|
| Keeper account balance | < 50 XLM | < 10 XLM | Top up immediately |
| Cycle duration | > 2 min | > 5 min | Check RPC health |
| Failed `batch_charge` calls | > 0 | > 5% of pages | Review error logs |
| Time since last successful cycle | > 1.5× interval | > 2× interval | Page on-call |
| `GracePeriodElapsed` results | Any | — | Investigate missed cycles |

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
```

`GracePeriodElapsed` results are worth alerting on — they indicate a subscription lapsed because the keeper was late. Investigate the cause (keeper downtime, network congestion).

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

| Symptom | First check | Resolution |
|---------|-------------|------------|
| No cycles for > 2 h | `journalctl -u payflow-keeper` | Restart service; check balance |
| `GracePeriodElapsed` spikes | Keeper uptime during the window | Manually invoke missed pages; investigate root cause |
| `batch_charge` throws `InvalidArgument` | Contract upgrade happened | Redeploy keeper with updated ABI |
| Cycle takes > 5 min | RPC node latency | Switch to a backup RPC endpoint |

---

## Related

- `batch_charge(users)` — contract function reference: [`docs/API.md`](API.md)
- Full operations runbook (pagination deep-dive, Terraform IaC): [`docs/operations/keeper_runbook.md`](operations/keeper_runbook.md)
- Architecture and storage layout: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- Error codes: [`docs/ERROR-CODES.md`](ERROR-CODES.md)
