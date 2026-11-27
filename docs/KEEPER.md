# FlowPay Keeper Runbook

The keeper is the only required runtime piece for billing automation. The
contract does not schedule itself: something has to call `batch_charge` on a
cadence, and this is what ships for that.

This runbook documents [`scripts/keeper.ts`](../scripts/keeper.ts) as it
actually is. Every flag, environment variable and default below was read from
the source, and `scripts/test-keeper-doc.mjs` fails if this page drifts from it.

**Related docs:**
[`CHARGE-RESULTS.md`](CHARGE-RESULTS.md) (what a `ChargeResult` is on the wire) |
[`LIMITS.md`](LIMITS.md) (batch and pagination caps) |
[`scripts/README.md`](../scripts/README.md) (all scripts, Docker Compose) |
[`operations/KEEPER-RUNBOOK.md`](operations/KEEPER-RUNBOOK.md) (HA and failover) |
[`API.md`](API.md) (`batch_charge` contract reference) |
[`ERROR-CODES.md`](ERROR-CODES.md)

---

## Table of Contents

- [Runtime and invocation](#runtime-and-invocation)
- [Flags](#flags)
- [Environment variables](#environment-variables)
- [Configuration is environment-only](#configuration-is-environment-only)
- [Running the keeper](#running-the-keeper)
- [Graceful shutdown](#graceful-shutdown)
- [Exit codes](#exit-codes)
- [How a cycle works](#how-a-cycle-works)
- [Batch size resolution](#batch-size-resolution)
- [ChargeResult reference](#chargeresult-reference)
- [Dead-letter queue](#dead-letter-queue)
- [Metrics and monitoring](#metrics-and-monitoring)
- [Running as a service](#running-as-a-service)
- [High Availability (HA) deployment](#high-availability-ha-deployment)
- [Scheduling and the due window](#scheduling-and-the-due-window)
- [Keeper tip (`charge_with_tip`)](#keeper-tip-charge_with_tip)
- [Recommended cadence](#recommended-cadence)
- [Troubleshooting](#troubleshooting)
- [Checklist](#checklist)

---

## Runtime and invocation

The keeper is **ESM TypeScript run with [`tsx`](https://tsx.is)**, not
`ts-node`. `scripts/package.json` sets `"type": "module"`, and every relative
import carries a `.js` extension because that is what Node's ESM resolver needs
at runtime. `ts-node` fails on this module graph.

```bash
cd scripts
npm ci
npx tsx keeper.ts --help
```

There is also a package script, which is the shorter form of the same thing:

```bash
cd scripts
npm run keeper -- --once
```

`sx`/`tsx` must be on the path. `npm ci` installs it as a devDependency. The
file also has a `#!/usr/bin/env tsx` shebang, so it is directly executable
where `tsx` is on the `PATH`.

## Flags

These four are the complete set. There is no other argument parsing in the
file.

| Flag             | Effect                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `--once`         | Run a single charge cycle, then exit.                                     |
| `--dry-run`      | Same as `DRY_RUN=true`. Simulates, submits nothing.                       |
| `--max-batches=N`| Process at most `N` batches total, then exit. **Implies `--once`.**       |
| `--help`, `-h`   | Print the help text.                                                      |

Three behaviours that are easy to get wrong:

- **`--max-batches` must use `=`.** The value is read with
  `argv.find(a => a.startsWith("--max-batches="))`, so `--max-batches 2` (space
  separated) is **silently ignored** and the keeper loops forever. So is a
  non-integer or a value below 1. Check the startup log line to confirm the
  budget was picked up.
- **`--max-batches=N` implies `--once`.** You do not need both. `once` is
  computed as `argv.includes("--once") || MAX_BATCHES !== undefined`.
- **`--help` does not exit.** It prints and then falls straight through to
  `validateEnv()` and a full cycle. Run `npx tsx keeper.ts --help` on its own
  and you will see the help text followed by a validation error, because
  `CONTRACT_ID` and `KEEPER_PUBLIC_KEY` are unset. That is expected, not a bug
  in your setup.

## Environment variables

Everything is read from `process.env` at module load.

| Variable                     | Required            | Default                                  | Notes |
| ---------------------------- | ------------------- | ---------------------------------------- | ----- |
| `CONTRACT_ID`                | **Yes**             | -                                        | Deployed FlowPay contract ID. |
| `KEEPER_PUBLIC_KEY`          | **Yes**             | -                                        | Source account public key (`G...`). Must be funded on the network. |
| `KEEPER_SECRET`              | **Yes in live mode**| -                                        | Secret key (`S...`). Not required when `DRY_RUN=true`. |
| `DRY_RUN`                    | No                  | `false`                                  | Exactly `"true"` enables dry-run. Anything else, including `1` or `TRUE`, is false. |
| `RPC_URL`                    | No                  | `https://soroban-testnet.stellar.org`    | Soroban RPC endpoint. |
| `NETWORK_PASSPHRASE`         | No                  | `Networks.TESTNET`                       | Must match the network the contract is deployed on. |
| `ALLOW_MAINNET`              | No                  | `false`                                  | Must be `"true"` to start with the mainnet passphrase (`Public Global Stellar Network ; September 2015`); otherwise startup fails. |
| `BATCH_SIZE`                 | No                  | on-chain max, else 50                    | **Legacy paging path only** - see [Batch size resolution](#batch-size-resolution). Clamped to 1-200. |
| `INTERVAL_SECONDS`           | No                  | `3600`                                   | Longest sleep between cycles in loop mode. Floor of 1. The loop wakes sooner when a subscription comes due (see [Scheduling and the due window](#scheduling-and-the-due-window)). |
| `SCHEDULE_SCAN_MAX_PAGES`    | No                  | `20`                                     | Index pages (50 slots each) scanned per scheduling decision. Bounds the due-window reads. |
| `REPORT_DIR`                 | No                  | `<script_dir>/data/benchmarks`           | Dry-run reports and the live-cycle pointer file. |
| `KEEPER_USE_LEGACY_PAGING`   | No                  | `false`                                  | `true` switches to sequential offset paging instead of grace-urgency-ordered batches. |
| `DLQ_FILE`                   | No                  | `<cwd>/dlq/failed-batches.jsonl`         | JSONL file of aborted batches. |
| `METRICS_PORT`               | No                  | `9090`                                   | Port for the `/metrics` endpoint. |
| `SHUTDOWN_TIMEOUT_MS`        | No                  | `50000`                                  | Graceful-shutdown deadline — see [Graceful shutdown](#graceful-shutdown). Invalid or non-positive values fall back to the default. |
| `LOG_LEVEL`                  | No                  | `info`                                   | `debug` \| `info` \| `warn` \| `error`. |

Validation is all-or-nothing and happens once, at startup. Missing variables
are reported together rather than one at a time:

```
Error: Missing required environment variables:
  - CONTRACT_ID is required
  - KEEPER_PUBLIC_KEY is required
  - KEEPER_SECRET is required in live mode (or set DRY_RUN=true)
```

## Configuration is environment-only

**There is no `.env` file loading.** The keeper does not depend on `dotenv`, and
`scripts/package.json` does not list it. `process.env` is read directly, so
anything that sets the environment works and a `.env` file sitting next to the
script is ignored unless your process manager sources it.

This is a common first-run failure: operators edit `.env` following older
instructions and the keeper still reports missing variables.

To run from a file, source it yourself:

```bash
set -a; . ./.env; set +a
npx tsx keeper.ts --once
```

Or inline the variables:

```bash
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts --once
```

The keeper also does **not** use the zod schema in `scripts/config.ts`. That
schema validates `BATCH_SIZE` for other callers; the keeper does its own
clamping. Do not assume the schema covers the keeper.

## Running the keeper

Always start with a dry run. It simulates against the live chain and submits
nothing, so it tells you what the keeper would do before it does it.

```bash
# One dry-run cycle, everything explicit
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... DRY_RUN=true npx tsx keeper.ts --once

# Same thing via the flag
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... npx tsx keeper.ts --dry-run --once

# A bounded dry run: what would the first two batches do?
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... npx tsx keeper.ts --dry-run --max-batches=2

# Loop mode
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... DRY_RUN=true npx tsx keeper.ts
```

Then go live, one cycle first:

```bash
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts --once
```

Then the loop:

```bash
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
```

`KEEPER_SECRET` is never logged. The child logger binds `CONTRACT_ID` and
`RPC_URL` as context, and the secret is deliberately excluded.

## Graceful shutdown

The keeper handles **SIGTERM and SIGINT identically** (Docker `stop`,
`systemctl stop`, Ctrl-C). The first signal starts a bounded drain; repeated
signals are logged and ignored — cleanup never runs twice and only one
deadline timer exists, so a SIGTERM followed by a SIGINT is safe.

What happens on the first signal:

1. **Scheduling stops.** Both paging loops consult a gate before every
   batch/page, so no new batch is submitted after the signal. The cycle
   already in flight keeps running — submission and result recording stay
   paired, so a batch is never half-recorded.
2. **The in-flight work drains.** The coordinator waits for the tracked
   cycle (and any batch within it) to settle.
3. **Cleanup flushes.** The DLQ file is fsynced (`dlq-flush`) and the
   metrics server is stopped (`metrics-flush`), in that order, exactly once.
4. **The process exits** — `0` when everything drained and flushed, `1`
   otherwise (see [Exit codes](#exit-codes)).

The whole sequence is bounded by `SHUTDOWN_TIMEOUT_MS` (default **50 000 ms**).
The default is deliberately below the 60 s `stop_grace_period` in
`scripts/docker-compose.yml`, so the keeper reports its own timeout and exits
non-zero instead of being SIGKILLed mid-write. If the deadline elapses first,
the keeper logs the labels of the work still pending, best-effort flushes the
DLQ, and exits `1` — unfinished work is never reported as completed.

A batch that **rejects during the drain** is surfaced as
`In-flight work failed during drain` and forces exit `1`; it is not swallowed
by the shutdown path.

Relevant code: `scripts/lib/shutdown.ts` (the `ShutdownCoordinator`), the
module-level `shutdown` coordinator and `canScheduleNextBatch()` gate in
`scripts/keeper.ts`, and `scripts/__tests__/keeper-shutdown.test.ts`.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0    | Cycle completed. In `--once` mode, either there were no errors or at least one subscriber was charged. Also: a signal-triggered shutdown that drained and flushed cleanly. |
| 1    | Every page in the cycle errored **and** nothing was charged (`report.errors.length > 0 && report.totalCharged === 0`). |
| 1    | Missing required environment variables, or a fatal error in `main()`. |
| 1    | Shutdown did not complete: the drain timed out (`SHUTDOWN_TIMEOUT_MS`), an in-flight batch failed during the drain, a cleanup step failed, or the cycle itself failed. |

The middle case is the one to understand: a cycle where some pages errored but
others charged something still exits 0. `errors.length > 0` on its own is
logged and retried next cycle, not treated as a failure.

## How a cycle works

1. Read the next charge batch, ordered by grace urgency and overdue age.
2. For each batch, simulate, then (unless dry-run) submit `batch_charge` and
   wait for confirmation.
3. Tally the per-subscriber `ChargeResult` values.
4. On a page-level failure, write a DLQ row and continue with the next page.
5. Write the cycle report and update the metrics.

By default batches come from `buildOptimizedBatches()` in
`batch-optimizer.ts`, which orders by grace urgency and skips subscribers that
are not yet due. Set `KEEPER_USE_LEGACY_PAGING=true` to fall back to
sequential `offset` paging, which is what the `BATCH_SIZE` variable governs.

## Batch size resolution

`BATCH_SIZE` is easy to misunderstand, because by default the keeper is not
using it for the path that submits charges.

Resolution at startup:

1. Start from `BATCH_SIZE` if set and positive, else `50`.
2. Clamp to `1..200`. The 200 is `MAX_BATCH_SIZE_CEILING`; see
   [`LIMITS.md`](LIMITS.md).
3. Simulate `get_max_batch_size()` and narrow to whatever the chain reports.
4. On RPC failure, log a warning and **keep the un-narrowed value**, still
   clamped to `1..200`.

Step 4 is the sharp edge: if the RPC read fails, a `BATCH_SIZE` of 200 will be
submitted as-is and can exceed a lowered on-chain cap, producing
`BatchTooLarge` (error 20) in the legacy path. Watch for the warning at
startup.

`BATCH_SIZE` only affects `KEEPER_USE_LEGACY_PAGING=true`. Under the default
optimized path, batch size comes from `batch-optimizer.ts`, which resolves its
own `MAX_BATCH_SIZE` / `PAGE_SIZE`.

Whatever the source, no keeper configuration can exceed the on-chain cap, so a
misconfigured value degrades to a rejected batch rather than a stuck keeper.

## ChargeResult reference

`batch_charge` returns one `ChargeResult` per input address, in the same
order.

| Variant                | Meaning                                                        | Keeper action                          |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------- |
| `Charged`              | Funds transferred, `last_charged` advanced.                     | Count toward `totalCharged` and volume. |
| `Skipped`              | Interval has not elapsed. Not an error.                         | Ignore; next cycle.                    |
| `NoSubscription`       | No subscription for this address.                               | Ignore; the index entry is stale.      |
| `Inactive`             | Subscription is cancelled.                                      | Ignore.                                |
| `Paused`               | Subscription is paused.                                         | Ignore until resumed.                  |
| `GracePeriodElapsed`   | Charge window closed; overdue beyond grace.                     | Tally as a lapse. Operator may want to pause these subscriptions. |
| `AllowanceInsufficient`| Subscriber's allowance is below the gross amount.                | **Tally separately and alert.** The subscription stays active. |

`AllowanceInsufficient` is the only variant that needs human action, and it is
never a DLQ entry: the transaction succeeded, it just did not transfer that
one subscriber's funds. Alert on the `batch_charge_skips` event, not on the DLQ.

**The on-the-wire encoding of these values is `scvU32` discriminants, not
strings or symbols.** See [`CHARGE-RESULTS.md`](CHARGE-RESULTS.md) before
writing anything that reads them.

## Dead-letter queue

A page-level failure writes one JSON object per line to `DLQ_FILE` (default
`dlq/failed-batches.jsonl`).

| Field      | Type                 | Notes |
| ---------- | -------------------- | ----- |
| `timestamp`| string               | ISO-8601. |
| `offset`   | number               | Page offset the batch started at. |
| `limit`    | number               | Addresses in the batch. |
| `users`    | string[]             | The addresses, in submission order. |
| `error`    | string               | The thrown error message. Free-form. |
| `tx_xdr`   | `null`               | Always `null`. |
| `attempts` | number               | Replay attempts so far. |
| `ledger`   | number \| undefined  | Latest ledger when recorded. |

```bash
# Inspect
wc -l dlq/failed-batches.jsonl
tail -n 5 dlq/failed-batches.jsonl | jq .

# Replay, and preview without submitting
npx tsx replay-dlq.ts --dry-run
npx tsx replay-dlq.ts
```

`replay-dlq.ts` moves successful entries to `dlq/replayed-batches.jsonl` and
permanently-failed ones to `dlq/dead-batches.jsonl`. It classifies
non-retryable errors by substring (`NoSubscriptionFound`, `SubscriptionInactive`,
`ContractPaused`, `Unauthorized`). See
[`scripts/README.md`](../scripts/README.md#dlq-replay-and-failover) for the full
tooling.

A DLQ row is a **transaction-level** abort and carries no per-subscriber
outcome. See [`CHARGE-RESULTS.md`](CHARGE-RESULTS.md#channel-3-the-dead-letter-queue-row).

## Metrics and monitoring

The keeper starts a Prometheus exporter on `METRICS_PORT` (default 9090) at
startup, in every mode including dry-run. It is not optional and there is no
flag to disable it.

```bash
curl -s localhost:9090/metrics | grep flowpay
```

Track at minimum:

- cycle success rate and `report.errors` per cycle
- `totalCharged` against the previous cycle
- allowance-insufficient count (the actionable failure)
- grace-lapsed count
- keeper account balance, in the charging token
- last successful cycle timestamp (a silent keeper is the common failure)

If `last_ledger` in the DLQ stops advancing, or no new report appears in
`REPORT_DIR`, the keeper is wedged rather than idle.

## Running as a service

The keeper is a plain long-running process; any supervisor works. It does not
daemonize itself.

### systemd (recommended)

```ini
# /etc/systemd/system/payflow-keeper.service
[Unit]
Description=FlowPay Keeper
After=network-online.target

[Service]
Type=simple
User=flowpay
WorkingDirectory=/opt/payflow/scripts
Environment=NODE_ENV=production
Environment=CONTRACT_ID=C...
Environment=KEEPER_PUBLIC_KEY=G...
Environment=KEEPER_SECRET=S...
Environment=NETWORK_PASSPHRASE=Public Global Stellar Network ;2024
Environment=RPC_URL=https://soroban-rpc.mainnet.stellar.org
Environment=LOG_LEVEL=info
ExecStart=/usr/bin/npx tsx keeper.ts
Restart=always
RestartSec=15
# The secret is in the unit file, so keep it unreadable to other users.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now payflow-keeper
journalctl -u payflow-keeper -f
```

`Restart=always` is what makes the keeper self-healing. The cycle itself is
idempotent: a subscriber whose interval has not elapsed returns `Skipped`, so a
restart mid-window is safe.

### Docker

`scripts/docker-compose.yml` runs keeper, indexer and metrics together.

```bash
cd scripts
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... docker compose up -d
```

Build the image directly (the build context is `scripts/`):

```bash
cd scripts
docker build -t payflow-keeper .
```

Run a single dry-run cycle inside the container — this is the same check the
`docker-smoke` CI workflow performs:

```bash
docker run --rm \
  -e RPC_URL=https://soroban-testnet.stellar.org \
  -e CONTRACT_ID=C... \
  -e KEEPER_PUBLIC_KEY=G... \
  payflow-keeper --dry-run --once
```

The container image ships the full runtime file set (`keeper.ts`, `indexer.ts`,
`metrics-server.ts`, `lib/`, `db/`, `utils/`, `fixtures/`), so any entrypoint
composable with `docker-compose.yml` works:

```bash
docker run --rm payflow-keeper metrics-server   # Prometheus on :9090
docker run --rm -e START_LEDGER=99999 payflow-keeper indexer
```

On `SIGTERM`/`SIGINT` the keeper drains in-flight batches and flushes the DLQ
and metrics before exiting (see [Graceful shutdown](#graceful-shutdown)).
`docker stop` therefore exits cleanly within the compose `stop_grace_period`
(60s for the keeper; `SHUTDOWN_TIMEOUT_MS` defaults to 50s).

### pm2

```bash
pm2 start "npx tsx keeper.ts" --name payflow-keeper
pm2 save
```

## High Availability (HA) deployment

Running multiple keeper instances prevents downtime and balances load. The keeper supports two HA modes:

### 1. Deterministic Sharding (Recommended)

Multiple keepers run simultaneously, each processing a consistent subset of addresses. No centralized coordination needed.

**How it works:**
- Each address is hashed to determine which keeper processes it
- Same address always routes to the same keeper (consistent hashing)
- Zero overlap between keepers - no wasted fees

**Configuration:**

```bash
# Keeper instance 0 of 3
export KEEPER_TOTAL_INSTANCES=3
export KEEPER_INSTANCE_ID=0
export CONTRACT_ID=C...
export KEEPER_PUBLIC_KEY=G...
export KEEPER_SECRET=S...
npx tsx keeper.ts

# Keeper instance 1 of 3 (different machine/pod)
export KEEPER_TOTAL_INSTANCES=3
export KEEPER_INSTANCE_ID=1
# ... rest same

# Keeper instance 2 of 3
export KEEPER_TOTAL_INSTANCES=3
export KEEPER_INSTANCE_ID=2
# ... rest same
```

**Kubernetes example:**

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: payflow-keeper
spec:
  replicas: 3
  serviceName: keeper
  template:
    spec:
      containers:
      - name: keeper
        image: payflow-keeper:latest
        env:
        - name: KEEPER_TOTAL_INSTANCES
          value: "3"
        - name: KEEPER_INSTANCE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['apps.kubernetes.io/pod-index']
        - name: CONTRACT_ID
          valueFrom:
            secretKeyRef:
              name: keeper-config
              key: contract-id
        # ... other env vars
```

**systemd example (3 services):**

```ini
# /etc/systemd/system/payflow-keeper@.service
[Unit]
Description=FlowPay Keeper Instance %i
After=network-online.target

[Service]
Type=simple
User=flowpay
WorkingDirectory=/opt/payflow/scripts
Environment=KEEPER_TOTAL_INSTANCES=3
Environment=KEEPER_INSTANCE_ID=%i
EnvironmentFile=/etc/payflow/keeper.env
ExecStart=/usr/bin/npx tsx keeper.ts
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
```

```bash
# Start 3 keeper instances
sudo systemctl enable --now payflow-keeper@0
sudo systemctl enable --now payflow-keeper@1
sudo systemctl enable --now payflow-keeper@2
```

###2. Exclusive Locking (Failover Mode)

Only one keeper runs at a time. Others are on standby and take over if the primary fails.

**Configuration:**

```bash
export KEEPER_EXCLUSIVE_LOCK=true
export KEEPER_LOCK_DIR=/shared/keeper-locks  # Must be shared storage (NFS/EFS)
npx tsx keeper.ts
```

**When to use:**
- Simple failover without sharding complexity
- Shared filesystem available (NFS, EFS, GlusterFS)
- Lower total throughput acceptable

**Lock file location:**
- Default: `/tmp/payflow-keeper-locks/keeper-master.lock`
- Production: Use `KEEPER_LOCK_DIR` pointing to shared storage
- Lock TTL: 5 minutes (expired locks are auto-released)

### Coordination Metrics

Track keeper coordination health:

```bash
curl -s localhost:9090/metrics | grep keeper_coordination
```

**Key metrics:**
- `keeper_coordination_mode{mode="sharded"}` - Current coordination mode
- `keeper_shard_id` - This keeper's shard ID
- `keeper_total_shards` - Total number of shards
- `keeper_overlap_skipped_total` - Addresses skipped (belonged to other keepers)
- `keeper_lock_acquired` - Whether exclusive lock is held (0/1)

**Health checks:**

Each keeper writes a heartbeat file to `$KEEPER_LOCK_DIR/keeper-{id}-heartbeat.json`:

```json
{
  "keeperId": 0,
  "pid": 12345,
  "hostname": "keeper-0",
  "lastBatchIndex": 42,
  "lastBatchSize": 50,
  "timestamp": "2026-11-23T10:30:00.000Z",
  "overlapSkipped": 127
}
```

Monitor these files to detect:
- Keeper crashes (stale timestamp)
- Misconfiguration (all keepers skipping same addresses)
- Unbalanced sharding (one keeper processing everything)

### Troubleshooting HA Deployments

**All keepers report "nothing to process":**
- Check `KEEPER_INSTANCE_ID` is unique per keeper (0, 1, 2...)
- Verify `KEEPER_TOTAL_INSTANCES` matches actual number of keepers
- Confirm addresses exist in the contract

**Duplicate charges (IntervalNotElapsed errors):**
- Multiple keepers have same `KEEPER_INSTANCE_ID`
- Sharding is not enabled (`KEEPER_TOTAL_INSTANCES=1` on all instances)
- Check systemd template `%i` expansion or K8s pod index

**One keeper processes everything:**
- Other keepers have wrong `KEEPER_TOTAL_INSTANCES` value
- Address hashing is deterministic - some skew is normal
- Check heartbeat files to see which keepers are active

**Exclusive lock contention:**
- `KEEPER_LOCK_DIR` not on shared storage - each keeper sees own lock
- Filesystem permissions prevent lock file creation
- TTL too short - locks expire before cycle completes (raise `KEEPER_LOCK_TTL_MS`)

**Metrics show high `overlap_skipped`:**
- Expected in sharded mode - addresses route to their designated keeper
- Not an error unless value stops incrementing (keeper is stuck)

### Production Coordinator Implementations

The file-based coordinator (`FileCoordinator`) is production-ready for:
- Single-node multi-process deployments
- Multi-node with shared NFS/EFS storage
- Kubernetes StatefulSets with shared PVC

For larger deployments, implement `ICoordinator` with:

**Redis:**
```typescript
// Pseudo-code - implement in scripts/lib/redis-coordinator.ts
class RedisCoordinator implements ICoordinator {
  async acquireLock(): Promise<boolean> {
    // SET key value NX EX 300
    return await this.redis.set('keeper:lock', this.keeperId, 'NX', 'EX', 300);
  }
  // ... implement other methods
}
```

**PostgreSQL:**
```typescript
class PostgresCoordinator implements ICoordinator {
  async acquireLock(): Promise<boolean> {
    // SELECT pg_try_advisory_lock(123456789)
    const result = await this.pool.query(
      'SELECT pg_try_advisory_lock($1)', [this.lockId]
    );
    return result.rows[0].pg_try_advisory_lock;
  }
}
```

**Consul/etcd:**
Use native session/lease mechanisms for distributed locking.

See `scripts/lib/keeper-coordinator.ts` for the `ICoordinator` interface.

## Scheduling and the due window

In loop mode the keeper sleeps between cycles. The sleep is at most
`INTERVAL_SECONDS`, and it is shorter when a subscription comes due sooner.

After each cycle the keeper calls the read-only `get_charges_due_between(from, to,
offset, limit)` contract function. It asks for subscribers whose next charge falls
in `[now, now + INTERVAL_SECONDS]`, and it reads at most `SCHEDULE_SCAN_MAX_PAGES`
index pages (50 slots each). If something is due inside the window, the keeper
sleeps until the earliest due time. Otherwise it sleeps for the full interval.

- The interval is always the ceiling, so the keeper still runs at least that often.
- If the due-window read fails, the keeper logs a warning and uses the full
  interval. Scheduling never stops the loop.
- `--once` and dry runs are not affected. They run a single cycle and exit.

`get_charges_due_between` is bounded like `get_next_charge_batch`: `limit` is
capped at 50 and larger values fail with `BatchTooLarge`. Grace-lapsed
subscriptions are included. The cycle's own grace checks decide what is charged.

## Keeper tip (`charge_with_tip`)

The protocol can pay third-party keepers a share of the protocol fee. This is
optional and off by default.

- The admin sets the tip with `set_keeper_tip_bps(bps)`. It is basis points of the
  protocol fee, from `0` (off, the default) to `5000` (half the fee). Larger values
  are rejected with `InvalidKeeperTipBps` (54). Read it with `get_keeper_tip_bps()`.
- A keeper calls `charge_with_tip(user, keeper)`. The keeper signs as `keeper`, and
  on success receives `fee * bps / 10000` from the subscriber's allowance. The fee
  collector receives the rest of the protocol fee. The merchant's net is unchanged.
- Each tip emits a `keeper_tip` event with the keeper, the subscriber, and the amount.
- A plain `charge` never pays a tip, even when one is configured. Tips apply only
  when a protocol fee applies. With no fee, the tip is zero.

The bundled keeper (`scripts/keeper.ts`) batches charges through `batch_charge`,
which does not pay tips in this version. A keeper that wants the tip must call
`charge_with_tip` for each subscriber it charges.

## Recommended cadence

Default `INTERVAL_SECONDS` is 3600 (hourly). A cycle is cheap when nothing is
due, so running more often mostly costs RPC calls.

| Subscription interval | Suggested `INTERVAL_SECONDS` |
| --------------------- | ---------------------------- |
| Daily (86400)         | 3600                         |
| Weekly               | 3600                         |
| Hourly (3600)         | 900                          |
| Sub-hourly            | 300                          |

Keep the interval comfortably below the shortest billing interval, so a failed
cycle has time to retry before subscribers go past due.

## Troubleshooting

**`Cannot determine module format` / `require is not defined`**
You are running `ts-node`. Use `npx tsx`. See
[Runtime and invocation](#runtime-and-invocation).

**`Missing required environment variables` after editing `.env`**
There is no `.env` loading. Source the file or inline the variables. See
[Configuration is environment-only](#configuration-is-environment-only).

**Keeper exits 0 but nothing is charged**
Check the log for the effective page size, then confirm there is anything due:
`get_next_charge_batch`. If everything returns `Skipped`, the interval has not
elapsed and the keeper is behaving correctly.

**`BatchTooLarge` (error 20) in the logs**
Either the batch is over the on-chain cap or the effective `BATCH_SIZE` was not
narrowed because the `get_max_batch_size()` read failed. See
[Batch size resolution](#batch-size-resolution). The startup warning names it.

**`cannot specify both --propose and --commit` / unexpected fee errors**
You are running `rotate-fee-collector.ts`, not the keeper. See
[`scripts/README.md`](../scripts/README.md).

**`--max-batches` ignored, keeper never exits**
Use `--max-batches=2` with the `=`. See [Flags](#flags).

**Everything reports `AllowanceInsufficient`**
Not a keeper problem. Subscribers need to raise their token allowance to at
least the gross subscription amount. Alerting lives in
`alert-failed-charges.ts`; it reads the `batch_charge_skips` event, not the DLQ.

**RPC read failures at startup**
`resolveBatchSize()` warns and proceeds un-narrowed. The keeper still runs, but
the legacy path may over-batch. Check `RPC_URL` and the network passphrase.

**Dry-run shows charges that do not happen live**
Expected. `get_batch_charge_estimate` does not check contract pause state or
token allowances, only subscription state, interval and grace period.

## Checklist

Before going live:

- [ ] A `--dry-run --once` cycle completes and the report looks right
- [ ] `BATCH_SIZE` is either unset or understood, and the legacy paging path
      is only in use deliberately
- [ ] `KEEPER_SECRET` is set and the keeper account is funded for gas
- [ ] `NETWORK_PASSPHRASE` matches the deployment network
- [ ] `/metrics` is reachable and scraped
- [ ] A restart mid-cycle has been tested (`Restart=always` covers this)

Routine:

- [ ] Check cycle success rate and error count daily
- [ ] Triage the DLQ when it grows: `wc -l dlq/failed-batches.jsonl`
- [ ] Watch the allowance-insufficient count; it is the actionable failure
- [ ] Confirm the keeper account has gas

On incident:

- [ ] Stop the service, then check the last cycle report in `REPORT_DIR`
- [ ] Dry-run a single cycle to see current on-chain state
- [ ] Replay the DLQ after the cause is fixed, not before
- [ ] Do not raise `BATCH_SIZE` to work around `BatchTooLarge`; the on-chain cap
      is what is rejecting the batch
