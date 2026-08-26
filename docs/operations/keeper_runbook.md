# Keeper Bot Operations Handbook

## Overview

Keeper bots are autonomous agents that invoke the `batch_charge()` contract function to process recurring billing charges for all active subscriptions. This runbook documents operational procedures, monitoring requirements, and troubleshooting strategies for production deployments.

## Keeper Bot Responsibilities

- **Periodic charge execution** - Call `batch_charge()` at scheduled intervals (e.g., every hour)
- **Paginated index processing** - Iterate through subscriber base using offset/limit parameters
- **Balance monitoring** - Track keeper account balance to ensure sufficient gas/tokens
- **Error recovery** - Implement retry logic and alerting for failed invocations

## Pagination Mechanics

### Understanding Subscriber Pages

The contract stores subscriptions in a paginated index. Each `batch_charge()` call processes a single page:

```
Total Subscriptions: 542
Page Size: 100 subscriptions/page

Page 0: Subscriptions 0-99
Page 1: Subscriptions 100-199
Page 2: Subscriptions 200-299
Page 3: Subscriptions 300-399
Page 4: Subscriptions 400-499
Page 5: Subscriptions 500-542 (partial page)
```

### Sequential Page Processing

```python
#!/usr/bin/env python3
"""Keeper bot batch charge loop"""

import time
import logging
from soroban_client import SorobanClient

logger = logging.getLogger(__name__)

class KeeperBot:
    def __init__(self, contract_id, keeper_keypair, rpc_url):
        self.client = SorobanClient(rpc_url)
        self.contract_id = contract_id
        self.keeper_keypair = keeper_keypair
        self.page_size = 100

    def process_all_pages(self):
        """Process all subscription pages sequentially"""
        page_offset = 0
        total_charged = 0

        while True:
            try:
                # Invoke batch_charge for current page
                result = self.client.invoke_contract(
                    self.contract_id,
                    "batch_charge",
                    {
                        "page_offset": page_offset,
                        "page_size": self.page_size,
                    },
                    signer=self.keeper_keypair,
                )

                charged_count = result.charged
                total_charged += charged_count
                logger.info(f"Page {page_offset}: Charged {charged_count} subscriptions")

                # If page returned fewer items than requested, we've reached the end
                if charged_count < self.page_size:
                    logger.info(f"Completed cycle: {total_charged} total subscriptions charged")
                    break

                page_offset += self.page_size

            except Exception as e:
                logger.error(f"Failed to process page {page_offset}: {e}")
                self.alert_operator("batch_charge failure", str(e))
                break

        return total_charged

    def run_keeper_loop(self, interval_seconds=3600):
        """Main keeper loop: run batch_charge every interval_seconds"""
        while True:
            try:
                logger.info("Starting batch_charge cycle")
                self.check_keeper_balance()
                charged = self.process_all_pages()
                logger.info(f"Cycle complete. Next run in {interval_seconds}s")

            except Exception as e:
                logger.error(f"Keeper loop error: {e}")
                self.alert_operator("keeper_loop_error", str(e))

            time.sleep(interval_seconds)
```

### Page Size Considerations

```
MAX_PAGE_SIZE: 100 subscriptions per batch_charge call

Rationale:
- Prevents single transaction from exceeding Soroban gas limits
- Allows keeper to process ~500-1000 subscriptions per hour
- Enables horizontal scaling (multiple keepers process different page ranges)
```

## Monitoring & Alerting

### Critical Metrics

| Metric                     | Threshold    | Action                                |
| -------------------------- | ------------ | ------------------------------------- |
| **Keeper Account Balance** | < 10 XLM     | CRITICAL - Refund keeper              |
| **Batch Charge Latency**   | > 30 seconds | WARNING - Check network               |
| **Failed Charges**         | > 5% of page | WARNING - Review error logs           |
| **Page Processing Time**   | > 60 seconds | WARNING - Possible network congestion |
| **Keeper Availability**    | 100% uptime  | CRITICAL - Ensure HA setup            |

### Health Check Implementation

