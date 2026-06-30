#!/usr/bin/env tsx
/**
 * daily-revenue-summary.ts
 *
 * Queries the indexer DB for the previous calendar day's (UTC) events and
 * outputs a structured JSON revenue summary to stdout.
 *
 * Usage:
 *   tsx scripts/daily-revenue-summary.ts [--date YYYY-MM-DD] [--db <path>]
 *
 * Expected DB tables:
 *   events(event_name TEXT, data TEXT, timestamp INTEGER)
 *   - event_name 'charged'      → data includes { amount, merchant, user }
 *   - event_name 'subscribed'   → new subscriber
 *   - event_name 'cancelled'    → cancellation
 *   - event_name 'fee_collected'→ data includes { amount }
 */

import { DatabaseSync } from "node:sqlite";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChargeData {
  amount?: number | string;
  fee?: number | string;
  merchant?: string;
  user?: string;
}

interface DailyRevenueSummary {
  date: string;
  generated_at: string;
  total_charges: number;
  total_amount: number;
  total_fees_collected: number;
  new_subscriptions: number;
  cancellations: number;
  net_merchant_revenue: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function utcDayBounds(dateStr: string): { startMs: number; endMs: number } {
  const startMs = new Date(`${dateStr}T00:00:00Z`).getTime();
  const endMs = startMs + 86_400_000;
  return { startMs, endMs };
}

function previousUtcDay(): string {
  const now = new Date();
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  );
  return yesterday.toISOString().slice(0, 10);
}

function safeParseData(raw: string): ChargeData {
  try {
    return JSON.parse(raw) as ChargeData;
  } catch {
    return {};
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const dbPath = getArg("--db") ?? process.env.INDEXER_DB ?? "indexer.db";
  const dateArg = getArg("--date");
  const targetDate = dateArg ?? previousUtcDay();

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error(`Invalid date format: ${targetDate}. Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  const { startMs, endMs } = utcDayBounds(targetDate);
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (err) {
    console.error(`Failed to open database at ${dbPath}: ${err}`);
    process.exit(1);
  }

  const query = db.prepare(
    `SELECT event_name, data FROM events
     WHERE timestamp >= ? AND timestamp < ?`
  );

  const rows = query.all(startSec, endSec) as Array<{
    event_name: string;
    data: string;
  }>;

  let totalCharges = 0;
  let totalAmount = 0;
  let totalFees = 0;
  let newSubscriptions = 0;
  let cancellations = 0;

  for (const row of rows) {
    switch (row.event_name) {
      case "charged": {
        const d = safeParseData(row.data);
        totalCharges += 1;
        totalAmount += Number(d.amount ?? 0);
        totalFees += Number(d.fee ?? 0);
        break;
      }
      case "fee_collected": {
        const d = safeParseData(row.data);
        totalFees += Number(d.amount ?? 0);
        break;
      }
      case "subscribed":
        newSubscriptions += 1;
        break;
      case "cancelled":
        cancellations += 1;
        break;
    }
  }

  const summary: DailyRevenueSummary = {
    date: targetDate,
    generated_at: new Date().toISOString(),
    total_charges: totalCharges,
    total_amount: totalAmount,
    total_fees_collected: totalFees,
    new_subscriptions: newSubscriptions,
    cancellations: cancellations,
    net_merchant_revenue: totalAmount - totalFees,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
