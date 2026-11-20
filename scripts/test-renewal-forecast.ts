#!/usr/bin/env tsx
/**
 * test-renewal-forecast.ts — Deterministic tests for renewal-forecast.ts
 *
 * Run:
 *   npx tsx scripts/test-renewal-forecast.ts
 *   # or
 *   cd scripts && npx tsx test-renewal-forecast.ts
 *
 * Exits 0 on all-pass, 1 on any failure.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateSnapshot,
  safeMean,
  safeStdDev,
  computeIntervals,
  confidenceLevel,
  forecastSubscription,
  forecastRenewals,
  buildSnapshotsFromEvents,
  type SubscriptionSnapshot,
  type ForecastEntry,
} from "./renewal-forecast.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Test infrastructure ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(`  ✗ ${msg}`);
    console.error(`  ✗ ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(`  ✗ ${detail}`);
    console.error(`  ✗ ${detail}`);
  }
}

function assertClose(
  actual: number,
  expected: number,
  tolerance: number,
  msg: string,
): void {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — expected ~${expected} ±${tolerance}, got ${actual}`;
    failures.push(`  ✗ ${detail}`);
    console.error(`  ✗ ${detail}`);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

function testSafeMean(): void {
  console.log("\n── testSafeMean ──");
  assertEqual(safeMean([]), 0, "empty array returns 0");
  assertEqual(safeMean([10]), 10, "single element");
  assertClose(safeMean([1, 2, 3, 4, 5]), 3, 0.001, "five elements");
  assertEqual(safeMean([NaN, 1, 2]), 1.5, "skips NaN");
  assertEqual(safeMean([Infinity, 1, 2]), 1.5, "skips Infinity");
  assertEqual(safeMean([1, -Infinity, 3]), 2, "skips -Infinity");
  assert(Number.isFinite(safeMean([1, 2, 3])), "result is finite");
}

function testSafeStdDev(): void {
  console.log("\n── testSafeStdDev ──");
  assertEqual(safeStdDev([]), 0, "empty → 0");
  assertEqual(safeStdDev([5]), 0, "single → 0");
  assertEqual(safeStdDev([NaN]), 0, "single NaN → 0");
  // Sample stddev of [2,4,4,4,5,5,7,9]: mean=5, var=32/7≈4.571, std≈2.138
  assertClose(safeStdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 0.01, "sample stddev");
  assert(Number.isFinite(safeStdDev([1, 2, 3])), "result is finite");
}

function testComputeIntervals(): void {
  console.log("\n── testComputeIntervals ──");
  assertEqual(computeIntervals([]).length, 0, "empty array returns empty (length 0)");
  assertEqual(computeIntervals([100]).length, 0, "single timestamp → empty");
  assertEqual(computeIntervals([100, 200, 400]).length, 2, "two gaps from three timestamps");
  assertEqual(computeIntervals([100, 200, 400])[0], 100, "first gap is 100");
  assertEqual(computeIntervals([100, 200, 400])[1], 200, "second gap is 200");
  // Duplicate timestamps produce zero gaps which are filtered
  assertEqual(computeIntervals([100, 100, 200]).length, 1, "duplicate gap filtered");
}

function testConfidenceLevel(): void {
  console.log("\n── testConfidenceLevel ──");
  assertEqual(confidenceLevel(0), "insufficient_data", "0 intervals → insufficient");
  assertEqual(confidenceLevel(1), "low", "1 interval → low");
  assertEqual(confidenceLevel(2), "medium", "2 intervals → medium");
  assertEqual(confidenceLevel(3), "high", "3 intervals → high");
  assertEqual(confidenceLevel(12), "high", "12 intervals → high");
}

function testValidateSnapshot(): void {
  console.log("\n── testValidateSnapshot ──");

  const valid: SubscriptionSnapshot = {
    user: "GABC123",
    amount: 1000000,
    interval: 2592000,
    last_charged: 1700000000,
    active: true,
    paused: false,
    charge_history: [1697408000],
  };
  assertEqual(validateSnapshot(valid), null, "valid snapshot passes");

  assert(validateSnapshot(null as any) !== null, "null fails");
  assert(validateSnapshot({} as any) !== null, "empty object fails");
  assert(
    validateSnapshot({ ...valid, user: "" }) !== null,
    "empty user fails",
  );
  assert(
    validateSnapshot({ ...valid, interval: -1 }) !== null,
    "negative interval fails",
  );
  assert(
    validateSnapshot({ ...valid, interval: NaN }) !== null,
    "NaN interval fails",
  );
  assert(
    validateSnapshot({ ...valid, interval: Infinity }) !== null,
    "Infinity interval fails",
  );
  assert(
    validateSnapshot({ ...valid, amount: NaN }) !== null,
    "NaN amount fails",
  );
  assert(
    validateSnapshot({ ...valid, last_charged: 0 }) !== null,
    "zero last_charged fails",
  );
  assert(
    validateSnapshot({ ...valid, charge_history: "bad" as any }) !== null,
    "non-array charge_history fails",
  );
  assert(
    validateSnapshot({
      ...valid,
      charge_history: [1, NaN, 3],
    }) !== null,
    "NaN in charge_history fails",
  );
}

function testBuildSnapshotsFromEvents(): void {
  console.log("\n── testBuildSnapshotsFromEvents ──");

  // Mirrors the real `events` table shape: charged/subscribed/cancelled rows.
  const rows = [
    { event_type: "subscribed", user: "GALICE", amount: 1000000, timestamp: 1697408000, data: null },
    { event_type: "charged", user: "GALICE", amount: 1000000, timestamp: 1697408000, data: null },
    { event_type: "charged", user: "GALICE", amount: 1000000, timestamp: 1700000000, data: null },
    { event_type: "subscribed", user: "GBOB", amount: 500000, timestamp: 1697408000, data: null },
    { event_type: "charged", user: "GBOB", amount: 500000, timestamp: 1697408000, data: null },
    { event_type: "cancelled", user: "GBOB", amount: 0, timestamp: 1699000000, data: null },
  ];

  const snapshots = buildSnapshotsFromEvents(rows as any);
  assertEqual(snapshots.length, 2, "two users → two snapshots");

  const alice = snapshots.find((s) => s.user === "GALICE")!;
  assert(alice !== undefined, "alice snapshot present");
  assertEqual(alice.amount, 1000000, "alice amount from charged event");
  assertEqual(alice.last_charged, 1700000000, "alice last_charged from latest charged");
  assertEqual(alice.active, true, "alice active (no cancel)");
  assertEqual(alice.paused, false, "alice not paused");
  assertEqual(alice.charge_history.length, 2, "alice charge history has two entries");

  const bob = snapshots.find((s) => s.user === "GBOB")!;
  assert(bob !== undefined, "bob snapshot present");
  assertEqual(bob.active, false, "bob inactive after cancelled event");
  assertEqual(bob.charge_history.length, 1, "bob charge history has one entry");

  // Snapshots must be valid inputs to the forecast pipeline.
  for (const snap of snapshots) {
    assertEqual(validateSnapshot(snap), null, `snapshot for ${snap.user} validates`);
  }
}

function testForecastSubscriptionPaused(): void {
  console.log("\n── testForecastSubscriptionPaused ──");
  const sub: SubscriptionSnapshot = {
    user: "GPAUSED",
    amount: 1000000,
    interval: 2592000,
    last_charged: 1700000000,
    active: true,
    paused: true,
    charge_history: [1697408000, 1700000000],
  };
  const result = forecastSubscription(sub);
  assertEqual(result.next_renewal, null, "paused → null next_renewal");
  assertEqual(result.confidence_band, null, "paused → null band");
  assertEqual(result.reason, "subscription_paused", "paused → correct reason");
  assert(Number.isFinite(result.next_renewal as any) || result.next_renewal === null, "no NaN in output");
}

function testForecastSubscriptionInactive(): void {
  console.log("\n── testForecastSubscriptionInactive ──");
  const sub: SubscriptionSnapshot = {
    user: "GINACTIVE",
    amount: 500000,
    interval: 604800,
    last_charged: 1700000000,
    active: false,
    paused: false,
    charge_history: [1697408000],
  };
  const result = forecastSubscription(sub);
  assertEqual(result.next_renewal, null, "inactive → null next_renewal");
  assertEqual(result.reason, "subscription_inactive", "inactive → correct reason");
}

function testForecastSubscriptionNoHistory(): void {
  console.log("\n── testForecastSubscriptionNoHistory ──");
  const sub: SubscriptionSnapshot = {
    user: "GNOHISTORY",
    amount: 750000,
    interval: 604800,
    last_charged: 1700000000,
    active: true,
    paused: false,
    charge_history: [],
  };
  const result = forecastSubscription(sub);
  assert(Number.isFinite(result.next_renewal!), "no-history result is finite (uses fallback interval)");
  assertEqual(result.confidence, "insufficient_data", "no-history → insufficient_data");
  assertEqual(result.reason, "no_charge_history_fallback_interval", "correct reason");
  assertEqual(result.confidence_band, null, "no band for insufficient data");
  // Should use last_charged + interval
  assertEqual(result.next_renewal, 1700000000 + 604800, "fallback uses configured interval");
}

function testForecastSubscriptionSingleCharge(): void {
  console.log("\n── testForecastSubscriptionSingleCharge ──");
  const sub: SubscriptionSnapshot = {
    user: "GSINGLE",
    amount: 1500000,
    interval: 2592000,
    last_charged: 1700000000,
    active: true,
    paused: false,
    charge_history: [1697408000],
  };
  const result = forecastSubscription(sub);
  // Single charge → 0 intervals → insufficient_data (correct: need at least 1 interval)
  assertEqual(result.confidence, "insufficient_data", "single charge → insufficient_data (0 intervals)");
  assert(result.next_renewal! > 0, "still uses fallback interval");
  assert(Number.isFinite(result.next_renewal!), "result is finite");
  assertEqual(result.reason, "no_charge_history_fallback_interval", "single charge → fallback reason");
}

function testForecastSubscriptionRegular(): void {
  console.log("\n── testForecastSubscriptionRegular ──");
  const sub: SubscriptionSnapshot = {
    user: "GREGULAR",
    amount: 1000000,
    interval: 2592000,
    last_charged: 1700000000,
    active: true,
    paused: false,
    charge_history: [1694816000, 1697408000, 1700000000],
  };
  const result = forecastSubscription(sub);
  assertEqual(result.confidence, "medium", "two intervals → medium confidence");
  assert(result.next_renewal !== null, "regular → non-null next_renewal");
  assert(Number.isFinite(result.next_renewal!), "regular → finite next_renewal");
  assert(result.confidence_band !== null, "regular → non-null band");
  assert(
    result.confidence_band!.low <= result.next_renewal! &&
      result.next_renewal! <= result.confidence_band!.high,
    "next_renewal within confidence band",
  );
}

function testForecastRenewals(): void {
  console.log("\n── testForecastRenewals ──");
  const subs: SubscriptionSnapshot[] = [
    {
      user: "GA",
      amount: 1000000,
      interval: 2592000,
      last_charged: 1700000000,
      active: true,
      paused: false,
      charge_history: [1694816000, 1697408000, 1700000000],
    },
    {
      user: "GB",
      amount: 500000,
      interval: 604800,
      last_charged: 1700000000,
      active: false,
      paused: false,
      charge_history: [1697408000],
    },
  ];
  const entries: ForecastEntry[] = forecastRenewals(subs);
  assertEqual(entries.length, 2, "one entry per subscription");
  const active = entries.find((e) => e.user === "GA")!;
  const inactive = entries.find((e) => e.user === "GB")!;
  assert(active.next_renewal !== null, "active entry has next_renewal");
  assertEqual(inactive.next_renewal, null, "inactive entry has null next_renewal");
}

function testNoSubscriptionsTableReference(): void {
  console.log("\n── testNoSubscriptionsTableReference ──");
  const src = readFileSync(resolve(__dirname, "renewal-forecast.ts"), "utf8");
  assert(
    !/\bFROM\s+subscriptions\b/i.test(src),
    "renewal-forecast.ts does not query a subscriptions table",
  );
  assert(
    /\bFROM\s+events\b/i.test(src),
    "renewal-forecast.ts queries the events table",
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("renewal-forecast.ts test suite");
  testSafeMean();
  testSafeStdDev();
  testComputeIntervals();
  testConfidenceLevel();
  testValidateSnapshot();
  testBuildSnapshotsFromEvents();
  testForecastSubscriptionPaused();
  testForecastSubscriptionInactive();
  testForecastSubscriptionNoHistory();
  testForecastSubscriptionSingleCharge();
  testForecastSubscriptionRegular();
  testForecastRenewals();
  testNoSubscriptionsTableReference();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  process.exit(0);
}

main();