```python
def health_check(self):
    """Diagnostic health check for keeper status"""
    health = {
        "keeper_balance": self.get_balance(),
        "last_charge_time": self.get_last_charge_time(),
        "failed_charges": self.get_failed_charge_count(),
        "time_since_last_cycle": time.time() - self.last_cycle_time,
    }

    alerts = []

    if health["keeper_balance"] < 10e7:  # 10 XLM in stroops
        alerts.append("CRITICAL: Keeper balance low")

    if health["time_since_last_cycle"] > 7200:  # 2 hours
        alerts.append("CRITICAL: No successful charge cycle in 2 hours")

    if health["failed_charges"] > 0:
        alerts.append(f"WARNING: {health['failed_charges']} failed charges")

    return health, alerts
```

### Example Monitoring Stack

```yaml
# prometheus-keeper.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "keeper_metrics"
    static_configs:
      - targets: ["localhost:8000"]

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

rule_files:
  - "keeper_alerts.yml"
```

```yaml
# keeper_alerts.yml
groups:
  - name: keeper_alerts
    rules:
      - alert: KeeperBalanceLow
        expr: keeper_balance_stroops < 1000000000
        for: 5m
        annotations:
          summary: "Keeper balance critically low"

      - alert: BatchChargeFailure
        expr: rate(batch_charge_failures[5m]) > 0
        for: 5m
        annotations:
          summary: "Batch charge operation failed"

      - alert: KeeperNotResponding
        expr: time() - keeper_last_ping > 3600
        for: 5m
        annotations:
          summary: "Keeper bot not responding"
```

## Failure Modes & Troubleshooting

### 1. Low Keeper Balance

**Symptom:** Batch charge fails with "insufficient balance" error

**Root Cause:** Keeper account has insufficient XLM for transaction fees

**Resolution:**

```bash
# Check current balance
stellar account info keeper_account

# Fund keeper account
stellar payment --from funding_account \
  --to keeper_account \
  --amount 100 --asset native

# Verify funding
stellar account info keeper_account
```

### 2. Transaction Parsing Failures

**Symptom:** "InvalidArgument" errors during migration or contract upgrade

**Root Cause:** Contract signature changed during deployment; keeper still using old ABI

**Resolution:**

```bash
# Update keeper bot with new contract ABI
# Redeploy contract with new signature
# Restart keeper with new binary

# Verify contract interface
stellar contract read --id CONTRACT_ID
```

### 3. Pagination Offset Overflow

**Symptom:** Keeper hangs or returns empty pages unexpectedly

**Root Cause:** Page offset exceeds total subscription count; no early termination

**Resolution:**

```python
# Keeper should check for empty pages and exit loop
if charged_count == 0 and page_offset > 0:
    logger.info("End of subscription list reached")
    break

# Or implement subscription count check
total_subs = client.invoke_contract(
    contract_id, "get_subscription_count", {}
)
max_pages = (total_subs + page_size - 1) // page_size
```

### 4. Network Congestion

**Symptom:** Batch charge latency increases dramatically

**Root Cause:** High load on RPC node or Stellar network congestion

**Monitoring & Response:**

```python
# Track latency percentiles
latency_p95 = get_latency_percentile(95)

if latency_p95 > 30000:  # 30 seconds
    logger.warning("High network latency detected")
    # Increase backoff
    backoff_multiplier = 2.0
    # Alert ops team
    send_alert("Network_Degradation", {"p95_latency": latency_p95})
```

## Keeper Deployment Patterns

### Single Keeper (Non-HA)

```bash
# Simple cron-based keeper
0 * * * * /opt/keeper/run_batch_charge.sh >> /var/log/keeper.log 2>&1
```

**Risks:**

- Single point of failure
- Missed billing cycles if keeper offline
- No redundancy

### Multiple Keeper (HA) with Leader Election

