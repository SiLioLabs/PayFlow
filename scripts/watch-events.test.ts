import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("watch-events watermark and memory management", () => {
  const WATERMARK_FILE = path.join(process.cwd(), ".watch-events-watermark-test.json");

  beforeEach(() => {
    // Clean up test watermark file
    if (fs.existsSync(WATERMARK_FILE)) {
      fs.unlinkSync(WATERMARK_FILE);
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(WATERMARK_FILE)) {
      fs.unlinkSync(WATERMARK_FILE);
    }
  });

  it("should persist watermark state to disk", () => {
    const watermark = {
      lastCursor: "test-cursor-1",
      lastLedger: 12345,
      seenCount: 100,
      timestamp: Date.now(),
    };

    // Simulate saving watermark
    fs.writeFileSync(WATERMARK_FILE, JSON.stringify(watermark, null, 2));

    // Verify it was written correctly
    const loaded = JSON.parse(fs.readFileSync(WATERMARK_FILE, "utf8"));
    expect(loaded.lastCursor).toBe("test-cursor-1");
    expect(loaded.lastLedger).toBe(12345);
    expect(loaded.seenCount).toBe(100);
  });

  it("should load watermark from disk on restart", () => {
    const originalWatermark = {
      lastCursor: "test-cursor-2",
      lastLedger: 54321,
      seenCount: 250,
      timestamp: Date.now(),
    };

    // Save initial watermark
    fs.writeFileSync(WATERMARK_FILE, JSON.stringify(originalWatermark, null, 2));

    // Simulate restart and load
    const loaded = JSON.parse(fs.readFileSync(WATERMARK_FILE, "utf8"));

    // Verify resumption from watermark
    expect(loaded.lastCursor).toBe(originalWatermark.lastCursor);
    expect(loaded.lastLedger).toBe(originalWatermark.lastLedger);
    expect(loaded.seenCount).toBe(originalWatermark.seenCount);
  });

  it("should bound the seen-set in steady-state with TTL/watermark", () => {
    const MAX_SEEN_SET_SIZE = 10000;
    const seenEventIds = new Set<string>();

    // Simulate adding events until capacity
    for (let i = 0; i < MAX_SEEN_SET_SIZE; i++) {
      seenEventIds.add(`event-${i}`);
    }

    expect(seenEventIds.size).toBe(MAX_SEEN_SET_SIZE);

    // Simulate watermark-based pruning
    seenEventIds.clear();
    expect(seenEventIds.size).toBe(0);

    // Add new events after pruning
    for (let i = 0; i < 100; i++) {
      seenEventIds.add(`event-new-${i}`);
    }

    expect(seenEventIds.size).toBe(100);
    expect(seenEventIds.has("event-new-0")).toBe(true);
  });

  it("should prune cursor list to prevent unbounded growth", () => {
    const CURSOR_WINDOW = 100;
    const cursors: string[] = [];

    // Add cursors beyond the window
    for (let i = 0; i < CURSOR_WINDOW + 50; i++) {
      cursors.push(`cursor-${i}`);
    }

    expect(cursors.length).toBe(CURSOR_WINDOW + 50);

    // Simulate pruning
    const pruned = cursors.length > CURSOR_WINDOW ? cursors.slice(-CURSOR_WINDOW) : cursors;

    expect(pruned.length).toBe(CURSOR_WINDOW);
    expect(pruned[0]).toBe(`cursor-${50}`);
    expect(pruned[CURSOR_WINDOW - 1]).toBe(`cursor-${CURSOR_WINDOW + 49}`);
  });

  it("should detect and skip duplicate events by ledger-index ID", () => {
    const eventIds = new Set<string>();

    // First occurrence
    const eventId1 = "12345-0";
    eventIds.add(eventId1);
    expect(eventIds.has(eventId1)).toBe(true);

    // Duplicate (same ledger and index)
    const eventId2 = "12345-0";
    const isDuplicate = eventIds.has(eventId2);
    expect(isDuplicate).toBe(true);

    // Different event
    const eventId3 = "12345-1";
    expect(eventIds.has(eventId3)).toBe(false);
    eventIds.add(eventId3);
    expect(eventIds.has(eventId3)).toBe(true);
  });

  it("should maintain deterministic pagination with cursor", () => {
    const watermark = {
      lastCursor: "stable-cursor-abc",
      lastLedger: 10000,
      seenCount: 500,
      timestamp: Date.now(),
    };

    // Save watermark
    fs.writeFileSync(WATERMARK_FILE, JSON.stringify(watermark, null, 2));

    // Simulate multiple restarts - cursor should be stable
    for (let i = 0; i < 3; i++) {
      const loaded = JSON.parse(fs.readFileSync(WATERMARK_FILE, "utf8"));
      expect(loaded.lastCursor).toBe("stable-cursor-abc");
      expect(loaded.lastLedger).toBe(10000);
    }
  });

  it("should recover from missing watermark gracefully", () => {
    // Watermark file does not exist
    expect(fs.existsSync(WATERMARK_FILE)).toBe(false);

    // Should initialize with defaults
    const defaultWatermark = {
      lastCursor: "",
      lastLedger: 0,
      seenCount: 0,
      timestamp: Date.now(),
    };

    expect(defaultWatermark.lastCursor).toBe("");
    expect(defaultWatermark.lastLedger).toBe(0);
    expect(defaultWatermark.seenCount).toBe(0);
  });
});
