/**
 * subscriber-churn-report.ts
 *
 * Queries cancelled events from the indexer SQLite DB, groups by day,
 * and outputs a JSON churn report with cancellation rate.
 *
 * Usage:
 *   node --experimental-sqlite scripts/subscriber-churn-report.ts \
 *     --db <path-to-indexer.db> [--out report.json]
 *
 * Expected tables:
 *   events(event_name TEXT, data TEXT, timestamp INTEGER)
 *   Optionally: daily_active_subscribers(date TEXT, active_count INTEGER)
 *   Falls back to total unique subscribers if daily active table is absent.
 */

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

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
    .prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { n: number };
  return row.n > 0;
}

function main() {
  const dbPath = getArg("--db");
  if (!dbPath) { console.error("--db <path> required"); process.exit(1); }

  const db = new DatabaseSync(dbPath, { open: true });

  // Cancelled events grouped by day
  const cancelRows = db
    .prepare("SELECT timestamp FROM events WHERE event_name = 'cancelled' ORDER BY timestamp ASC")
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
    // Fallback: use total subscriber count from events
    const totalRow = db
      .prepare("SELECT COUNT(DISTINCT json_extract(data, '$.user')) as n FROM events WHERE event_name = 'subscribed'")
      .get() as { n: number };
    const fallbackTotal = totalRow?.n ?? 0;
    // Populate all encountered days with the fallback
    for (const r of cancelRows) activeMap.set(toDateStr(r.timestamp), fallbackTotal);
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
    days.push({ date, cancellations: count, active_subscribers: active, churn_rate: rate });
  }

  const report: Report = {
    generated_at: new Date().toISOString(),
    db: dbPath,
    total_cancellations: total,
    days,
  };

  const out = getArg("--out");
  const json = JSON.stringify(report, null, 2);
  if (out) { writeFileSync(out, json); console.log(`Wrote report to ${out}`); }
  else process.stdout.write(json + "\n");
}

main();
