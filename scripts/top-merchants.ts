/**
 * top-merchants.ts
 *
 * Queries the indexer DB for all charged events, sums net revenue per merchant,
 * and outputs a sorted leaderboard (top 20 by default).
 *
 * Usage:
 *   node --experimental-sqlite scripts/top-merchants.ts \
 *     --db <path-to-indexer.db> [--limit N] [--out report.json]
 *
 * Expected table: events(event_name TEXT, data TEXT, timestamp INTEGER)
 * Charged event data JSON: { merchant: "G...", amount: "123", fee: "1", ... }
 */

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

interface EventRow {
  data: string;
}

interface MerchantEntry {
  rank: number;
  address: string;
  total_revenue: string;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function main() {
  const dbPath = getArg("--db");
  if (!dbPath) { console.error("--db <path> required"); process.exit(1); }

  const limitArg = getArg("--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : 20;
  if (isNaN(limit) || limit < 1) { console.error("--limit must be a positive integer"); process.exit(1); }

  const db = new DatabaseSync(dbPath, { open: true });
  const rows = db
    .prepare("SELECT data FROM events WHERE event_name = 'charged'")
    .all() as unknown as EventRow[];
  db.close();

  const revenue = new Map<string, bigint>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.data) as Record<string, unknown>;
      const merchant = String(parsed.merchant ?? "");
      if (!merchant) continue;
      const amount = BigInt(String(parsed.amount ?? "0"));
      const fee = BigInt(String(parsed.fee ?? "0"));
      revenue.set(merchant, (revenue.get(merchant) ?? 0n) + (amount - fee));
    } catch { /* skip malformed rows */ }
  }

  const leaderboard: MerchantEntry[] = [...revenue.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, limit)
    .map(([address, total], i) => ({ rank: i + 1, address, total_revenue: total.toString() }));

  const out = getArg("--out");
  const json = JSON.stringify(leaderboard, null, 2);
  if (out) { writeFileSync(out, json); console.log(`Wrote leaderboard to ${out}`); }
  else process.stdout.write(json + "\n");
}

main();
