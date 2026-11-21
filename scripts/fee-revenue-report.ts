/**
 * fee-revenue-report.ts
 *
 * Queries charged events from the indexer SQLite DB and outputs daily/cumulative
 * fee revenue as JSON.
 *
 * Usage:
 *   node --experimental-sqlite scripts/fee-revenue-report.ts \
 *     --db <path-to-indexer.db> [--out report.json]
 *
 * Expected table: events(event_name TEXT, raw_data TEXT, timestamp INTEGER)
 * Charged event data JSON: { fee: "123", ... }
 */

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { logger } from "./logger";
import { fileURLToPath } from "node:url";

interface EventRow {
  raw_data: string;
  timestamp: number;
}

interface DayRevenue {
  date: string;
  fee_revenue: string;
  charge_count: number;
}

interface Report {
  generated_at: string;
  db: string;
  total_fee_revenue: string;
  days: DayRevenue[];
}

/**
 * Parsed shape of a `charged` event's raw_data payload.
 * Shared with renewal-forecast.ts so both scripts read the same fields.
 */
export interface ChargedEventData {
  user: string;
  amount: string;
  fee: string;
}

/**
 * Parse a `charged` event's raw_data JSON into a normalized shape.
 * Returns null for malformed rows so callers can skip them.
 */
export function parseChargedEvent(rawData: string): ChargedEventData | null {
  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    return {
      user: String(parsed.user ?? ""),
      amount: String(parsed.amount ?? "0"),
      fee: String(parsed.fee ?? "0"),
    };
  } catch {
    return null;
  }
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function toDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function main() {
  const dbPath = getArg("--db");
  if (!dbPath) {
    logger.error("--db <path> required");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath, { open: true });

  const rows = db
    .prepare(
      "SELECT raw_data, timestamp FROM events WHERE event_name = 'charged' ORDER BY timestamp ASC",
    )
    .all() as unknown as EventRow[];

  db.close();

  const byDay = new Map<string, { fee: bigint; count: number }>();

  for (const row of rows) {
    const parsed = parseChargedEvent(row.raw_data);
    let fee = 0n;
    if (parsed) {
      try {
        fee = BigInt(parsed.fee);
      } catch {
        /* skip malformed fee values */
      }
    }

    const date = toDateStr(row.timestamp);
    const entry = byDay.get(date) ?? { fee: 0n, count: 0 };
    entry.fee += fee;
    entry.count += 1;
    byDay.set(date, entry);
  }

  let cumulative = 0n;
  const days: DayRevenue[] = [];
  for (const [date, { fee, count }] of [...byDay.entries()].sort()) {
    cumulative += fee;
    days.push({ date, fee_revenue: fee.toString(), charge_count: count });
  }

  const report: Report = {
    generated_at: new Date().toISOString(),
    db: dbPath,
    total_fee_revenue: cumulative.toString(),
    days,
  };

  const out = getArg("--out");
  const json = JSON.stringify(report, null, 2);
  if (out) {
    writeFileSync(out, json);
    console.log(`Wrote report to ${out}`);
  } else process.stdout.write(json + "\n");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
