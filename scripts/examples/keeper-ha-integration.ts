/**
 * Example: Integrating coordinator into keeper.ts
 *
 * This file shows how to integrate the keeper-coordinator into the main
 * keeper script. Copy the relevant sections into scripts/keeper.ts.
 */

import { createCoordinator, type ICoordinator } from "../lib/keeper-coordinator.js";
import {
  updateCoordinationMetrics,
  recordLockAttempt,
} from "../lib/keeper-metrics.js";

// ── At module level (after imports) ──────────────────────────────────────────

// Create coordinator from environment
const coordinator = createCoordinator({
  totalKeepers: Number(process.env.KEEPER_TOTAL_INSTANCES) || 1,
  keeperId: Number(process.env.KEEPER_INSTANCE_ID) || 0,
  lockDir: process.env.KEEPER_LOCK_DIR,
  lockTtlMs: Number(process.env.KEEPER_LOCK_TTL_MS) || undefined,
  useExclusiveLocking: process.env.KEEPER_EXCLUSIVE_LOCK === "true",
});

// Log coordination mode on startup
const coordMetadata = coordinator.getMetadata();
console.log(`[Keeper] Coordination mode: ${coordMetadata.mode}`);
if (coordMetadata.mode === "sharded") {
  console.log(
    `[Keeper] Shard ${coordMetadata.shardId} of ${coordMetadata.totalShards}`
  );
}

// Update metrics
updateCoordinationMetrics(coordMetadata);

// ── In main cycle function ────────────────────────────────────────────────────

async function runChargeCycle(): Promise<void> {
  // 1. Try to acquire lock (if exclusive mode)
  const lockAcquired = await coordinator.acquireLock();
  
  if (!lockAcquired) {
    console.log("[Keeper] Another keeper holds the lock, skipping cycle");
    recordLockAttempt("failure");
    return;
  }
  
  recordLockAttempt("success");

  try {
    // 2. Fetch subscriber addresses (from index, contract, etc.)
    const allAddresses = await fetchSubscriberAddresses();

    // 3. Filter to only addresses this keeper should process
    const addressesToCharge = allAddresses.filter((addr) =>
      coordinator.shouldProcess(addr)
    );

    console.log(
      `[Keeper] Processing ${addressesToCharge.length} of ${allAddresses.length} addresses ` +
      `(${allAddresses.length - addressesToCharge.length} belong to other shards)`
    );

    // 4. Process batches as normal
    let batchIndex = 0;
    for (let i = 0; i < addressesToCharge.length; i += BATCH_SIZE) {
      const batch = addressesToCharge.slice(i, i + BATCH_SIZE);
      
      await processBatch(batch);
      
      // Record batch processed for heartbeat tracking
      coordinator.recordBatchProcessed(batchIndex++, batch.length);
    }

    // 5. Update coordination metrics at cycle end
    const metadata = coordinator.getMetadata();
    updateCoordinationMetrics(metadata);

    console.log(
      `[Keeper] Cycle complete. Overlap skipped: ${metadata.overlapDetected}`
    );
  } finally {
    // 6. Always release lock
    await coordinator.releaseLock();
  }
}

// ── Helper functions ──────────────────────────────────────────────────────────

async function fetchSubscriberAddresses(): Promise<string[]> {
  // Your existing logic to get subscriber list
  // E.g., from get_subscriber_page, buildOptimizedBatches, etc.
  return [];
}

async function processBatch(addresses: string[]): Promise<void> {
  // Your existing batch_charge logic
  console.log(`Processing batch of ${addresses.length} addresses`);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  console.log("[Keeper] Shutting down...");
  await coordinator.releaseLock();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[Keeper] Shutting down...");
  await coordinator.releaseLock();
  process.exit(0);
});

// ── Usage Examples ────────────────────────────────────────────────────────────

/**
 * Single keeper (no coordination):
 *
 * $ CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
 *
 * Output:
 *   [Keeper] Coordination mode: single
 *   [Keeper] Processing 150 of 150 addresses
 */

/**
 * Sharded keeper (3 instances):
 *
 * # Keeper 0
 * $ KEEPER_TOTAL_INSTANCES=3 KEEPER_INSTANCE_ID=0 \
 *   CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
 *
 * Output:
 *   [Keeper] Coordination mode: sharded
 *   [Keeper] Shard 0 of 3
 *   [Keeper] Processing 51 of 150 addresses (99 belong to other shards)
 *
 * # Keeper 1 (different machine)
 * $ KEEPER_TOTAL_INSTANCES=3 KEEPER_INSTANCE_ID=1 \
 *   CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
 *
 * Output:
 *   [Keeper] Coordination mode: sharded
 *   [Keeper] Shard 1 of 3
 *   [Keeper] Processing 49 of 150 addresses (101 belong to other shards)
 *
 * # Keeper 2
 * $ KEEPER_TOTAL_INSTANCES=3 KEEPER_INSTANCE_ID=2 \
 *   CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
 *
 * Output:
 *   [Keeper] Coordination mode: sharded
 *   [Keeper] Shard 2 of 3
 *   [Keeper] Processing 50 of 150 addresses (100 belong to other shards)
 *
 * Total: 51 + 49 + 50 = 150 (all addresses processed, zero overlap)
 */

/**
 * Exclusive locking (failover):
 *
 * # Primary keeper
 * $ KEEPER_EXCLUSIVE_LOCK=true KEEPER_LOCK_DIR=/shared/locks \
 *   CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
 *
 * Output:
 *   [Keeper] Coordination mode: single
 *   [Keeper] Processing 150 of 150 addresses
 *
 * # Standby keeper (different machine)
 * $ KEEPER_EXCLUSIVE_LOCK=true KEEPER_LOCK_DIR=/shared/locks \
 *   CONTRACT_ID=C... KEEPER_PUBLIC_KEY=G... KEEPER_SECRET=S... npx tsx keeper.ts
 *
 * Output:
 *   [Keeper] Coordination mode: single
 *   [Keeper] Another keeper holds the lock, skipping cycle
 *   [Keeper] Another keeper holds the lock, skipping cycle
 *   ... (retries every cycle until primary fails)
 */