```python
# leader_election.py
import redis

class KeeperCluster:
    def __init__(self):
        self.redis = redis.Redis(host='redis-leader', port=6379)
        self.keeper_id = os.getenv('KEEPER_ID')

    def acquire_leadership(self):
        """Attempt to become the active keeper"""
        acquired = self.redis.set(
            'keeper:leader',
            self.keeper_id,
            ex=300,  # 5-minute lease
            nx=True  # Only if key doesn't exist
        )
        return acquired

    def maintain_leadership(self):
        """Renew leadership lease"""
        while True:
            if self.acquire_leadership():
                self.process_batch_charge()
            time.sleep(60)
```

### Keeper Infrastructure as Code

```hcl
# terraform/keeper.tf
resource "kubernetes_deployment" "keeper" {
  metadata {
    name      = "payflow-keeper"
    namespace = "production"
  }

  spec {
    replicas = 3

    template {
      spec {
        container {
          name  = "keeper"
          image = "payflow/keeper:latest"
          env {
            name  = "KEEPER_ID"
            value = "keeper-${pod.metadata.name}"
          }
          resources {
            requests = {
              cpu    = "100m"
              memory = "128Mi"
            }
          }
        }
      }
    }
  }
}
```

## Operational Checklist

### Pre-Launch Verification

- [ ] Keeper account funded with sufficient balance (minimum 100 XLM)
- [ ] Contract ABI matches keeper bot expectations
- [ ] Pagination loop tested with production subscriber volume
- [ ] Monitoring and alerting rules deployed
- [ ] Backup/redundancy keeper configured
- [ ] RPC endpoints verified healthy
- [ ] Network connectivity from keeper host to Soroban RPC confirmed

### Post-Launch Monitoring

- [ ] Keeper metrics flowing into monitoring stack
- [ ] Alert thresholds reviewed and appropriate
- [ ] Batch charge cycle latency < 60 seconds
- [ ] No recurring charge failures
- [ ] Keeper availability > 99.9%
- [ ] Regular balance top-ups scheduled

### Incident Response

1. **Keeper bot unresponsive**
   - Check process status: `ps aux | grep keeper`
   - Review logs: `tail -f /var/log/keeper.log`
   - Restart if hung: `systemctl restart keeper`

2. **Transaction failures**
   - Check keeper balance
   - Verify contract is not frozen
   - Inspect error logs for transaction specifics

3. **Billing cycle missed**
   - Check keeper uptime during missed window
   - Manually invoke missed batch_charge pages
   - Add padding time to next scheduled run

---

## Dead-Letter Queue Recovery

Failed `batch_charge` pages (or individual addresses) that exhaust retries should land in a dead-letter queue (DLQ) — Redis list, SQS queue, or a JSONL file — instead of being dropped.

### Scenario

A network blip or temporary `InsufficientAllowance` storm left dozens of pages in the DLQ. Billing is falling behind and grace windows are at risk.

### Detection

```bash
# Redis-backed DLQ depth
redis-cli LLEN keeper:dlq
# Expected when healthy: 0 (or near-zero)

# File-backed DLQ
wc -l /var/lib/payflow/keeper-dlq.jsonl
# Expected: 0 lines when drained
```

Alert if DLQ depth > 0 for more than one keeper interval.

### Resolution steps

1. **Inspect a sample entry** (do not replay blindly):

```bash
redis-cli LRANGE keeper:dlq 0 2
# Expected: JSON objects with offset, addresses[], error, attempts, ts
```

2. **Classify errors** using [`docs/ERROR-CODES.md`](../ERROR-CODES.md):
   - Transient (RPC timeout, 429) → safe to replay
   - `IntervalNotElapsed` / skipped → drop from DLQ
   - `GracePeriodElapsed` → drop; notify user / support (re-subscribe)
   - `InsufficientAllowance` → notify user; drop or defer
   - `ContractPaused` → **stop replay** until unpaused

3. **Replay transient entries** with rate limiting:

```bash
# Example operator helper (pseudo)
python /opt/keeper/replay_dlq.py \
  --max-batch 20 \
  --sleep-ms 500 \
  --dry-run
# Expected dry-run: lists pages that would be re-invoked

python /opt/keeper/replay_dlq.py \
  --max-batch 20 \
  --sleep-ms 500
# Expected: "replayed=N success=M failed=K remaining=<LLEN>"
```

