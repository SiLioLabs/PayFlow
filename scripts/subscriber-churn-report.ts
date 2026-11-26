/**
 * subscriber-churn-report.ts
 *
 * Queries cancelled events from the indexer SQLite DB, groups by day,
 * and outputs a JSON churn report with cancellation rate.
 *
 * NOTE: For a more advanced cohort-based monthly retention and merchant churn
 * analysis dashboard, please use the new script:
 *   npx ts-node scripts/churn-analysis.ts --format csv
 *
 * Usage:
 *   node --experimental-sqlite scripts/subscriber-churn-report.ts \
 *     --db <path-to-indexer.db> [--out report.json]
 *
 * Expected tables:
 *   events(event_name TEXT, address TEXT, raw_data TEXT, timestamp INTEGER)
 *   The subscriber is stored in the `address` column (see indexer.ts parseEvent),
 *   not inside `raw_data`.
 *
 * Active-subscriber denominator:
 *   If a `daily_active_subscribers(date TEXT, active_count INTEGER)` table exists
 *   it is used for per-day active counts. Nothing in the indexer creates that
 *   table, so in practice the report falls back to the total number of distinct
 *   subscribers seen in `subscribed` events (via the `address` column). This
 *   fallback is intentional and documented here: it yields a conservative,
 *   non-zero churn rate rather than a silently-zero one.
 */

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { logger } from "./logger";
import { fileURLToPath } from "node:url";

interface EventRow {
  timestamp: number;
}

interface DayChurn {
  date: string;
  cancellations: number;
  active_subscribers: number;
  churn_rate: string;
}

interface Report {
  generated_at: string;
  db: string;
  total_cancellations: number;
  days: DayChurn[];
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function toDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(name) as { n: number };
  return row.n > 0;
}

function main() {
  const dbPath = getArg("--db");
  if (!dbPath) {
    logger.error("--db <path> required");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath, { open: true });

  // Cancelled events grouped by day
  const cancelRows = db
    .prepare(
      "SELECT timestamp FROM events WHERE event_name = 'cancelled' ORDER BY timestamp ASC",
    )
    .all() as unknown as EventRow[];

  // Active subscriber counts per day (optional table)
  const hasActiveTable = tableExists(db, "daily_active_subscribers");
  const activeMap = new Map<string, number>();

  if (hasActiveTable) {
    const activeRows = db
      .prepare("SELECT date, active_count FROM daily_active_subscribers")
      .all() as { date: string; active_count: number }[];
    for (const r of activeRows) activeMap.set(r.date, r.active_count);
  } else {
    // Documented fallback: no daily_active_subscribers table exists (the indexer
    // never creates one), so use the total distinct subscribers from the
    // `address` column of `subscribed` events as the denominator.
    const totalRow = db
      .prepare(
        "SELECT COUNT(DISTINCT address) as n FROM events WHERE event_name = 'subscribed'",
      )
      .get() as { n: number };
    const fallbackTotal = totalRow?.n ?? 0;
    // Populate all encountered days with the fallback
    for (const r of cancelRows)
      activeMap.set(toDateStr(r.timestamp), fallbackTotal);
  }

  db.close();

  const byDay = new Map<string, number>();
  for (const row of cancelRows) {
    const date = toDateStr(row.timestamp);
    byDay.set(date, (byDay.get(date) ?? 0) + 1);
  }

  let total = 0;
  const days: DayChurn[] = [];
  for (const [date, count] of [...byDay.entries()].sort()) {
    total += count;
    const active = activeMap.get(date) ?? 0;
    const rate = active > 0 ? (count / active).toFixed(6) : "0.000000";
    days.push({
      date,
      cancellations: count,
      active_subscribers: active,
      churn_rate: rate,
    });
  }

  const report: Report = {
    generated_at: new Date().toISOString(),
    db: dbPath,
    total_cancellations: total,
    days,
  };

  const out = getArg("--out");
  const json = JSON.stringify(report, null, 2);
  if (out) {
    writeFileSync(out, json);
    logger.info(`Wrote report to ${out}`);
  } else process.stdout.write(json + "\n");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
