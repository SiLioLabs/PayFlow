# Keeper Coordination System

This directory contains the coordination infrastructure for running multiple PayFlow keeper instances in high-availability (HA) configurations.

## Problem Statement

Without coordination, multiple keeper instances will:
- Submit duplicate `batch_charge` transactions for the same users
- Waste transaction fees when second keeper hits `IntervalNotElapsed` (error 6)
- Create unnecessary RPC load
- Complicate monitoring (which keeper processed which subscriber?)

## Solution: Deterministic Sharding

The coordinator uses **consistent hashing** to assign address ranges to keepers:

```
Address → SHA-256 hash → modulo total_keepers → keeper_id
```

This ensures:
- **Zero overlap**: Each address is processed by exactly one keeper
- **Consistency**: Same address always routes to the same keeper
- **No coordination overhead**: No network calls, locks, or leader election needed
- **Automatic rebalancing**: Adding/removing keepers redistributes load evenly

## Architecture

### Files

- **`keeper-coordinator.ts`**: Core coordination logic
  - `ICoordinator` interface for pluggable backends
  - `FileCoordinator`: File-based implementation (production-ready)
  - `NoOpCoordinator`: Backward-compatible no-op mode
  - `createCoordinator()`: Factory function

- **`keeper-metrics.ts`**: Prometheus metrics for coordination
  - Shard ID and total shards
  - Overlap detection counters
  - Lock acquisition status
  - Coordination health gauge

- **`README-COORDINATION.md`**: This file

### Integration Points

The keeper script integrates coordination at two points:

1. **Startup**: Create coordinator, acquire lock (if exclusive mode)
   ```typescript
   const coordinator = createCoordinator({ totalKeepers: 3, keeperId: 0 });
   const lockAcquired = await coordinator.acquireLock();
   ```

2. **Batch processing**: Filter addresses before submission
   ```typescript
   const addressesToCharge = allAddresses.filter(addr =>
     coordinator.shouldProcess(addr)
   );
   ```

## Usage

### Single Keeper (Default)

No configuration needed. Coordinator is a no-op.

```bash
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
```

### Sharded Mode (3 Keepers)

Set `KEEPER_TOTAL_INSTANCES` and `KEEPER_INSTANCE_ID`:

```bash
# Keeper 0
KEEPER_TOTAL_INSTANCES=3 KEEPER_INSTANCE_ID=0 npx tsx keeper.ts

# Keeper 1 (different machine/process)
KEEPER_TOTAL_INSTANCES=3 KEEPER_INSTANCE_ID=1 npx tsx keeper.ts

# Keeper 2
KEEPER_TOTAL_INSTANCES=3 KEEPER_INSTANCE_ID=2 npx tsx keeper.ts
```

### Exclusive Locking (Failover)

Only one keeper runs at a time. Others wait for the lock.

```bash
KEEPER_EXCLUSIVE_LOCK=true KEEPER_LOCK_DIR=/shared/locks npx tsx keeper.ts
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KEEPER_TOTAL_INSTANCES` | No | 1 | Total number of keeper instances |
| `KEEPER_INSTANCE_ID` | No | 0 | Zero-based index of this keeper (0 to N-1) |
| `KEEPER_EXCLUSIVE_LOCK` | No | false | Enable exclusive locking mode |
| `KEEPER_LOCK_DIR` | No | `/tmp/payflow-keeper-locks` | Directory for lock files |
| `KEEPER_LOCK_TTL_MS` | No | 300000 | Lock TTL in milliseconds (5 minutes) |

### Kubernetes StatefulSet

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
        # ... other config
