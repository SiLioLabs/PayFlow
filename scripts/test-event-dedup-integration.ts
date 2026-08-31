#!/usr/bin/env tsx
/**
 * test-event-dedup-integration.ts — Tests for EventDedupCache integration
 * into the indexer pipeline (issue #078).
 *
 * Covers:
 *   1. EventDedupCache core semantics (hits/misses/evictions/stats).
 *   2. Layer 1 — in-memory dedup: indexEvents() collapses duplicate raw
 *      events within/across polls into a single DB write.
 *   3. Layer 2 — DB dedup: even with a cold (post-restart) in-memory cache,
 *      the SQLite `ON CONFLICT` upsert still prevents duplicate rows.
 *   4. metrics-server.ts counters reflect cumulative dedup stats correctly.
 *
 * Run directly: tsx test-event-dedup-integration.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventDedupCache, createCacheKey } from "./event-dedup.js";
import {
  openDatabase,
  initSchema,
  indexEvents,
  parseEvent,
} from "./indexer.js";
import { recordIndexerDedupStats, metricsText } from "./metrics-server.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

/** Build a raw RPC-shaped event object like the Soroban SDK returns. */
function rawEvent(opts: {
  txHash: string;
  eventName: string;
  ledger: number;
  address?: string;
  amount?: number;
}): Record<string, unknown> {
  return {
    topic: [opts.eventName, opts.address ?? "GADDRESS"],
    ledger: opts.ledger,
    txHash: opts.txHash,
    ledgerClosedAt: new Date().toISOString(),
    value: opts.amount !== undefined ? { amount: opts.amount } : {},
  };
}

// ── 1. EventDedupCache core semantics ───────────────────────────────────────

function testDedupCacheCore(): void {
  console.log("Testing EventDedupCache core semantics...");

  const cache = new EventDedupCache(3, 0);

  assertEqual(cache.checkAndRecord("tx1", "charged", 100), false, "first sighting is a miss");
  assertEqual(cache.checkAndRecord("tx1", "charged", 100), true, "second sighting is a hit");
  assertEqual(cache.stats.hits, 1, "one hit recorded");
  assertEqual(cache.stats.misses, 1, "one miss recorded");

  // Different ledger for the same tx/event is a distinct entry.
  assertEqual(cache.checkAndRecord("tx1", "charged", 101), false, "different ledger is a new entry");

  // Fill to capacity (3) and force an eviction.
  cache.checkAndRecord("tx2", "charged", 102); // size now 3
  assertEqual(cache.stats.size, 3, "cache at capacity");
  cache.checkAndRecord("tx3", "charged", 103); // evicts tx1@100 (LRU)
  assertEqual(cache.stats.evictions, 1, "eviction occurred at capacity");
  assertEqual(
    cache.checkAndRecord("tx1", "charged", 100),
    false,
    "evicted entry is treated as new again",
  );

  console.log("  OK");
}

// ── 2 & 3. Layered dedup: in-memory + DB ────────────────────────────────────

