/**
 * keeper-metrics.ts — Coordination metrics for HA keeper deployments
 *
 * Extends the base metrics with coordination-specific counters.
 */

import { Counter, Gauge, register } from "prom-client";

// Coordination mode gauge
export const coordinationModeGauge = new Gauge({
  name: "keeper_coordination_mode",
  help: "Current coordination mode: 0=single, 1=sharded",
  labelNames: ["mode"],
  registers: [register],
});

// Shard identification
export const shardIdGauge = new Gauge({
  name: "keeper_shard_id",
  help: "This keeper's shard ID (0-based index)",
  registers: [register],
});

export const totalShardsGauge = new Gauge({
  name: "keeper_total_shards",
  help: "Total number of keeper shards in the deployment",
  registers: [register],
});

// Overlap detection
export const overlapSkippedCounter = new Counter({
  name: "keeper_overlap_skipped_total",
  help: "Total addresses skipped because they belong to another keeper shard",
  registers: [register],
});

// Lock status
export const lockAcquiredGauge = new Gauge({
  name: "keeper_lock_acquired",
  help: "Whether this keeper holds the exclusive lock (1=yes, 0=no)",
  registers: [register],
});

// Lock acquisition attempts
export const lockAttemptsCounter = new Counter({
  name: "keeper_lock_attempts_total",
  help: "Total lock acquisition attempts",
  labelNames: ["result"], // success, failure, skipped
  registers: [register],
});

// Coordination health
export const coordinationHealthGauge = new Gauge({
  name: "keeper_coordination_health",
  help: "Coordination health status: 1=healthy, 0=unhealthy",
  registers: [register],
});

/**
 * Update coordination metrics from coordinator metadata.
 */
export function updateCoordinationMetrics(metadata: {
  mode: "single" | "sharded";
  shardId?: number;
  totalShards?: number;
  lockAcquired: boolean;
  overlapDetected: number;
}): void {
  // Set coordination mode
  coordinationModeGauge.labels({ mode: "single" }).set(metadata.mode === "single" ? 1 : 0);
  coordinationModeGauge.labels({ mode: "sharded" }).set(metadata.mode === "sharded" ? 1 : 0);

  // Set shard info
  if (metadata.shardId !== undefined) {
    shardIdGauge.set(metadata.shardId);
  }
  if (metadata.totalShards !== undefined) {
    totalShardsGauge.set(metadata.totalShards);
  }

  // Set lock status
  lockAcquiredGauge.set(metadata.lockAcquired ? 1 : 0);

  // Update overlap counter (cumulative)
  if (metadata.overlapDetected > 0) {
    overlapSkippedCounter.inc(metadata.overlapDetected);
  }

  // Health check: system is healthy if properly configured
  const isHealthy =
    metadata.mode === "single" ||
    (metadata.mode === "sharded" &&
      metadata.shardId !== undefined &&
      metadata.totalShards !== undefined &&
      metadata.totalShards > 1);

  coordinationHealthGauge.set(isHealthy ? 1 : 0);
}

/**
 * Record a lock acquisition attempt.
 */
export function recordLockAttempt(result: "success" | "failure" | "skipped"): void {
  lockAttemptsCounter.labels({ result }).inc();
}
