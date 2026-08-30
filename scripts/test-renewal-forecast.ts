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
  assert(result.next_renewal! > 0, "result is positive");
  assert(result.confidence_band === null, "no band for insufficient data");
}

function testForecastSubscriptionRegular(): void {
  console.log("\n── testForecastSubscriptionRegular ──");
  // 3 charges 30 days apart = regular monthly
  const sub: SubscriptionSnapshot = {
    user: "GREGULAR",
    amount: 1000000,
    interval: 2592000,
    last_charged: 1700000000,
    active: true,
    paused: false,
    charge_history: [
      1697408000,
      1699996000,
      1700000000,
    ],
  };
  const result = forecastSubscription(sub);
  // 3 charges → 2 intervals → medium confidence
  assertEqual(result.confidence, "medium", "3 charges → medium confidence (2 intervals)");
  assert(Number.isFinite(result.next_renewal!), "result is finite");
  assert(result.confidence_band !== null, "confidence band exists");
  assert(
    result.confidence_band!.low < result.next_renewal!,
    "band low < predicted",
  );
  assert(
    result.confidence_band!.high > result.next_renewal!,
    "band high > predicted",
  );
  // Verify no NaN anywhere in the output
  assert(Number.isFinite(result.next_renewal!), "next_renewal is finite");
  assert(Number.isFinite(result.confidence_band!.low), "band low is finite");
  assert(Number.isFinite(result.confidence_band!.high), "band high is finite");
}

function testNoNaNInOutput(): void {
  console.log("\n── testNoNaNInOutput ──");
  // Load the fixture file and run the full forecast pipeline
  const fixturePath = resolve(__dirname, "fixtures", "renewal-forecast.json");
  const raw = readFileSync(fixturePath, "utf-8");
  const snapshots: SubscriptionSnapshot[] = JSON.parse(raw);

  const report = forecastRenewals(snapshots);

  for (const f of report.forecasts) {
    if (f.next_renewal !== null) {
      assert(
        Number.isFinite(f.next_renewal),
        `${f.user}: next_renewal is finite (got ${f.next_renewal})`,
      );
    }
    if (f.confidence_band) {
      assert(
        Number.isFinite(f.confidence_band.low),
        `${f.user}: band low is finite`,
      );
      assert(
        Number.isFinite(f.confidence_band.high),
        `${f.user}: band high is finite`,
      );
      assert(
        f.confidence_band.low <= f.confidence_band.high,
        `${f.user}: band low <= band high`,
      );
    }
  }
}

function testInsufficientDataFlagged(): void {
  console.log("\n── testInsufficientDataFlagged ──");
  const fixturePath = resolve(__dirname, "fixtures", "renewal-forecast.json");
  const raw = readFileSync(fixturePath, "utf-8");
  const snapshots: SubscriptionSnapshot[] = JSON.parse(raw);
  const report = forecastRenewals(snapshots);

  // The fixture has known scenarios: empty user, zero interval, negative amount,
  // empty history — these should all be flagged as insufficient_data or validation_error
  const insufficientOrInvalid = report.forecasts.filter(
    (f) =>
      f.confidence === "insufficient_data" ||
      f.reason?.startsWith("validation_error"),
  );

  assert(
    insufficientOrInvalid.length >= 4,
    `At least 4 entries flagged as insufficient/invalid (got ${insufficientOrInvalid.length})`,
  );

  // Paused subscriber should be counted
  assertEqual(report.paused, 1, "one paused subscriber");

  // Inactive subscriber should be counted
  assertEqual(report.inactive, 1, "one inactive subscriber");
}

function testDuplicateTimestamps(): void {
  console.log("\n── testDuplicateTimestamps ──");
  const sub: SubscriptionSnapshot = {
    user: "GDUPLICATES",
    amount: 1000000,
    interval: 2592000,
    last_charged: 1700000000,
    active: true,
    paused: false,
    // All identical — produces no positive gaps
    charge_history: [1697408000, 1697408000, 1697408000],
  };
  const result = forecastSubscription(sub);
  // With no valid gaps, confidence should be insufficient_data
  // but it should still fall back to using interval + last_charged
  assert(Number.isFinite(result.next_renewal!), "duplicate timestamps still produce finite output");
  assert(result.next_renewal! > 0, "result is positive");
  // No NaN
  assert(!isNaN(result.next_renewal!), "no NaN in next_renewal");
}

function testFixtureRunsEndToEnd(): void {
  console.log("\n── testFixtureRunsEndToEnd ──");
  const fixturePath = resolve(__dirname, "fixtures", "renewal-forecast.json");
  const raw = readFileSync(fixturePath, "utf-8");
  const snapshots: SubscriptionSnapshot[] = JSON.parse(raw);
  const report = forecastRenewals(snapshots);

  assertEqual(report.total, snapshots.length, "total matches input count");
  assert(report.generated_at.length > 0, "generated_at is populated");

  // Check that the healthy regular subscriber has a forecast
  const healthy = report.forecasts.find(
    (f) => f.user === "GAAA1111111111111111111111111111111111111111111111111111111",
  );
  assert(healthy !== undefined, "healthy subscriber found in forecasts");
  assert(healthy!.next_renewal !== null, "healthy subscriber has forecast");
  // 3 charges → 2 intervals → medium confidence
  assertEqual(healthy!.confidence, "medium", "healthy subscriber has medium confidence (2 intervals)");

  // Check paused subscriber
  const paused = report.forecasts.find(
    (f) => f.user === "GBBB2222222222222222222222222222222222222222222222222222222",
  );
  assert(paused !== undefined, "paused subscriber found");
  assertEqual(paused!.next_renewal, null, "paused subscriber has no forecast");
  assertEqual(paused!.reason, "subscription_paused", "paused reason correct");

  // Check inactive subscriber
  const inactive = report.forecasts.find(
    (f) => f.user === "GCCC3333333333333333333333333333333333333333333333333333333",
  );
  assert(inactive !== undefined, "inactive subscriber found");
  assertEqual(inactive!.next_renewal, null, "inactive subscriber has no forecast");

  // Check validation errors
  const negativeAmount = report.forecasts.find(
    (f) => f.user === "GGGG7777777777777777777777777777777777777777777777777777777",
  );
  assert(negativeAmount !== undefined, "negative amount subscriber found");
  assertEqual(negativeAmount!.next_renewal, null, "negative amount → null forecast");
  assert(
    negativeAmount!.reason?.startsWith("validation_error"),
    `negative amount → validation_error (got reason: ${negativeAmount!.reason})`,
  );
}

// ── Run all tests ────────────────────────────────────────────────────────────

function main(): void {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  renewal-forecast.ts test suite");
  console.log("═══════════════════════════════════════════════════════════════");

  testSafeMean();
  testSafeStdDev();
  testComputeIntervals();
  testConfidenceLevel();
  testValidateSnapshot();
  testForecastSubscriptionPaused();
  testForecastSubscriptionInactive();
  testForecastSubscriptionNoHistory();
  testForecastSubscriptionSingleCharge();
  testForecastSubscriptionRegular();
  testNoNaNInOutput();
  testInsufficientDataFlagged();
  testDuplicateTimestamps();
  testFixtureRunsEndToEnd();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(f);
    }
    process.exit(1);
  }

  console.log("\n  All tests passed ✓");
  process.exit(0);
}

main();
