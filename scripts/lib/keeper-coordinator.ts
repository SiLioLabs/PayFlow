/**
 * keeper-coordinator.ts — Coordinator for HA keeper deployments
 *
 * Prevents duplicate work when running multiple keeper instances by:
 * 1. Deterministic sharding: assigns address ranges to keepers by address hash
 * 2. Optional file-based locking for single-keeper enforcement
 *
 * This module is intentionally filesystem-based for simplicity. Production
 * deployments can swap in Redis/database advisory locks by implementing the
 * ICoordinator interface.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

export interface ICoordinator {
  /**
   * Returns true if this keeper instance should process the given address.
   * Uses deterministic sharding when multiple keepers are configured.
   */
  shouldProcess(address: string): boolean;

  /**
   * Attempts to acquire an exclusive lock for a charge cycle.
   * Returns true if lock acquired, false if another keeper holds it.
   */
  acquireLock(): Promise<boolean>;

  /**
   * Releases the lock acquired by acquireLock().
   */
  releaseLock(): Promise<void>;

  /**
   * Records that this keeper processed a batch successfully.
   * Used for metrics and coordination health checks.
   */
  recordBatchProcessed(batchIndex: number, addressCount: number): void;

  /**
   * Returns coordination metadata for metrics/logging.
   */
  getMetadata(): CoordinationMetadata;
}

export interface CoordinationMetadata {
  mode: "single" | "sharded";
  shardId?: number;
  totalShards?: number;
  lockAcquired: boolean;
  overlapDetected: number; // Count of skipped addresses due to other keepers
}

interface LockFile {
  pid: number;
  hostname: string;
  shardId: number | null;
  acquiredAt: string;
  expiresAt: string;
}

export interface CoordinatorOptions {
  /**
   * Total number of keeper instances in the deployment.
   * Default: 1 (single keeper, no sharding)
   */
  totalKeepers?: number;

  /**
   * Zero-based index of this keeper instance (0 to totalKeepers-1).
   * Default: 0
   * 
   * In Kubernetes: set from pod ordinal or downward API
   * In systemd: set via environment variable per service unit
   */
  keeperId?: number;

  /**
   * Directory for lock files. Default: /tmp/payflow-keeper-locks
   * Should be shared storage in multi-node setups (NFS, etc.)
   * Or use Redis/database locks instead (implement ICoordinator)
   */
  lockDir?: string;

  /**
   * Lock TTL in milliseconds. Default: 300000 (5 minutes)
   * Lock expires after this duration to prevent orphaned locks.
   */
  lockTtlMs?: number;

  /**
   * Whether to use exclusive locking. Default: false
   * When true, only one keeper can run at a time (failover mode).
   * When false, keepers shard work deterministically (HA mode).
   */
  useExclusiveLocking?: boolean;
}

/**
 * File-based coordinator for keeper HA.
 * 
 * Production deployments should consider:
 * - Redis: RedisCoordinator with SETNX for locks
 * - PostgreSQL: pg_advisory_lock() for locks
 * - Consul: consul.session.create() for locks
 * - etcd: etcd locks for distributed systems
 */
export class FileCoordinator implements ICoordinator {
  private readonly totalKeepers: number;
  private readonly keeperId: number;
  private readonly lockDir: string;
  private readonly lockTtlMs: number;
  private readonly useExclusiveLocking: boolean;
  private lockFilePath: string | null = null;
  private overlapCount = 0;

  constructor(options: CoordinatorOptions = {}) {
    this.totalKeepers = Math.max(1, options.totalKeepers ?? 1);
    this.keeperId = Math.max(0, Math.min(options.keeperId ?? 0, this.totalKeepers - 1));
    this.lockDir = options.lockDir ?? path.join(os.tmpdir(), "payflow-keeper-locks");
    this.lockTtlMs = options.lockTtlMs ?? 300_000; // 5 minutes
    this.useExclusiveLocking = options.useExclusiveLocking ?? false;

    // Ensure lock directory exists
    try {
      fs.mkdirSync(this.lockDir, { recursive: true });
    } catch (err) {
      console.warn(`[Coordinator] Failed to create lock dir ${this.lockDir}:`, err);
    }
  }

  /**
   * Deterministic sharding: assigns addresses to keepers by consistent hashing.
   * Each address always routes to the same keeper ID.
   */
  shouldProcess(address: string): boolean {
    // Single keeper processes everything
    if (this.totalKeepers === 1) {
      return true;
    }

    // Hash the address to a shard ID
    const hash = crypto.createHash("sha256").update(address).digest();
    const hashInt = hash.readUInt32BE(0);
    const targetShard = hashInt % this.totalKeepers;

    const shouldProcess = targetShard === this.keeperId;

    if (!shouldProcess) {
      this.overlapCount++;
    }

    return shouldProcess;
  }