4. **Manual single-page invoke** when automation is unavailable:

```bash
soroban contract invoke \
  --id "$KEEPER_CONTRACT_ID" \
  --source keeper \
  --network "$NETWORK" \
  -- batch_charge \
  --users '["GUSER1...", "GUSER2..."]'
# Expected: Vec of ChargeResult values; no panic for per-user skips
```

5. **Ack / delete** successfully replayed DLQ entries; leave permanent failures in a `keeper:dlq:archive` list for audit.

### Verification

```bash
redis-cli LLEN keeper:dlq
# Expected: 0

journalctl -u payflow-keeper -n 50 --no-pager
# Expected: recent "Cycle complete" without DLQ growth
```

Cross-ref: [`docs/KEEPER.md`](../KEEPER.md#handling-failed-charges), [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md).

---

## Multi-Instance Keeper Coordination

### Scenario

You run 2–3 keeper replicas for HA. Without coordination, two leaders can submit overlapping `batch_charge` calls for the same addresses in the same ledger window (wasted fees; noisy logs). The contract still enforces intervals (so double **successful** charges in one interval should fail closed), but operators must avoid thrashing.

### Detection

```bash
redis-cli GET keeper:leader
# Expected: a single keeper id, e.g. keeper-2

# If multiple hosts claim leadership in logs:
grep -h "acquired leadership\|Starting batch_charge cycle" /var/log/keeper-*.log | tail -20
```

Alert when two different `KEEPER_ID` values log an active cycle within the same minute.

### Resolution steps

1. **Use a single distributed lock** (Redis `SET NX EX`) — only the leader runs charge cycles:

```bash
redis-cli SET keeper:leader "$KEEPER_ID" EX 300 NX
# Expected on success: OK
# Expected if another leader holds the lock: (nil)
```

2. **Renew the lease** at least every `LEASE_TTL / 2` seconds while working.

3. **Optional shard mode** (advanced): partition by page offset ranges, still with a per-shard lock:

```text
keeper-a → offsets 0..N/2
keeper-b → offsets N/2..N
lock keys: keeper:lock:shard:0 , keeper:lock:shard:1
```

4. **Fence tokens**: include `leader_epoch` from Redis `INCR keeper:leader_epoch` in logs; ignore late work from stale epochs after failover.

5. **Never share the same keeper secret across untrusted hosts** without a secrets manager; rotate if a replica is compromised.

### Verification

```bash
redis-cli GET keeper:leader
# Expected: exactly one live id

# Simulate failover
redis-cli DEL keeper:leader
# Within LEASE_TTL, a follower should acquire and log leadership
journalctl -u payflow-keeper -f
# Expected: "acquired leadership" on one replica only
```

Cross-ref: [`docs/KEEPER.md`](../KEEPER.md#high-availability-with-leader-election-production).

---

## RPC Failover Configuration

### Scenario

Primary Soroban RPC returns elevated latency or 5xx errors; charge cycles stall.

### Detection

```bash
curl -s -o /dev/null -w "%{http_code} time=%{time_total}\n" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  "$KEEPER_RPC_URL"
# Expected healthy: HTTP 200 and time well under your warning threshold
```

Track p95 invoke latency and error rate; fail over when error rate > 5% for 5 minutes or p95 > 30s.

### Resolution steps

1. **Configure primary + backups** via env:

```bash
# /etc/payflow/keeper.env
KEEPER_RPC_URL=https://soroban-mainnet.example.com
KEEPER_RPC_URL_FALLBACKS=https://soroban-mainnet-backup.example.com,https://soroban-rpc.stellar.org
KEEPER_RPC_HEALTH_PATH=getHealth
KEEPER_RPC_FAILOVER_ERROR_THRESHOLD=0.05
KEEPER_RPC_FAILOVER_LATENCY_MS=30000
```

2. **Health-probe loop** (keeper-side):

```python
def pick_rpc(endpoints):
    for url in endpoints:
        try:
            if health_ok(url) and latency_ms(url) < 30000:
                return url
        except Exception as e:
            logger.warning("rpc unhealthy %s: %s", url, e)
    raise RuntimeError("all RPC endpoints unhealthy")
```

3. **On failover**, log clearly and alert:

```text
ALERT rpc_failover from=primary to=backup-1 reason=p95_latency
```

4. **Fail back** only after primary stays healthy for one full charge interval.

5. **Keep network passphrase aligned** with the endpoint (Testnet vs Mainnet) — mismatched RPC/passphrase looks like “RPC failure” but is misconfiguration. See [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md).

### Verification

```bash
# Force probe
curl -s -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  "$KEEPER_RPC_URL_FALLBACKS"
# Expected: JSON health response without transport error

journalctl -u payflow-keeper -n 100 | grep -i rpc
# Expected: stable endpoint or a single clean failover event
```

Cross-ref: [`docs/KEEPER.md`](../KEEPER.md#monitoring-and-alerting).

---

## Incident Response Playbook

Use this when billing is impaired, funds may be at risk, or the contract must be paused.

### Severity & who to alert

| Severity | Examples                                                                 | Alert                                                     |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| SEV-1    | Unexpected drains, admin key suspected compromise, uncontrolled charges  | Page on-call **and** protocol admin; security@payflow.dev |
| SEV-2    | Contract paused unexpectedly, keeper down > 1 interval, RPC total outage | Page on-call; notify merchants if charges delay           |
| SEV-3    | DLQ buildup, elevated skip rates, single-region RPC degrade              | Ticket + Slack; fix in business hours                     |

### What to check (first 15 minutes)

1. **Contract pause / health**

```bash
soroban contract invoke --id "$KEEPER_CONTRACT_ID" --network "$NETWORK" -- health_check
# Expected: healthy when operating normally
```

2. **Keeper process & balance**

```bash
systemctl status payflow-keeper --no-pager
stellar keys address keeper
# Check XLM balance via account info; top up if < 10 XLM
```

3. **Error codes in logs** — map via [`docs/ERROR-CODES.md`](../ERROR-CODES.md) (`ContractPaused` 18 / `ContractPausedError` 30 → stop retries).

4. **RPC health** — run failover probes above.

5. **Leadership** — confirm a single leader (`redis-cli GET keeper:leader`).

### How to pause the contract during an incident

Only the **admin** (hardware wallet / multisig) should pause:

```bash
soroban contract invoke \
  --id "$KEEPER_CONTRACT_ID" \
  --source admin \
  --network "$NETWORK" \
  -- pause_contract
# Expected: success; subsequent charge/subscribe fail with pause errors
```

Then stop keepers to avoid log spam:

```bash
systemctl stop payflow-keeper
# Expected: inactive (dead)
```

### Recovery / unpause

1. Root-cause fixed and verified on Testnet if applicable.
2. Admin unpauses:

```bash
soroban contract invoke \
  --id "$KEEPER_CONTRACT_ID" \
  --source admin \
  --network "$NETWORK" \
  -- unpause_contract
# Expected: success
```

3. Start keepers; drain DLQ with the recovery procedure.
4. Post-incident: timeline, customer impact, follow-ups (see also [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md) rollback notes).

### Verification

```bash
systemctl start payflow-keeper
systemctl is-active payflow-keeper
# Expected: active

soroban contract invoke --id "$KEEPER_CONTRACT_ID" --network "$NETWORK" -- health_check
# Expected: healthy

redis-cli LLEN keeper:dlq
# Expected: trending to 0 after replay
```

---

## Related Documentation

- Troubleshooting runbook: [`docs/operations/troubleshooting.md`](troubleshooting.md)
- Error codes reference: [`docs/ERROR-CODES.md`](../ERROR-CODES.md)
- Testing guide: [`docs/TESTING.md`](../TESTING.md)
- Keeper guide: [`docs/KEEPER.md`](../KEEPER.md)
