#!/usr/bin/env tsx
/**
 * renewal-forecast.ts — Subscription renewal date forecaster for FlowPay
 *
 * Forecasts when each active subscription will next renew based on its charge
 * history (ring buffer of up to 12 timestamps), configured interval, and pause
 * state.  Produces per-subscription confidence bands and explicit
 * insufficient-data outcomes so callers never see NaN or overconfident
 * predictions for sparse-history or paused subscribers.
 *
 * ## CLI Usage
 *
 *   npx tsx scripts/renewal-forecast.ts [--db <path> | --stdin] [--json] [--out <file>]
 *
 * Modes:
 *   --db   <path>   Read subscriptions from a SQLite DB containing a
 *                    `subscriptions` table (user, amount, interval, last_charged,
 *                    active, paused, charge_history as a JSON array).
 *                    Defaults to DB_FILE / DATA_DIR/events.db when it exists.
 *   --stdin         Read a JSON array of SubscriptionSnapshot from stdin.
 *                    Useful for piping from subscription-snapshot.ts or fixtures.
 *
 * Options:
 *   --json          Output machine-readable JSON (default when --out is set).
 *   --out  <file>   Write output to a file instead of stdout.
 *
 * Environment variables:
 *   DATA_DIR   Directory containing the SQLite DB (default: data).
 *   DB_FILE    Full path override for the SQLite DB.
 *
 * Exit codes:
 *   0 — forecast completed successfully (even with insufficient-data entries)
 *   1 — fatal input error (bad JSON, missing DB, etc.)
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forecastRenewals,
  type ForecastEntry,
  type ForecastReport,
  type SubscriptionSnapshot,
} from "./lib/forecast.js";

export * from "./lib/forecast.js";

// ── DB adapter ───────────────────────────────────────────────────────────────

interface SubscriptionRow {
  user: string;
  amount: number;
  interval: number;
  last_charged: number;
  active: number;
  paused: number;
  charge_history: string | null;
}

/**
 * Read subscription snapshots from the `subscriptions` table of a SQLite DB.
 * node:sqlite is loaded lazily so --stdin mode works without it.
 */
export async function loadSnapshotsFromDb(dbPath: string): Promise<SubscriptionSnapshot[]> {
  if (!existsSync(dbPath)) {
    throw new Error(`DB not found: ${dbPath}`);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT user, amount, interval, last_charged, active, paused, charge_history FROM subscriptions",
      )
      .all() as unknown as SubscriptionRow[];
    return rows.map((r) => ({
      user: r.user,
      amount: Number(r.amount),
      interval: Number(r.interval),
      last_charged: Number(r.last_charged),
      active: Boolean(r.active),
      paused: Boolean(r.paused),
      charge_history: r.charge_history ? (JSON.parse(r.charge_history) as number[]) : [],
    }));
  } finally {
    db.close();
  }
}