function testLayeredDedup(): void {
  console.log("Testing layered dedup (in-memory cache + DB upsert)...");

  const dir = mkdtempSync(join(tmpdir(), "payflow-dedup-test-"));
  const dbFile = join(dir, "events.db");

  try {
    // ── First process lifetime ──────────────────────────────────────────
    const db = openDatabase(dbFile);
    initSchema(db);
    const dedup = new EventDedupCache();

    const events = [
      rawEvent({ txHash: "txA", eventName: "charged", ledger: 500, amount: 100 }),
      rawEvent({ txHash: "txA", eventName: "charged", ledger: 500, amount: 100 }), // exact duplicate
      rawEvent({ txHash: "txB", eventName: "subscribed", ledger: 500 }),
    ];

    const result1 = indexEvents(db, dedup, events);
    assertEqual(result1.written, 2, "two unique events written on first batch");
    assertEqual(result1.duplicatesSkipped, 1, "one duplicate skipped by in-memory cache");
    assertEqual(dedup.stats.deduplicatedTotal, 1, "dedup cache stats reflect the hit");

    // Same event arrives again in a later poll within the same process
    // (e.g. RPC returned overlapping ledger range) — layer 1 catches it.
    const result2 = indexEvents(db, dedup, [
      rawEvent({ txHash: "txA", eventName: "charged", ledger: 500, amount: 100 }),
    ]);
    assertEqual(result2.written, 0, "in-memory cache skips the repeat, no DB write");
    assertEqual(result2.duplicatesSkipped, 1, "counted as a duplicate");

    const rowCountAfterFirstLifetime = (
      db.prepare("SELECT COUNT(*) as n FROM events").get() as { n: number }
    ).n;
    assertEqual(rowCountAfterFirstLifetime, 2, "exactly 2 distinct rows in the DB");

    db.close();

    // ── Simulated restart: fresh process, fresh (cold) in-memory cache ──
    const dbAfterRestart = openDatabase(dbFile);
    initSchema(dbAfterRestart);
    const dedupAfterRestart = new EventDedupCache(); // cold — no memory of prior events

    // The same txA/charged/500 event is reprocessed (e.g. indexer resumed
    // from a ledger slightly before its stored cursor). The in-memory cache
    // has no record of it, but the DB's ON CONFLICT(id) must still prevent
    // a duplicate row — this is the "restart safety via SQLite meta ledger"
    // acceptance criterion.
    const result3 = indexEvents(dbAfterRestart, dedupAfterRestart, [
      rawEvent({ txHash: "txA", eventName: "charged", ledger: 500, amount: 100 }),
    ]);
    assertEqual(result3.written, 1, "cold cache treats it as new and re-upserts (UPDATE, not duplicate row)");
    assertEqual(result3.duplicatesSkipped, 0, "cold cache reports no in-memory duplicate");

    const rowCountAfterRestart = (
      dbAfterRestart.prepare("SELECT COUNT(*) as n FROM events").get() as { n: number }
    ).n;
    assertEqual(rowCountAfterRestart, 2, "row count unchanged — DB layer absorbed the repeat as an UPDATE");

    dbAfterRestart.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  OK");
}

// ── 4. Malformed events are dropped, not mistaken for duplicates ───────────

function testUnparsableEventsDoNotCountAsDuplicates(): void {
  console.log("Testing that unparsable events are dropped, not deduped...");

  const dir = mkdtempSync(join(tmpdir(), "payflow-dedup-test-"));
  const dbFile = join(dir, "events.db");

  try {
    const db = openDatabase(dbFile);
    initSchema(db);
    const dedup = new EventDedupCache();

    const result = indexEvents(db, dedup, [
      { topic: [] }, // no event name -> unparsable
      rawEvent({ txHash: "txC", eventName: "cancelled", ledger: 900 }),
    ]);

    assertEqual(result.unparsed, 1, "malformed event counted as unparsed");
    assertEqual(result.written, 1, "the valid event is still written");
    assertEqual(result.duplicatesSkipped, 0, "malformed event never reaches the dedup cache");
    assertEqual(parseEvent({ topic: [] }), null, "parseEvent itself returns null for malformed topic");

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  OK");
}

// ── 5. metrics-server counters track cumulative dedup stats ────────────────

async function testMetricsIntegration(): Promise<void> {
  console.log("Testing metrics-server dedup counters...");

  const dedup = new EventDedupCache(10, 0);
  dedup.checkAndRecord("tx1", "charged", 1);
  dedup.checkAndRecord("tx1", "charged", 1); // hit #1

  recordIndexerDedupStats(dedup.stats);

  dedup.checkAndRecord("tx1", "charged", 1); // hit #2
  recordIndexerDedupStats(dedup.stats);

  const text = await metricsText();
  assert(
    text.includes("indexer_duplicate_events_total 2"),
    "indexer_duplicate_events_total should reflect 2 cumulative hits",
  );
  assert(
    text.includes("indexer_dedup_cache_size 1"),
    "indexer_dedup_cache_size should reflect the current cache size",
  );

  console.log("  OK");
}

// ── createCacheKey sanity (used by log lines / debugging) ──────────────────

function testCreateCacheKey(): void {
  console.log("Testing createCacheKey format...");
  assertEqual(
    createCacheKey("txA", "charged", 500),
    "txA:charged:500",
    "cache key format is txHash:eventName:ledger",
  );
  console.log("  OK");
}

async function runTests(): Promise<void> {
  testDedupCacheCore();
  testCreateCacheKey();
  testLayeredDedup();
  testUnparsableEventsDoNotCountAsDuplicates();
  await testMetricsIntegration();
  console.log("All event-dedup integration tests passed!");
}

runTests().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