```

The `pod-index` field automatically provides 0, 1, 2 for a 3-replica StatefulSet.

### systemd Template Service

```ini
# /etc/systemd/system/payflow-keeper@.service
[Service]
Environment=KEEPER_TOTAL_INSTANCES=3
Environment=KEEPER_INSTANCE_ID=%i
# ... other config
```

```bash
systemctl start payflow-keeper@0
systemctl start payflow-keeper@1
systemctl start payflow-keeper@2
```

The `%i` specifier is replaced with the instance identifier (0, 1, 2).

## Deployment Patterns

### Pattern 1: Sharded (Recommended)

**Use when:**
- Running 2+ keepers for high availability
- Want even load distribution
- Need zero overlap/wasted fees

**Characteristics:**
- All keepers run simultaneously
- Each processes ~1/N of addresses
- No central coordination needed
- Scales horizontally

**Failure behavior:**
- If keeper crashes, its shard is unprocessed until restart
- Subscription intervals provide natural retry window
- Use Kubernetes/systemd restarts for auto-healing

### Pattern 2: Exclusive Lock (Failover)

**Use when:**
- Simple active/standby failover
- Shared filesystem available (NFS, EFS)
- Lower total throughput acceptable

**Characteristics:**
- One keeper active, others on standby
- Standby keepers retry lock every cycle
- Failover within lock TTL (default 5 min)

**Failure behavior:**
- Active keeper dies → standby acquires lock
- Split brain if lock file storage fails
- Requires shared storage (not independent filesystems)

### Pattern 3: Hybrid (Sharded + Regional)

**Use when:**
- Global deployment across regions
- Want regional redundancy + sharding

**Setup:**
```
Region 1: keepers 0, 1, 2 (KEEPER_TOTAL_INSTANCES=6, IDs 0-2)
Region 2: keepers 3, 4, 5 (KEEPER_TOTAL_INSTANCES=6, IDs 3-5)
```

Each region handles its shard, regions are independent.

## Monitoring

### Metrics

```bash
curl -s localhost:9090/metrics | grep keeper_coordination
```

**Key metrics:**
- `keeper_coordination_mode{mode="sharded"}` - 1 if sharded, 0 if single
- `keeper_shard_id` - This keeper's ID
- `keeper_total_shards` - Total number of shards
- `keeper_overlap_skipped_total` - Addresses skipped (expected in sharded mode)
- `keeper_lock_acquired` - 1 if holding exclusive lock, 0 otherwise

### Heartbeat Files

Each keeper writes `$KEEPER_LOCK_DIR/keeper-{id}-heartbeat.json`:

```json
{
  "keeperId": 0,
  "pid": 12345,
  "hostname": "keeper-0.payflow.svc.cluster.local",
  "lastBatchIndex": 42,
  "lastBatchSize": 50,
  "timestamp": "2026-11-23T12:00:00.000Z",
  "overlapSkipped": 127
}
```

**Monitor for:**
- Stale timestamps (keeper crashed)
- All keepers showing `lastBatchSize: 0` (nothing to process)
- `overlapSkipped: 0` on all keepers (misconfiguration)

### Alerting

**Alert: Duplicate keeper IDs**
```promql
count by (keeper_shard_id) (keeper_shard_id) > 1
```

**Alert: Keeper down**
```promql
time() - keeper_last_cycle_timestamp_seconds > 7200
```

**Alert: Misconfigured sharding**
```promql
keeper_overlap_skipped_total == 0 and keeper_total_shards > 1
```

## Testing

### Unit Tests

```bash
cd scripts
npm test keeper-coordinator.test.ts
```

Tests cover:
- Single keeper mode
- 2-keeper sharding
- 3-keeper sharding
- Exclusive locking
- Lock TTL expiry
- Heartbeat tracking
- Address consistency

### Integration Test: 2 Keepers

```bash
# Terminal 1
KEEPER_TOTAL_INSTANCES=2 KEEPER_INSTANCE_ID=0 \
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... \
npx tsx keeper.ts --once

# Terminal 2
KEEPER_TOTAL_INSTANCES=2 KEEPER_INSTANCE_ID=1 \
CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... \
npx tsx keeper.ts --once
```

**Expected:**
- Both complete successfully
- Each processes ~50% of addresses
- Zero `IntervalNotElapsed` errors
- `overlap_skipped` counter > 0 on both

### Dry-Run Comparison

```bash
# Single keeper baseline
DRY_RUN=true npx tsx keeper.ts --once > single.log

# Sharded keeper 0
KEEPER_TOTAL_INSTANCES=2 KEEPER_INSTANCE_ID=0 \
DRY_RUN=true npx tsx keeper.ts --once > shard0.log

# Sharded keeper 1
KEEPER_TOTAL_INSTANCES=2 KEEPER_INSTANCE_ID=1 \
DRY_RUN=true npx tsx keeper.ts --once > shard1.log