// ── CLI helpers ──────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("Usage: npx tsx scripts/renewal-forecast.ts [--db <path>] [--stdin] [--json] [--out <file>] [--dry-run]");
    process.exit(0);
  }

  const stdinMode = hasFlag("--stdin");
  const dryRunMode = hasFlag("--dry-run");
  const jsonMode = hasFlag("--json");
  const outFile = getArg("--out");

  let dbPath = getArg("--db");
  if (!stdinMode && !dbPath) {
    const dataDir = process.env.DATA_DIR ?? "data";
    const defaultDb = process.env.DB_FILE ?? resolve(dataDir, "events.db");
    if (existsSync(defaultDb)) dbPath = defaultDb;
  }

  if (!stdinMode && !dbPath && !dryRunMode) {
    console.error("Error: No input specified. Use --db <path> or --stdin.");
    console.error("Usage: npx tsx scripts/renewal-forecast.ts [--db <path>] [--stdin] [--json] [--out <file>] [--dry-run]");
    process.exit(1);
  }

  let snapshots: SubscriptionSnapshot[];

  if (stdinMode) {
    const raw = readFileSync(0, "utf-8");
    try {
      snapshots = JSON.parse(raw) as SubscriptionSnapshot[];
    } catch (err) {
      console.error(`Error: Failed to parse JSON from stdin: ${err}`);
      process.exit(1);
    }
  } else if (dbPath && existsSync(dbPath)) {
    try {
      snapshots = await loadSnapshotsFromDb(dbPath);
    } catch (err) {
      console.error(`Error: Failed to read subscriptions from ${dbPath}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  } else if (dryRunMode) {
    const now = Math.floor(Date.now() / 1000);
    snapshots = [
      {
        user: "GUSER1111111111111111111111111111111111111111111111111111111",
        amount: 1000,
        interval: 86400,
        last_charged: now - 86400,
        active: true,
        paused: false,
        charge_history: [now - 3 * 86400, now - 2 * 86400, now - 86400],
      },
    ];
  } else {
    console.error(`Error: Failed to read subscriptions from ${dbPath}`);
    process.exit(1);
  }

  if (!Array.isArray(snapshots)) {
    console.error("Error: Input must be a JSON array of subscription snapshots.");
    process.exit(1);
  }

  const report = forecastRenewals(snapshots);

  const output = jsonMode || outFile
    ? JSON.stringify(report, null, 2)
    : formatHumanReadable(report);

  if (outFile) {
    writeFileSync(outFile, output);
    console.error(`Wrote forecast to ${outFile}`);
  } else {
    process.stdout.write(output + "\n");
  }
}

/**
 * Format a forecast report as a human-readable summary.
 */
function formatHumanReadable(report: ForecastReport): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  FlowPay Renewal Forecast");
  lines.push(`  Generated: ${report.generated_at}`);
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`  Total subscriptions:  ${report.total}`);
  lines.push(`  Forecastable:         ${report.forecastable}`);
  lines.push(`  Insufficient data:    ${report.insufficient_data}`);
  lines.push(`  Paused:               ${report.paused}`);
  lines.push(`  Inactive:             ${report.inactive}`);
  lines.push("");

  const grouped: Record<string, ForecastEntry[]> = {
    forecastable: [],
    insufficient_data: [],
    paused: [],
    inactive: [],
  };

  for (const f of report.forecasts) {
    if (!f.next_renewal) {
      if (f.reason === "subscription_inactive") grouped.inactive.push(f);
      else if (f.reason === "subscription_paused") grouped.paused.push(f);
      else grouped.insufficient_data.push(f);
    } else {
      grouped.forecastable.push(f);
    }
  }

  if (grouped.forecastable.length > 0) {
    lines.push("── Forecastable ────────────────────────────────────────────────");
    for (const f of grouped.forecastable) {
      const date = new Date(f.next_renewal! * 1000).toISOString();
      const band = f.confidence_band
        ? `[${new Date(f.confidence_band.low * 1000).toISOString()} — ${new Date(f.confidence_band.high * 1000).toISOString()}]`
        : "";
      lines.push(`  ${f.user}  →  ${date}  (${f.confidence})  ${band}`);
    }
    lines.push("");
  }

  if (grouped.insufficient_data.length > 0) {
    lines.push("── Insufficient Data ────────────────────────────────────────────");
    for (const f of grouped.insufficient_data) {
      lines.push(`  ${f.user}  →  ${f.reason ?? "unknown"}`);
    }
    lines.push("");
  }

  if (grouped.paused.length > 0) {
    lines.push("── Paused ──────────────────────────────────────────────────────");
    for (const f of grouped.paused) {
      lines.push(`  ${f.user}`);
    }
    lines.push("");
  }

  if (grouped.inactive.length > 0) {
    lines.push("── Inactive ────────────────────────────────────────────────────");
    for (const f of grouped.inactive) {
      lines.push(`  ${f.user}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// Only run main() when THIS file is the entry point (not when imported for testing)
const _thisFile = basename(fileURLToPath(import.meta.url));
const _entryFile = basename(process.argv[1] ?? "");

if (_entryFile === _thisFile) {
  main().catch((err: unknown) => {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
