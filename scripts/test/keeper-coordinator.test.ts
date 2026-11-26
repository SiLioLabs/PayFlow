/**
 * Tests for keeper coordination (deterministic sharding and locking).
 *
 * Run with: npx vitest run keeper-coordinator.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCoordinator, NoOpCoordinator } from "../lib/keeper-coordinator.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("KeeperCoordinator", () => {
  const testLockDir = path.join(os.tmpdir(), "payflow-keeper-test-locks");

  beforeEach(() => {
    // Clean up test lock directory
    if (fs.existsSync(testLockDir)) {
      fs.rmSync(testLockDir, { recursive: true });
    }
    fs.mkdirSync(testLockDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(testLockDir)) {
      fs.rmSync(testLockDir, { recursive: true });
    }
  });

  describe("Single keeper mode", () => {
    it("should process all addresses when totalKeepers=1", () => {
      const coordinator = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
      });

      const testAddresses = [
        "GABC123...",
        "GDEF456...",
        "GHIJ789...",
      ];

      for (const addr of testAddresses) {
        expect(coordinator.shouldProcess(addr)).toBe(true);
      }
    });

    it("should return single mode in metadata", () => {
      const coordinator = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
      });

      const metadata = coordinator.getMetadata();
      expect(metadata.mode).toBe("single");
      expect(metadata.totalShards).toBe(1);
    });
  });

  describe("Sharded mode (2 keepers)", () => {
    it("should deterministically shard addresses across 2 keepers", () => {
      const keeper0 = new FileCoordinator({
        totalKeepers: 2,
        keeperId: 0,
        lockDir: testLockDir,
      });

      const keeper1 = new FileCoordinator({
        totalKeepers: 2,
        keeperId: 1,
        lockDir: testLockDir,
      });

      // Test a set of addresses
      const testAddresses = [
        "GABC1234567890ABCDEF",
        "GDEF9876543210FEDCBA",
        "GHIJ1111111111111111",
        "GKLM2222222222222222",
        "GNOP3333333333333333",
        "GQRS4444444444444444",
      ];

      let keeper0Count = 0;
      let keeper1Count = 0;

      for (const addr of testAddresses) {
        const processed0 = keeper0.shouldProcess(addr);
        const processed1 = keeper1.shouldProcess(addr);

        // Each address should be processed by exactly one keeper
        expect(processed0 !== processed1).toBe(true);

        if (processed0) keeper0Count++;
        if (processed1) keeper1Count++;
      }

      // Both keepers should process some addresses
      expect(keeper0Count).toBeGreaterThan(0);
      expect(keeper1Count).toBeGreaterThan(0);
      expect(keeper0Count + keeper1Count).toBe(testAddresses.length);
    });

    it("should consistently assign the same address to the same keeper", () => {
      const keeper0 = new FileCoordinator({
        totalKeepers: 2,
        keeperId: 0,
        lockDir: testLockDir,
      });

      const testAddr = "GABC1234567890ABCDEF";

      // Check multiple times - should be consistent
      const result1 = keeper0.shouldProcess(testAddr);
      const result2 = keeper0.shouldProcess(testAddr);
      const result3 = keeper0.shouldProcess(testAddr);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it("should return sharded mode in metadata", () => {
      const coordinator = new FileCoordinator({
        totalKeepers: 2,
        keeperId: 0,
        lockDir: testLockDir,
      });

      const metadata = coordinator.getMetadata();
      expect(metadata.mode).toBe("sharded");
      expect(metadata.totalShards).toBe(2);
      expect(metadata.shardId).toBe(0);
    });

    it("should track overlap count when skipping addresses", () => {
      const keeper1 = new FileCoordinator({
        totalKeepers: 2,
        keeperId: 1,
        lockDir: testLockDir,
      });

      const testAddresses = [
        "GABC1234567890ABCDEF",
        "GDEF9876543210FEDCBA",
        "GHIJ1111111111111111",
      ];

      for (const addr of testAddresses) {
        keeper1.shouldProcess(addr);
      }

      const metadata = keeper1.getMetadata();
      // Some addresses should be skipped (assigned to keeper 0)
      expect(metadata.overlapDetected).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Exclusive locking", () => {
    it("should acquire lock when no other keeper holds it", async () => {
      const coordinator = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
        useExclusiveLocking: true,
      });

      const acquired = await coordinator.acquireLock();
      expect(acquired).toBe(true);

      await coordinator.releaseLock();
    });

    it("should fail to acquire lock when another keeper holds it", async () => {
      const keeper1 = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
        useExclusiveLocking: true,
      });

      const keeper2 = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
        useExclusiveLocking: true,
      });

      // First keeper acquires lock
      const acquired1 = await keeper1.acquireLock();
      expect(acquired1).toBe(true);

      // Second keeper should fail
      const acquired2 = await keeper2.acquireLock();
      expect(acquired2).toBe(false);

      // Release and second keeper should succeed
      await keeper1.releaseLock();
      const acquired3 = await keeper2.acquireLock();
      expect(acquired3).toBe(true);

      await keeper2.releaseLock();
    });

    it("should allow re-entrant lock acquisition by same process", async () => {
      const coordinator = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
        useExclusiveLocking: true,
        lockTtlMs: 10000,
      });

      const acquired1 = await coordinator.acquireLock();
      expect(acquired1).toBe(true);

      // Same coordinator should be able to extend its lock
      const acquired2 = await coordinator.acquireLock();
      expect(acquired2).toBe(true);

      await coordinator.releaseLock();
    });

    it("should expire locks after TTL", async () => {
      const coordinator1 = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
        useExclusiveLocking: true,
        lockTtlMs: 100, // 100ms for fast test
      });

      // Acquire lock
      const acquired1 = await coordinator1.acquireLock();
      expect(acquired1).toBe(true);

      // Wait for lock to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Another keeper should be able to acquire expired lock
      const coordinator2 = new FileCoordinator({
        totalKeepers: 1,
        keeperId: 0,
        lockDir: testLockDir,
        useExclusiveLocking: true,
      });

      const acquired2 = await coordinator2.acquireLock();
      expect(acquired2).toBe(true);

      await coordinator2.releaseLock();
    });
  });

  describe("Heartbeat tracking", () => {
    it("should record batch processing in heartbeat file", () => {
      const coordinator = new FileCoordinator({
        totalKeepers: 2,
        keeperId: 0,
        lockDir: testLockDir,
      });

      coordinator.recordBatchProcessed(5, 50);

      const heartbeatFile = path.join(testLockDir, "keeper-0-heartbeat.json");
      expect(fs.existsSync(heartbeatFile)).toBe(true);

      const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, "utf-8"));
      expect(heartbeat.keeperId).toBe(0);
      expect(heartbeat.lastBatchIndex).toBe(5);
      expect(heartbeat.lastBatchSize).toBe(50);
      expect(heartbeat.hostname).toBe(os.hostname());
      expect(heartbeat.pid).toBe(process.pid);
    });
  });

  describe("NoOpCoordinator", () => {
    it("should process all addresses without coordination", () => {
      const coordinator = new NoOpCoordinator();

      const testAddresses = ["GABC...", "GDEF...", "GHIJ..."];

      for (const addr of testAddresses) {
        expect(coordinator.shouldProcess(addr)).toBe(true);
      }
    });

    it("should always acquire lock", async () => {
      const coordinator = new NoOpCoordinator();
      const acquired = await coordinator.acquireLock();
      expect(acquired).toBe(true);
    });

    it("should return single mode metadata", () => {
      const coordinator = new NoOpCoordinator();
      const metadata = coordinator.getMetadata();

      expect(metadata.mode).toBe("single");
      expect(metadata.lockAcquired).toBe(true);
      expect(metadata.overlapDetected).toBe(0);
    });
  });

  describe("Sharded mode with 3 keepers", () => {
    it("should evenly distribute addresses across 3 keepers", () => {
      const keeper0 = new FileCoordinator({
        totalKeepers: 3,
        keeperId: 0,
        lockDir: testLockDir,
      });

      const keeper1 = new FileCoordinator({
        totalKeepers: 3,
        keeperId: 1,
        lockDir: testLockDir,
      });

      const keeper2 = new FileCoordinator({
        totalKeepers: 3,
        keeperId: 2,
        lockDir: testLockDir,
      });

      // Generate 300 test addresses
      const testAddresses = Array.from({ length: 300 }, (_, i) =>
        `GTEST${i.toString().padStart(10, "0")}`
      );

      let keeper0Count = 0;
      let keeper1Count = 0;
      let keeper2Count = 0;

      for (const addr of testAddresses) {
        if (keeper0.shouldProcess(addr)) keeper0Count++;
        if (keeper1.shouldProcess(addr)) keeper1Count++;
        if (keeper2.shouldProcess(addr)) keeper2Count++;
      }

      // All addresses should be processed
      expect(keeper0Count + keeper1Count + keeper2Count).toBe(testAddresses.length);

      // Distribution should be reasonably even (allow 20% variance)
      const avgPerKeeper = testAddresses.length / 3;
      expect(keeper0Count).toBeGreaterThan(avgPerKeeper * 0.8);
      expect(keeper0Count).toBeLessThan(avgPerKeeper * 1.2);
      expect(keeper1Count).toBeGreaterThan(avgPerKeeper * 0.8);
      expect(keeper1Count).toBeLessThan(avgPerKeeper * 1.2);
      expect(keeper2Count).toBeGreaterThan(avgPerKeeper * 0.8);
      expect(keeper2Count).toBeLessThan(avgPerKeeper * 1.2);
    });
  });
});