# Verify: shard0 + shard1 == single
grep "totalCharged" *.log
```

## Troubleshooting

### All keepers skip everything

**Symptoms:**
- All keepers report 0 addresses processed
- `overlap_skipped` counter increments but no charges

**Causes:**
1. All keepers have same `KEEPER_INSTANCE_ID` → Fix: Unique IDs
2. `KEEPER_TOTAL_INSTANCES` mismatch → Fix: Same value on all keepers
3. No subscribers due for charge → Expected behavior

**Debug:**
```bash
# Check config
echo $KEEPER_TOTAL_INSTANCES $KEEPER_INSTANCE_ID

# Check metrics
curl localhost:9090/metrics | grep keeper_shard

# Dry-run to see what would process
DRY_RUN=true npx tsx keeper.ts --once
```

### Duplicate charges (IntervalNotElapsed)

**Symptoms:**
- Both keepers charge same addresses
- `IntervalNotElapsed` errors in logs
- Wasted transaction fees

**Causes:**
1. Keepers not configured for sharding → Fix: Set `KEEPER_TOTAL_INSTANCES`
2. Duplicate `KEEPER_INSTANCE_ID` → Fix: Unique IDs (0, 1, 2...)
3. Systemd template `%i` not expanding → Fix: Check service name

**Debug:**
```bash
# Check if sharding is active
curl localhost:9090/metrics | grep keeper_coordination_mode

# Should show mode="sharded" = 1
```

### Lock contention (exclusive mode)

**Symptoms:**
- Only one keeper ever runs
- Other keepers log "failed to acquire lock"

**Expected in exclusive mode!** This is correct failover behavior.

If unexpected:
- `KEEPER_EXCLUSIVE_LOCK` set when not intended
- Shared lock directory preventing concurrent access

### Uneven distribution

**Symptoms:**
- One keeper processes 80%, another 20%

**Expected:** Hash distribution has ~10-20% variance. For 100 addresses:
- Good: 45/55 split
- Expected: 35/65 split
- Bad: 10/90 split (misconfiguration)

**Causes:**
- Small address count (variance is higher with <100 addresses)
- Different `KEEPER_TOTAL_INSTANCES` values across keepers

**Fix:** Ensure all keepers have matching `KEEPER_TOTAL_INSTANCES`.

## Production Checklist

Before deploying HA keepers:

- [ ] `KEEPER_TOTAL_INSTANCES` matches actual replica count
- [ ] `KEEPER_INSTANCE_ID` is unique per keeper (0, 1, 2...)
- [ ] Metrics endpoint accessible and scraped
- [ ] Heartbeat files monitored for staleness
- [ ] Alert on duplicate shard IDs
- [ ] Alert on all keepers idle (nothing to process is OK, all down is not)
- [ ] Tested failover (kill one keeper, verify others continue)
- [ ] Tested scale-up (add keeper, verify rebalancing)
- [ ] Lock directory on shared storage (if using exclusive mode)

## Extending the Coordinator

To implement Redis/PostgreSQL/Consul coordination:

1. Implement the `ICoordinator` interface:

```typescript
export class RedisCoordinator implements ICoordinator {
  constructor(private redis: Redis, private options: CoordinatorOptions) {}

  shouldProcess(address: string): boolean {
    // Same hash-based sharding logic
    const hash = crypto.createHash("sha256").update(address).digest();
    const hashInt = hash.readUInt32BE(0);
    return (hashInt % this.options.totalKeepers) === this.options.keeperId;
  }

  async acquireLock(): Promise<boolean> {
    // Redis SETNX with expiry
    const result = await this.redis.set(
      "payflow:keeper:lock",
      this.options.keeperId.toString(),
      "NX",
      "EX",
      300 // 5 minute TTL
    );
    return result === "OK";
  }

  async releaseLock(): Promise<void> {
    await this.redis.del("payflow:keeper:lock");
  }

  // ... implement other methods
}
```

2. Update `createCoordinator()` factory to detect Redis configuration
3. Optionally expose via `KEEPER_COORDINATOR_TYPE=redis` env var

See `keeper-coordinator.ts` for the full interface contract.