  /**
   * Acquire an exclusive lock for this cycle.
   * In sharded mode, this is optional (each keeper has its own shard).
   * In exclusive mode, only one keeper runs at a time (failover).
   */
  async acquireLock(): Promise<boolean> {
    // Sharded mode without exclusive locking: no lock needed
    if (!this.useExclusiveLocking && this.totalKeepers > 1) {
      return true;
    }

    const lockFile = path.join(this.lockDir, "keeper-master.lock");
    this.lockFilePath = lockFile;

    try {
      // Check for existing lock
      if (fs.existsSync(lockFile)) {
        const content = fs.readFileSync(lockFile, "utf-8");
        const lock: LockFile = JSON.parse(content);

        // Check if lock is expired
        const now = Date.now();
        const expiresAt = new Date(lock.expiresAt).getTime();

        if (now < expiresAt) {
          // Lock is still valid
          // Check if it's held by this process (re-entrant)
          if (lock.pid === process.pid && lock.hostname === os.hostname()) {
            // Extend the lock
            const newExpiry = new Date(now + this.lockTtlMs).toISOString();
            lock.expiresAt = newExpiry;
            fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
            return true;
          }

          // Another keeper holds the lock
          return false;
        }

        // Lock expired, remove it
        fs.unlinkSync(lockFile);
      }

      // Acquire new lock
      const lock: LockFile = {
        pid: process.pid,
        hostname: os.hostname(),
        shardId: this.keeperId,
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.lockTtlMs).toISOString(),
      };

      // Atomic write with exclusive flag
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(fd, JSON.stringify(lock, null, 2));
      fs.closeSync(fd);

      return true;
    } catch (err) {
      // Lock acquisition failed (file exists race condition)
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }

      // Other error
      console.warn(`[Coordinator] Lock acquisition error:`, err);
      return false;
    }
  }

  /**
   * Release the lock held by this keeper.
   */
  async releaseLock(): Promise<void> {
    if (!this.lockFilePath) {
      return;
    }

    try {
      if (fs.existsSync(this.lockFilePath)) {
        const content = fs.readFileSync(this.lockFilePath, "utf-8");
        const lock: LockFile = JSON.parse(content);

        // Only remove lock if we own it
        if (lock.pid === process.pid && lock.hostname === os.hostname()) {
          fs.unlinkSync(this.lockFilePath);
        }
      }
    } catch (err) {
      console.warn(`[Coordinator] Lock release error:`, err);
    }

    this.lockFilePath = null;
  }

  /**
   * Record successful batch processing for health tracking.
   */
  recordBatchProcessed(batchIndex: number, addressCount: number): void {
    // Write a heartbeat file for monitoring
    const heartbeatFile = path.join(
      this.lockDir,
      `keeper-${this.keeperId}-heartbeat.json`
    );

    try {
      const heartbeat = {
        keeperId: this.keeperId,
        pid: process.pid,
        hostname: os.hostname(),
        lastBatchIndex: batchIndex,
        lastBatchSize: addressCount,
        timestamp: new Date().toISOString(),
        overlapSkipped: this.overlapCount,
      };

      fs.writeFileSync(heartbeatFile, JSON.stringify(heartbeat, null, 2));
    } catch (err) {
      console.warn(`[Coordinator] Heartbeat write error:`, err);
    }
  }

  /**
   * Get coordination metadata for logging/metrics.
   */
  getMetadata(): CoordinationMetadata {
    return {
      mode: this.totalKeepers > 1 ? "sharded" : "single",
      shardId: this.keeperId,
      totalShards: this.totalKeepers,
      lockAcquired: this.lockFilePath !== null,
      overlapDetected: this.overlapCount,
    };
  }
}

/**
 * No-op coordinator for backward compatibility.
 * Does no coordination, processes everything.
 */
export class NoOpCoordinator implements ICoordinator {
  shouldProcess(_address: string): boolean {
    return true;
  }

  async acquireLock(): Promise<boolean> {
    return true;
  }

  async releaseLock(): Promise<void> {
    // no-op
  }

  recordBatchProcessed(_batchIndex: number, _addressCount: number): void {
    // no-op
  }

  getMetadata(): CoordinationMetadata {
    return {
      mode: "single",
      lockAcquired: true,
      overlapDetected: 0,
    };
  }
}

/**
 * Factory function to create appropriate coordinator based on environment.
 */
export function createCoordinator(options: CoordinatorOptions = {}): ICoordinator {
  const totalKeepers = Number(process.env.KEEPER_TOTAL_INSTANCES) || options.totalKeepers || 1;
  const keeperId = Number(process.env.KEEPER_INSTANCE_ID) || options.keeperId || 0;
  const useExclusiveLocking =
    process.env.KEEPER_EXCLUSIVE_LOCK === "true" || options.useExclusiveLocking || false;

  // No coordination needed for single keeper
  if (totalKeepers === 1 && !useExclusiveLocking) {
    return new NoOpCoordinator();
  }

  return new FileCoordinator({
    ...options,
    totalKeepers,
    keeperId,
    useExclusiveLocking,
  });
}
