# PayFlow Keeper — Runbook

Operational procedures for responding to Prometheus alerts.

---

## Table of Contents

- [KeeperHeartbeatMissing](#keeperheartbeatmissing)
- [KeeperHighFailureRatio](#keeperhighfailureratio)
- [KeeperDLQGrowing](#keeperdlqgrowing)
- [KeeperRPCErrors](#keeperrpcerrors)
- [KeeperFeeCeilingBreached](#keeperfeeceilingbreached)
- [KeeperBatchSlow](#keeperbatchslow)

---

## KeeperHeartbeatMissing

**Trigger:** `(time() - payflow_keeper_last_run_timestamp_seconds) > 180` for 1 minute.

**What it means:** The keeper has not completed a cycle for more than 3 minutes. Subscribers are not being charged.

**Investigation steps:**

1. Check whether the keeper process is running:
   ```bash
   docker compose -f scripts/docker-compose.yml ps keeper
   docker compose -f scripts/docker-compose.yml logs keeper --tail=50
   ```
2. Check for startup errors (missing secret, bad RPC URL, bad contract ID).
3. Verify the RPC endpoint is reachable:
   ```bash
   curl https://soroban-testnet.stellar.org/health
   ```
4. If the keeper crashed, review the last error in logs and restart:
   ```bash
   docker compose -f scripts/docker-compose.yml restart keeper
   ```

**Thresholds:** 3 minutes (3× the default 60 s poll interval). Adjust `POLL_INTERVAL_MS` in `.env` if you use a longer cycle.

---

## KeeperHighFailureRatio

**Trigger:** Failure ratio > 10% for 5 minutes.

**What it means:** More than 1 in 10 charge calls are failing. Possible causes:
- Contract panic (interval not elapsed, subscription inactive)
- Insufficient token allowances for many subscribers
- RPC node returning errors

**Investigation steps:**

1. Check keeper logs for contract error messages:
   ```bash
   docker compose -f scripts/docker-compose.yml logs keeper --tail=100 | grep "Failed\|panic\|error"
   ```
2. If the error is `interval not elapsed yet`, the keeper cycle is too short. Increase `POLL_INTERVAL_MS`.
3. If the error is `no subscription found` or `subscription is not active`, the subscriber list is stale. Refresh the index.
4. Check the DLQ size: `payflow_keeper_dlq_size`. DLQ entries contain the users and the error message.

**Thresholds:** 10%. Adjust by modifying the alert expression in `scripts/alerts.yml`.

---

## KeeperDLQGrowing

**Trigger:** `payflow_keeper_dlq_size >= 5` for 2 minutes (warning) or `>= 20` for 1 minute (critical).

**What it means:** Batches are failing consistently and accumulating in the dead-letter queue.

**Investigation steps:**

1. Inspect DLQ contents in keeper logs:
   ```bash
   docker compose -f scripts/docker-compose.yml logs keeper | grep "DLQ enqueue"
   ```
2. Identify whether failures are systemic (all batches) or isolated (specific users).
3. For systemic failures, see [KeeperHighFailureRatio](#keeperhighfailureratio).
4. For isolated users, manually investigate their subscriptions via the contract:
   ```bash
   soroban contract invoke --id $CONTRACT_ID --network testnet -- get_subscription --user <USER_ADDRESS>
   ```
5. After fixing the root cause, restart the keeper to retry DLQ batches (they are replayed on the next cycle in the in-memory queue).

**Note:** The DLQ is in-memory. Restarting the keeper clears it. For persistent DLQ, implement a database-backed queue.

---

## KeeperRPCErrors

**Trigger:** RPC error rate > 5/min for 2 minutes.

**What it means:** The keeper cannot communicate reliably with the Soroban RPC node.

**Investigation steps:**

1. Check the RPC endpoint health:
   ```bash
   curl $RPC_URL/health
   ```
2. Check for rate limiting — some public RPC nodes cap requests per minute.
3. Consider switching to a dedicated RPC node or Horizon provider.
4. Check `operation` label on `payflow_keeper_rpc_errors_total` to identify whether errors are on `simulate` or `send`.

**Thresholds:** 5 errors/minute. Lower for high-frequency keepers; raise for low-volume testnet use.

---

## KeeperFeeCeilingBreached

**Trigger:** Multiple charge failures with adaptive fees being calculated, persisting for 5 minutes.

**What it means:** The keeper's fee ceiling (`FEE_CEILING_STROOPS`) may be too low for current network congestion. Transactions are being aborted before submission.

**Investigation steps:**

1. Check the `payflow_keeper_adaptive_fee_stroops` histogram in Grafana for the p95/p99 fee values.
2. If fees are consistently above `FEE_CEILING_STROOPS`, increase the ceiling:
   ```env
   # scripts/.env
   FEE_CEILING_STROOPS=200000000  # 20 XLM
   ```
3. Consider enabling fee-bump to let a separate account cover surge fees:
   ```env
   FEE_BUMP_SOURCE=G...  # fee-bump account public key
   FEE_BUMP_SECRET_FILE=/run/secrets/fee_bump_secret
   ```
4. Restart the keeper after updating `.env`.

**Thresholds:** Any ceiling breach sustained over 5 minutes. The ceiling default is 10 XLM (100,000,000 stroops).

---

## KeeperBatchSlow

**Trigger:** p95 batch latency > 30 s for 5 minutes.

**What it means:** Transactions are taking too long to confirm. Possible causes:
- Network congestion (high queue depth on the RPC node)
- Large batch sizes causing slow simulation
- RPC node under load

**Investigation steps:**

1. Reduce `BATCH_SIZE` in `.env` (e.g. from 50 to 20) and restart the keeper.
2. Check the Stellar network status at [https://dashboard.stellar.org](https://dashboard.stellar.org).
3. If latency is caused by slow simulation, consider pre-simulating and caching fee estimates.
4. Check whether the `simulate` or `send` RPC operation is slow by comparing error counters.

**Thresholds:** 30 s p95. Adjust if your poll interval allows for longer confirmation windows.
