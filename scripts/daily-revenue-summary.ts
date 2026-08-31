#!/usr/bin/env tsx
/**
 * daily-revenue-summary.ts
 *
 * Queries the indexer DB for the previous calendar day's (UTC) events and
 * outputs a structured JSON revenue summary to stdout.
 *
 * Usage:
 *   tsx scripts/daily-revenue-summary.ts [--date YYYY-MM-DD] [--db <path>]
 *     [--webhook <url>] [--force]
 *
 * Set `WEBHOOK_URL` for generic JSON delivery or `SLACK_WEBHOOK_URL` for a
 * Slack Block Kit message. Reports are cached in `data/reports/` by date.
 *
 * Expected DB tables:
 *   events(event_name TEXT, data TEXT, timestamp INTEGER)
 *   - event_name 'charged'      → data includes { amount, merchant, user }
 *   - event_name 'subscribed'   → new subscriber
 *   - event_name 'cancelled'    → cancellation
 *   - event_name 'fee_collected'→ data includes { amount }
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "./logger";

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

interface RevenueWebhookPayload {
  date: string;
  total_volume_xlm: number;
  total_charges: number;
  unique_merchants: number;
  new_subscribers: number;
  cancellations: number;
  fee_collected_xlm: number;
  partial: boolean;
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
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  return yesterday.toISOString().slice(0, 10);
}

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeParseData(raw: string): ChargeData {
  try {
    return JSON.parse(raw) as ChargeData;
  } catch {
    return {};
  }
}

function reportPath(date: string): string {
  return resolve("data", "reports", `${date}.json`);
}

function xlmFromStroops(value: number): number {
  return value / 10_000_000;
}

function slackPayload(report: RevenueWebhookPayload): Record<string, unknown> {
  const partialNote = report.partial ? " (partial day)" : "";
  return {
    text: `Daily revenue report for ${report.date}${partialNote}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Daily revenue: ${report.date}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Volume:* ${report.total_volume_xlm} XLM` },
          { type: "mrkdwn", text: `*Charges:* ${report.total_charges}` },
          { type: "mrkdwn", text: `*Merchants:* ${report.unique_merchants}` },
          { type: "mrkdwn", text: `*Fees:* ${report.fee_collected_xlm} XLM` },
          {
            type: "mrkdwn",
            text: `*New subscribers:* ${report.new_subscribers}`,
          },
          { type: "mrkdwn", text: `*Cancellations:* ${report.cancellations}` },
        ],
      },
      ...(report.partial
        ? [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "This report covers a partial UTC day.",
                },
              ],
            },
          ]
        : []),
    ],
  };
}

async function sendWebhook(
  url: string,
  report: RevenueWebhookPayload,
  slack: boolean,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slack ? slackPayload(report) : report),
    });
    const responseBody = await response.text();
    if (!response.ok) {
      logger.error(
        `Webhook delivery failed: HTTP ${response.status} ${response.statusText}; response body: ${responseBody}`,
      );
      return;
    }
    logger.info(`Webhook delivered successfully (HTTP ${response.status}).`);
  } catch (err) {
    logger.error(`Webhook delivery failed: ${err}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbPath = getArg("--db") ?? process.env.INDEXER_DB ?? "indexer.db";
  const dateArg = getArg("--date");
  const targetDate = dateArg ?? previousUtcDay();
  const webhookUrl = getArg("--webhook") ?? process.env.WEBHOOK_URL;
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  const force = process.argv.includes("--force");

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    logger.error(`Invalid date format: ${targetDate}. Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  const cachedPath = reportPath(targetDate);
  if (!force && existsSync(cachedPath)) {
    try {
      const cached = JSON.parse(
        readFileSync(cachedPath, "utf8"),
      ) as RevenueWebhookPayload;
      logger.info(
        `Report for ${targetDate} already cached; skipping computation and delivery.`,
      );
      logger.info(JSON.stringify(cached, null, 2));
      return;
    } catch (err) {
      logger.warn(`Ignoring invalid cached report at ${cachedPath}: ${err}`);
    }
  }

  const { startMs, endMs } = utcDayBounds(targetDate);
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (err) {
    logger.error(`Failed to open database at ${dbPath}: ${err}`);
    process.exit(1);
  }

  const query = db.prepare(
    `SELECT event_name, data FROM events
     WHERE timestamp >= ? AND timestamp < ?`,
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
  const merchants = new Set<string>();

  for (const row of rows) {
    switch (row.event_name) {
      case "charged": {
        const d = safeParseData(row.data);
        totalCharges += 1;
        totalAmount += Number(d.amount ?? 0);
        totalFees += Number(d.fee ?? 0);
        if (d.merchant) merchants.add(d.merchant);
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

  const report: RevenueWebhookPayload = {
    date: targetDate,
    total_volume_xlm: xlmFromStroops(totalAmount),
    total_charges: totalCharges,
    unique_merchants: merchants.size,
    new_subscribers: newSubscriptions,
    cancellations,
    fee_collected_xlm: xlmFromStroops(totalFees),
    partial: targetDate === currentUtcDay(),
  };

  logger.info(JSON.stringify(summary, null, 2));

  try {
    mkdirSync(dirname(cachedPath), { recursive: true });
    writeFileSync(cachedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    logger.info(`Cached report at ${cachedPath}.`);
  } catch (err) {
    logger.error(`Failed to cache report at ${cachedPath}: ${err}`);
  }

  const deliveryUrl = slackWebhookUrl ?? webhookUrl;
  if (!deliveryUrl) {
    logger.info("No webhook configured; skipping delivery.");
    db.close();
    return;
  }
  await sendWebhook(deliveryUrl, report, Boolean(slackWebhookUrl));
  db.close();
}

main().catch((err: unknown) => {
  logger.error(
    `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
