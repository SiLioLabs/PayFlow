#!/usr/bin/env tsx
/**
 * test-audit-trail-reconcile.ts
 *
 * Fixture-driven tests for the audit-trail reconciliation feature.
 *
 * Uses an in-memory SQLite database (no file I/O needed) and the fixture at
 * scripts/fixtures/audit-trail-reconcile.json.  No network connection or
 * CONTRACT_ID env var required.
 *
 * Run:
 *   npx tsx scripts/test-audit-trail-reconcile.ts
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateExportByDay,
  aggregateIndexerByDay,
  reconcileAggregates,
  type DayAggregate,
  type DayReconcileResult,
  type ReconcileReport,
} from "./audit-trail.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`);
    console.error(`         expected: ${JSON.stringify(expected)}`);
    console.error(`         actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

interface IndexerRow {
  id: string;
  event_name: string;
  address: string;
  amount: string | null;
  fee_amount: string | null;
  ledger: number;
  timestamp: number;
  tx_hash: string;
  merchant: string | null;
  raw_data: string;
  _note?: string;
}

/**
 * Build an in-memory SQLite database with the indexer schema and seed it with
 * the provided rows.  The schema mirrors the one in indexer.ts so
 * aggregateIndexerByDay() can query it without modification.
 */
function buildInMemoryDb(rows: IndexerRow[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          TEXT    PRIMARY KEY,
      event_name  TEXT    NOT NULL,
      address     TEXT    NOT NULL,
      amount      TEXT,
      ledger      INTEGER NOT NULL,
      timestamp   INTEGER NOT NULL,
      tx_hash     TEXT    NOT NULL,
      raw_data    TEXT    NOT NULL,
      merchant    TEXT,
      fee_amount  TEXT,
      token       TEXT,
      result_code TEXT
    )
  `);

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, event_name, address, amount, ledger, timestamp, tx_hash, raw_data, merchant, fee_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    // Skip metadata comment rows
    if (row._note) continue;
    stmt.run(
      row.id,
      row.event_name,
      row.address,
      row.amount ?? null,
      row.ledger,
      row.timestamp,
      row.tx_hash,
      row.raw_data,
      row.merchant ?? null,
      row.fee_amount ?? null,
    );
  }

  return db;
}

// ── Load fixture ──────────────────────────────────────────────────────────────

interface Fixture {
  matching_export_entries: Record<string, unknown>[];
  matching_indexer_rows: IndexerRow[];
  mismatch_export_entries: Record<string, unknown>[];
  mismatch_indexer_rows: IndexerRow[];
  expected_results: {
    matching_scenario: {
      overall_matched: boolean;
      days_checked: number;
      days_mismatched: number;
    };
    mismatch_scenario: {
      overall_matched: boolean;
      days_checked: number;
      days_mismatched: number;
    };
  };
}

const fixturePath = resolve(__dirname, "fixtures", "audit-trail-reconcile.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

// ── Tests ─────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Suite 1: aggregateExportByDay — unit tests on the export aggregation logic
// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Suite 1: aggregateExportByDay ===");

{
  const map = aggregateExportByDay(fixture.matching_export_entries as Parameters<typeof aggregateExportByDay>[0]);

  // Two charged events on 2026-03-01 → 10_000_000 + 5_000_000 = 15_000_000 vol
  const day1 = map.get("2026-03-01");
  assert(day1 !== undefined, "2026-03-01 day key exists");
  assertEqual(day1?.charge_count, 2, "2026-03-01 charge_count = 2");
  assertEqual(day1?.volume_stroops, "15000000", "2026-03-01 volume = 15_000_000");
  assertEqual(day1?.fees_stroops, "150000", "2026-03-01 fees = 150_000");

  // One pay_per_use on 2026-03-02 (subscribed event is excluded)
  const day2 = map.get("2026-03-02");
  assert(day2 !== undefined, "2026-03-02 day key exists");
  assertEqual(day2?.charge_count, 1, "2026-03-02 charge_count = 1 (subscribed excluded)");
  assertEqual(day2?.volume_stroops, "2000000", "2026-03-02 volume = 2_000_000");
  assertEqual(day2?.fees_stroops, "20000", "2026-03-02 fees = 20_000");

  // No other days
  assertEqual(map.size, 2, "matching export produces exactly 2 day buckets");
}

{
  // Empty input produces empty map
  const emptyMap = aggregateExportByDay([]);
  assertEqual(emptyMap.size, 0, "empty entries produce empty map");
}

{
  // All non-billing events (only subscribed/cancelled) → no day buckets
  const nonBillingEntries = fixture.matching_export_entries.filter(
    (e) => (e as { event_type: string }).event_type === "subscribed",
  );
  const nonBillingMap = aggregateExportByDay(nonBillingEntries as Parameters<typeof aggregateExportByDay>[0]);
  assertEqual(nonBillingMap.size, 0, "subscribed-only entries produce no day buckets");
}

// ────────────────────────────────────────────────────────────────────────────
// Suite 2: aggregateIndexerByDay — unit tests on the DB query layer
// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Suite 2: aggregateIndexerByDay ===");

{
  const db = buildInMemoryDb(fixture.matching_indexer_rows);
  const map = aggregateIndexerByDay(db);
  db.close();

  // The indexer has: 2 charged rows on 2026-03-01 (timestamps 1740826800 + 1740841200)
  // and 1 pay_per_use on 2026-03-02 (timestamp 1740909600).
  // subscribed row should be ignored.
  const day1 = map.get("2026-03-01");
  assert(day1 !== undefined, "indexer: 2026-03-01 key exists");
  assertEqual(day1?.charge_count, 2, "indexer: 2026-03-01 charge_count = 2");
  assertEqual(day1?.volume_stroops, "15000000", "indexer: 2026-03-01 volume = 15_000_000");
  assertEqual(day1?.fees_stroops, "150000", "indexer: 2026-03-01 fees = 150_000");

  const day2 = map.get("2026-03-02");
  assert(day2 !== undefined, "indexer: 2026-03-02 key exists");
  assertEqual(day2?.charge_count, 1, "indexer: 2026-03-02 charge_count = 1 (subscribed excluded)");
  assertEqual(day2?.volume_stroops, "2000000", "indexer: 2026-03-02 volume = 2_000_000");
  assertEqual(day2?.fees_stroops, "20000", "indexer: 2026-03-02 fees = 20_000");

  assertEqual(map.size, 2, "indexer matching scenario produces exactly 2 day buckets");
}

{
  // Empty DB → empty map
  const emptyDb = buildInMemoryDb([]);
  const emptyMap = aggregateIndexerByDay(emptyDb);
  emptyDb.close();
  assertEqual(emptyMap.size, 0, "empty DB produces empty indexer map");
}

// ────────────────────────────────────────────────────────────────────────────
// Suite 3: reconcileAggregates — full pipeline, matching scenario
// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Suite 3: reconcileAggregates — matching scenario ===");

{
  const exportEntries = fixture.matching_export_entries as Parameters<typeof aggregateExportByDay>[0];
  const db = buildInMemoryDb(fixture.matching_indexer_rows);

  const exportByDay = aggregateExportByDay(exportEntries);
  const indexerByDay = aggregateIndexerByDay(db);
  db.close();

  const report: ReconcileReport = reconcileAggregates(
    exportByDay,
    indexerByDay,
    "test-export.json",
    ":memory:",
  );

  const exp = fixture.expected_results.matching_scenario;

  assert(report.overall_matched === exp.overall_matched, "matching: overall_matched = true");
  assertEqual(report.days_checked, exp.days_checked, "matching: days_checked = 2");
  assertEqual(report.days_mismatched, exp.days_mismatched, "matching: days_mismatched = 0");
  assertEqual(report.results.length, 2, "matching: results array length = 2");

  const r1 = report.results.find((r) => r.date === "2026-03-01") as DayReconcileResult;
  assert(r1 !== undefined, "matching: result for 2026-03-01 exists");
  assert(r1.matched, "matching: 2026-03-01 matched = true");
  assertEqual(r1.diffs.length, 0, "matching: 2026-03-01 diffs is empty");

  const r2 = report.results.find((r) => r.date === "2026-03-02") as DayReconcileResult;
  assert(r2 !== undefined, "matching: result for 2026-03-02 exists");
  assert(r2.matched, "matching: 2026-03-02 matched = true");
  assertEqual(r2.diffs.length, 0, "matching: 2026-03-02 diffs is empty");

  // Verify that the export and indexer sub-objects are populated correctly
  assertEqual(r1.export.charge_count, 2, "matching: r1.export.charge_count = 2");
  assertEqual(r1.indexer.charge_count, 2, "matching: r1.indexer.charge_count = 2");
  assertEqual(r1.export.volume_stroops, r1.indexer.volume_stroops, "matching: r1 volumes agree");
  assertEqual(r1.export.fees_stroops, r1.indexer.fees_stroops, "matching: r1 fees agree");
}

// ────────────────────────────────────────────────────────────────────────────
// Suite 4: reconcileAggregates — mismatch scenario
// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Suite 4: reconcileAggregates — mismatch scenario ===");

{
  const exportEntries = fixture.mismatch_export_entries as Parameters<typeof aggregateExportByDay>[0];
  const db = buildInMemoryDb(fixture.mismatch_indexer_rows);

  const exportByDay = aggregateExportByDay(exportEntries);
  const indexerByDay = aggregateIndexerByDay(db);
  db.close();

  const report: ReconcileReport = reconcileAggregates(
    exportByDay,
    indexerByDay,
    "test-export-mismatch.json",
    ":memory:",
  );

  const exp = fixture.expected_results.mismatch_scenario;

  assert(!report.overall_matched, "mismatch: overall_matched = false");
  assertEqual(report.days_checked, exp.days_checked, "mismatch: days_checked = 2");
  assertEqual(report.days_mismatched, exp.days_mismatched, "mismatch: days_mismatched = 1");

  const r1 = report.results.find((r) => r.date === "2026-04-10") as DayReconcileResult;
  assert(r1 !== undefined, "mismatch: result for 2026-04-10 exists");
  assert(!r1.matched, "mismatch: 2026-04-10 matched = false");
  // Export has 2 events; indexer only has 1 (txhash006 missing)
  assertEqual(r1.export.charge_count, 2, "mismatch: 2026-04-10 export.charge_count = 2");
  assertEqual(r1.indexer.charge_count, 1, "mismatch: 2026-04-10 indexer.charge_count = 1");
  assertEqual(r1.export.volume_stroops, "27000000", "mismatch: 2026-04-10 export volume = 27_000_000");
  assertEqual(r1.indexer.volume_stroops, "20000000", "mismatch: 2026-04-10 indexer volume = 20_000_000");
  assertEqual(r1.export.fees_stroops, "270000", "mismatch: 2026-04-10 export fees = 270_000");
  assertEqual(r1.indexer.fees_stroops, "200000", "mismatch: 2026-04-10 indexer fees = 200_000");
  assert(r1.diffs.length === 3, "mismatch: 2026-04-10 has 3 diffs (count, volume, fees)");
  assert(
    r1.diffs.some((d) => d.includes("charge_count")),
    "mismatch: diffs include charge_count discrepancy",
  );
  assert(
    r1.diffs.some((d) => d.includes("volume_stroops")),
    "mismatch: diffs include volume_stroops discrepancy",
  );
  assert(
    r1.diffs.some((d) => d.includes("fees_stroops")),
    "mismatch: diffs include fees_stroops discrepancy",
  );

  const r2 = report.results.find((r) => r.date === "2026-04-11") as DayReconcileResult;
  assert(r2 !== undefined, "mismatch: result for 2026-04-11 exists");
  assert(r2.matched, "mismatch: 2026-04-11 matched = true (no gap on this day)");
  assertEqual(r2.diffs.length, 0, "mismatch: 2026-04-11 diffs is empty");
}

// ────────────────────────────────────────────────────────────────────────────
// Suite 5: edge cases
// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Suite 5: edge cases ===");

{
  // Day present only in export (not in indexer) → mismatch
  const exportByDay = new Map<string, DayAggregate>([
    [
      "2026-05-01",
      { date: "2026-05-01", charge_count: 1, volume_stroops: "5000000", fees_stroops: "50000" },
    ],
  ]);
  const indexerByDay = new Map<string, DayAggregate>();

  const report = reconcileAggregates(exportByDay, indexerByDay, "x.json", ":memory:");
  assert(!report.overall_matched, "export-only day: overall_matched = false");
  assertEqual(report.days_mismatched, 1, "export-only day: days_mismatched = 1");
  const r = report.results[0] as DayReconcileResult;
  assert(!r.matched, "export-only day: result not matched");
  assertEqual(r.indexer.charge_count, 0, "export-only day: indexer shows zeros");
  assertEqual(r.indexer.volume_stroops, "0", "export-only day: indexer volume = 0");
}

{
  // Day present only in indexer (not in export) → mismatch
  const exportByDay = new Map<string, DayAggregate>();
  const indexerByDay = new Map<string, DayAggregate>([
    [
      "2026-05-02",
      { date: "2026-05-02", charge_count: 2, volume_stroops: "8000000", fees_stroops: "80000" },
    ],
  ]);

  const report = reconcileAggregates(exportByDay, indexerByDay, "x.json", ":memory:");
  assert(!report.overall_matched, "indexer-only day: overall_matched = false");
  assertEqual(report.days_mismatched, 1, "indexer-only day: days_mismatched = 1");
  const r = report.results[0] as DayReconcileResult;
  assert(!r.matched, "indexer-only day: result not matched");
  assertEqual(r.export.charge_count, 0, "indexer-only day: export shows zeros");
  assertEqual(r.export.volume_stroops, "0", "indexer-only day: export volume = 0");
}

{
  // Both empty → all-clear, zero days
  const report = reconcileAggregates(
    new Map(),
    new Map(),
    "empty.json",
    ":memory:",
  );
  assert(report.overall_matched, "both-empty: overall_matched = true");
  assertEqual(report.days_checked, 0, "both-empty: days_checked = 0");
  assertEqual(report.days_mismatched, 0, "both-empty: days_mismatched = 0");
  assertEqual(report.results.length, 0, "both-empty: results array is empty");
}

{
  // Multiple days, only one mismatched → correct count
  const exportByDay = new Map<string, DayAggregate>([
    ["2026-06-01", { date: "2026-06-01", charge_count: 1, volume_stroops: "1000000", fees_stroops: "10000" }],
    ["2026-06-02", { date: "2026-06-02", charge_count: 2, volume_stroops: "2000000", fees_stroops: "20000" }],
    ["2026-06-03", { date: "2026-06-03", charge_count: 3, volume_stroops: "3000000", fees_stroops: "30000" }],
  ]);
  // Day 2 has a volume mismatch
  const indexerByDay = new Map<string, DayAggregate>([
    ["2026-06-01", { date: "2026-06-01", charge_count: 1, volume_stroops: "1000000", fees_stroops: "10000" }],
    ["2026-06-02", { date: "2026-06-02", charge_count: 2, volume_stroops: "1999999", fees_stroops: "20000" }],
    ["2026-06-03", { date: "2026-06-03", charge_count: 3, volume_stroops: "3000000", fees_stroops: "30000" }],
  ]);
  const report = reconcileAggregates(exportByDay, indexerByDay, "x.json", ":memory:");
  assert(!report.overall_matched, "multi-day partial: overall_matched = false");
  assertEqual(report.days_checked, 3, "multi-day partial: days_checked = 3");
  assertEqual(report.days_mismatched, 1, "multi-day partial: days_mismatched = 1");
  const mismatchedDay = report.results.find((r) => r.date === "2026-06-02") as DayReconcileResult;
  assert(!mismatchedDay.matched, "multi-day partial: 2026-06-02 not matched");
  assert(
    mismatchedDay.diffs.some((d) => d.includes("volume_stroops")),
    "multi-day partial: volume_stroops diff reported",
  );
}

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All reconciliation tests passed ✓");
  process.exit(0);
}
