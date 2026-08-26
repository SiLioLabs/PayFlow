#!/usr/bin/env tsx
/**
 * alert-failed-charges.ts
 *
 * Identifies users whose charge failed from the most recent batch_charge results
 * and sends a POST webhook notification with the list of failed users.
 *
 * Usage:
 *   WEBHOOK_URL=https://hooks.example.com/payflow tsx scripts/alert-failed-charges.ts [--db <path>] [--since <unix-ts>]
 *
 * Environment:
 *   WEBHOOK_URL   Required. Webhook URL to POST the alert payload to.
 *   INDEXER_DB    Optional. Path to the indexer SQLite DB (default: indexer.db).
 *
 * Expected DB table:
 *   events(event_name TEXT, data TEXT, timestamp INTEGER)
 *   - event_name 'charge_failed' with data { user, reason, amount }
 */

import { DatabaseSync } from "node:sqlite";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FailedChargeData {
  user?: string;
  reason?: string;
  amount?: number | string;
}

interface FailedChargeEntry {
  user_address: string;
  reason: string;
  subscription_amount: number;
}

interface AlertPayload {
  generated_at: string;
  total_failed: number;
  failed_charges: FailedChargeEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function safeParseData(raw: string): FailedChargeData {
  try {
    return JSON.parse(raw) as FailedChargeData;
  } catch {
    return {};
  }
}

async function sendWebhook(url: string, payload: AlertPayload): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(
        `Webhook responded with HTTP ${response.status}: ${response.statusText}`
      );
    } else {
      console.error(`Webhook delivered successfully (HTTP ${response.status})`);
    }
  } catch (err) {
    // Log failure but do not crash — callers rely on non-zero exit only for fatal errors
    console.error(`Webhook delivery failed: ${err}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("Error: WEBHOOK_URL environment variable is required.");
    process.exit(1);
  }

  const dbPath = getArg("--db") ?? process.env.INDEXER_DB ?? "indexer.db";
  const sinceArg = getArg("--since");
  const sinceTs = sinceArg ? parseInt(sinceArg, 10) : 0;

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (err) {
    console.error(`Failed to open database at ${dbPath}: ${err}`);
    process.exit(1);
  }

  const query = db.prepare(
    `SELECT data FROM events
     WHERE event_name = 'charge_failed'
       AND timestamp >= ?
     ORDER BY timestamp DESC`
  );

  const rows = query.all(sinceTs) as Array<{ data: string }>;

  const failedCharges: FailedChargeEntry[] = rows.map((row) => {
    const d = safeParseData(row.data);
    return {
      user_address: d.user ?? "unknown",
      reason: d.reason ?? "unknown",
      subscription_amount: Number(d.amount ?? 0),
    };
  });

  const payload: AlertPayload = {
    generated_at: new Date().toISOString(),
    total_failed: failedCharges.length,
    failed_charges: failedCharges,
  };

  if (failedCharges.length === 0) {
    console.error("No failed charges found. No webhook sent.");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
  await sendWebhook(webhookUrl, payload);
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
