#!/usr/bin/env tsx
/**
 * alert-failed-charges.ts
 *
 * Identifies charges that failed due to insufficient allowance from batch_charge events
 * and sends a POST webhook notification with the list of failed users.
 *
 * The indexer captures contract events including `batch_charge_skips`, which aggregates
 * outcomes per batch. When `allowance_insufficient > 0`, it indicates subscriptions
 * that were ready to charge but the subscriber's allowance was insufficient.
 *
 * Usage:
 *   WEBHOOK_URL=https://hooks.example.com/payflow tsx scripts/alert-failed-charges.ts [--db <path>] [--since <unix-ts>]
 *
 * Environment:
 *   WEBHOOK_URL   Required. Webhook URL to POST the alert payload to.
 *   INDEXER_DB    Optional. Path to the indexer SQLite DB (default: data/events.db).
 *
 * Queries:
 *   - Looks for events.event_name = 'batch_charge_skips' with raw_data.allowance_insufficient > 0
 *   - Extracts the user address from the raw event data
 *   - Groups failures by reason (insufficient allowance)
 *
 * Alert payload structure:
 *   {
 *     generated_at: ISO timestamp,
 *     total_failed: number,
 *     failed_charges: [
 *       { user_address, reason: 'allowance_insufficient', subscription_amount, failed_count? }
 *     ]
 *   }
 *
 * subscription_amount
 *   The user's current subscription amount in stroops (string, since amounts
 *   are i128), taken from the latest `subscribed` / `sub_amount_updated` event
 *   for that user in the indexer DB and cached for the run. It is `null` when
 *   the amount is unknown — notably for `batch_summary` entries: the contract's
 *   `batch_charge_skips` event only carries counters, not user addresses, so
 *   those entries report `failed_count` instead of a per-user amount.
 */

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { fetchWithTimeout } from "./utils/fetchWithTimeout.js";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FailedChargeData {
  user?: string;
  reason?: string;
  amount?: number | string;
  /** `batch_charge_skips` map key; present when the row is a summary event. */
  allowance_insufficient?: number;
}

export interface FailedChargeEntry {
  user_address: string;
  reason: string;
  /** Current subscription amount in stroops, or null when unknown. */
  subscription_amount: string | null;
  /** Number of failed charges an aggregate `batch_summary` entry stands for. */
  failed_count?: number;
}

export interface AlertPayload {
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
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      logger.error("Webhook responded with non-OK status", {
        status: response.status,
        status_text: response.statusText,
      });
      logger.error(
        `Webhook responded with HTTP ${response.status}: ${response.statusText}`,
      );
    } else {
      logger.info("Webhook delivered successfully", { status: response.status });
    }
  } catch (err) {
    // Log failure but do not crash — callers rely on non-zero exit only for fatal errors
    logger.error("Webhook delivery failed", { error: String(err) });
  }
}

/**
 * Resolves a user's current subscription amount from indexed events, caching
 * each lookup for the lifetime of the instance (one alert run).
 */
export class SubscriptionAmountLookup {
  private readonly cache = new Map<string, string | null>();
  private readonly stmt;

  constructor(db: InstanceType<typeof DatabaseSync>) {
    this.stmt = db.prepare(
      `SELECT event_name, amount, raw_data FROM events
       WHERE address = ? AND event_name IN ('subscribed', 'sub_amount_updated')
       ORDER BY ledger DESC, id DESC
       LIMIT 1`,
    );
  }

  get(user: string): string | null {
    if (this.cache.has(user)) return this.cache.get(user)!;
    const row = this.stmt.get(user) as
      | { event_name: string; amount: string | null; raw_data: string }
      | undefined;
    const amount = row ? amountFromRow(row) : null;
    this.cache.set(user, amount);
    return amount;
  }
}

function amountFromRow(row: { event_name: string; amount: string | null; raw_data: string }): string | null {
  if (row.event_name === "sub_amount_updated") {
    // Event value is the tuple (old_amount, new_amount).
    try {
      const value = JSON.parse(row.raw_data) as unknown;
      if (Array.isArray(value) && value.length === 2 && value[1] != null) return String(value[1]);
    } catch {
      // fall through to the amount column
    }
  }
  return row.amount ?? null;
}

/** Read failed charges since `sinceTs` from the indexer DB. */
export function collectFailedCharges(
  db: InstanceType<typeof DatabaseSync>,
  sinceTs: number,
): FailedChargeEntry[] {
  const rows = db
    .prepare(
      `SELECT raw_data FROM events
       WHERE event_name = 'batch_charge_skips'
         AND timestamp >= ?
       ORDER BY timestamp DESC`,
    )
    .all(sinceTs) as Array<{ raw_data: string }>;

  const amounts = new SubscriptionAmountLookup(db);
  const failedCharges: FailedChargeEntry[] = [];
  for (const row of rows) {
    const d = safeParseData(row.raw_data);
    const reason = d.reason ?? "allowance_insufficient";
    if (d.user) {
      // Per-user failure row: report that user's real subscription amount.
      failedCharges.push({
        user_address: d.user,
        reason,
        subscription_amount: amounts.get(d.user) ?? (d.amount != null ? String(d.amount) : null),
      });
    } else if (d.allowance_insufficient && d.allowance_insufficient > 0) {
      // Aggregate summary: the event carries no addresses, so no per-user amount.
      failedCharges.push({
        user_address: "batch_summary",
        reason,
        subscription_amount: null,
        failed_count: d.allowance_insufficient,
      });
    }
  }
  return failedCharges;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    // console.error is intentional here — this is a fatal pre-init config error.
    console.error("Error: WEBHOOK_URL environment variable is required.");
    process.exit(1);
  }

  const dbPath = getArg("--db") ?? process.env.INDEXER_DB ?? "indexer.db";
  const sinceArg = getArg("--since");
  const sinceTs = sinceArg ? parseInt(sinceArg, 10) : 0;

  // Child logger with required context fields.
  const log = logger.child({ script: "alert-failed-charges", db: dbPath });

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (err) {
    log.error("Failed to open database", { db: dbPath, error: String(err) });
    process.exit(1);
  }

  const failedCharges = collectFailedCharges(db, sinceTs);

  const payload: AlertPayload = {
    generated_at: new Date().toISOString(),
    total_failed: failedCharges.length,
    failed_charges: failedCharges,
  };

  if (failedCharges.length === 0) {
    log.info("No failed charges found. No webhook sent.", { since_ts: sinceTs });
    return;
  }

  log.info("Sending failed-charge alert", {
    total_failed: payload.total_failed,
    since_ts: sinceTs,
  });
  await sendWebhook(webhookUrl, payload);
}

// Only run when executed directly, so tests can import collectFailedCharges.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error("Fatal error", { error: String(err) });
    process.exit(1);
  });
}
