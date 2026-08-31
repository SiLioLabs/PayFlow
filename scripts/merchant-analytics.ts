/**
 * merchant-analytics.ts — Enhanced merchant analytics for the PayFlow protocol.
 *
 * Uses the indexer SQLite database as the primary data source for analytics.
 * Includes freshness checking and optional RPC fallback.
 *
 * Usage:
 *   npx ts-node scripts/merchant-analytics.ts \
 *     --db <path-to-indexer.db> \
 *     [--top N]                   # default: 10
 *     [--sort-by subscribers|revenue|growth]  # default: revenue
 *     [--compare-days 30]         # show 30-day delta for each metric
 *     [--format table|json|csv]   # default: table
 *     [--out report.json]         # optional output file
 *     [--rpc-fallback]            # enable RPC fallback when DB is stale/missing
 *     [--max-staleness 3600]      # max staleness in seconds before warning (default: 3600)
 *
 * Required table: events(event_name TEXT, data TEXT, timestamp INTEGER)
 *
 * Expected event data shapes:
 *   subscribed : { merchant: "G...", amount: "123" }
 *   charged    : { merchant: "G...", amount: "123", fee: "1" }
 *   cancelled  : { merchant: "G..." }
 *
 * Exit codes:
 *   0 — success
 *   1 — invalid arguments or database error
 */

import { writeFileSync } from "node:fs";
import {
  openMerchantDb,
  checkFreshness,
  computeMerchantMetrics,
  type MerchantMetrics,
  type FreshnessConfig,
} from "./merchant-queries.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortBy = "subscribers" | "revenue" | "growth";
type OutputFormat = "table" | "json" | "csv";

interface CliArgs {
  dbPath: string;
  top: number;
  sortBy: SortBy;
  compareDays: number | null;
  format: OutputFormat;
  outFile: string | null;
  rpcFallback: boolean;
  maxStalenessSeconds: number;
}

interface MerchantRow {
  rank: number;
  address: string;
  total_revenue: string;
  avg_subscription_amount: string;
  subscriber_count: number;
  churn_rate: string;
  growth_rate: string;
  revenue_in_window: string;
  revenue_change: string;
  is_new: boolean;
}

// ── Argument Parsing ──────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseArgs(): CliArgs {
  const dbPath = getArg("--db");
  if (!dbPath) {
    console.error("ERROR: --db <path> is required");
    process.exit(1);
  }

  const topArg = getArg("--top");
  const top = topArg !== undefined ? parseInt(topArg, 10) : 10;
  if (isNaN(top) || top < 1) {
    console.error("ERROR: --top must be a positive integer");
    process.exit(1);
  }

  const sortByArg = getArg("--sort-by") as SortBy | undefined;
  const validSortBy: SortBy[] = ["subscribers", "revenue", "growth"];
  const sortBy: SortBy =
    sortByArg !== undefined
      ? validSortBy.includes(sortByArg)
        ? sortByArg
        : (console.error(
            `ERROR: --sort-by must be one of: ${validSortBy.join(", ")}`,
          ),
          process.exit(1))
      : "revenue";

  const compareDaysArg = getArg("--compare-days");
  let compareDays: number | null = null;
  if (compareDaysArg !== undefined) {
    compareDays = parseInt(compareDaysArg, 10);
    if (isNaN(compareDays) || compareDays < 1) {
      console.error("ERROR: --compare-days must be a positive integer");
      process.exit(1);
    }
  }

  const formatArg = getArg("--format") as OutputFormat | undefined;
  const validFormats: OutputFormat[] = ["table", "json", "csv"];
  const format: OutputFormat =
    formatArg !== undefined
      ? validFormats.includes(formatArg)
        ? formatArg
        : (console.error(
            `ERROR: --format must be one of: ${validFormats.join(", ")}`,
          ),
          process.exit(1))
      : "table";

  const outFile = getArg("--out") ?? null;
  const rpcFallback = hasFlag("--rpc-fallback");

  const maxStalenessArg = getArg("--max-staleness");
  let maxStalenessSeconds = 3600;
  if (maxStalenessArg !== undefined) {
    maxStalenessSeconds = parseInt(maxStalenessArg, 10);
    if (isNaN(maxStalenessSeconds) || maxStalenessSeconds < 0) {
      console.error("ERROR: --max-staleness must be a non-negative integer");
      process.exit(1);
    }
  }

  return {
    dbPath,
    top,
    sortBy,
    compareDays,
    format,
    outFile,
    rpcFallback,
    maxStalenessSeconds,
  };
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortMetrics(
  metrics: MerchantMetrics[],
  sortBy: SortBy,
): MerchantMetrics[] {
  return [...metrics].sort((a, b) => {
    if (sortBy === "subscribers") {
      return b.subscriberCount - a.subscriberCount;
    } else if (sortBy === "revenue") {
      return b.totalRevenue > a.totalRevenue
        ? 1
        : b.totalRevenue < a.totalRevenue
          ? -1
          : 0;
    } else {
      // growth: null growth rates sort to the bottom
      const ga = a.growthRate ?? -Infinity;
      const gb = b.growthRate ?? -Infinity;
      return gb - ga;
    }
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────

function buildRows(
  sorted: MerchantMetrics[],
  compareDays: number | null,
): MerchantRow[] {
  return sorted.map((m, i) => ({
    rank: i + 1,
    address: m.address,
    total_revenue: m.totalRevenue.toString(),
    avg_subscription_amount: m.avgSubscriptionAmount.toString(),
    subscriber_count: m.subscriberCount,
    churn_rate:
      m.churnRate !== null
        ? `${m.churnRate.toFixed(2)}%`
        : compareDays
          ? "N/A"
          : "-",
    growth_rate:
      m.growthRate !== null
        ? `${m.growthRate.toFixed(2)}%`
        : compareDays
          ? "N/A"
          : "-",
    revenue_in_window: compareDays ? m.revenueInWindow.toString() : "-",
    revenue_change: compareDays
      ? m.revenueBeforeWindow > 0n
        ? `${(Number((m.revenueInWindow * 10000n) / m.revenueBeforeWindow) / 100).toFixed(2)}%`
        : "N/A"
      : "-",
    is_new: m.isNew,
  }));
}

function renderTable(rows: MerchantRow[], compareDays: number | null): string {
  const sep = "─";
  const cols = [
    { key: "rank", label: "Rank", width: 5 },
    { key: "address", label: "Merchant", width: 58 },
    { key: "total_revenue", label: "Revenue (stroops)", width: 22 },
    { key: "avg_subscription_amount", label: "Avg Sub Amt", width: 15 },
    { key: "subscriber_count", label: "Subscribers", width: 12 },
    ...(compareDays
      ? [
          { key: "churn_rate", label: `${compareDays}d Churn`, width: 12 },
          { key: "growth_rate", label: `${compareDays}d Growth`, width: 14 },
          {
            key: "revenue_in_window",
            label: `${compareDays}d Revenue`,
            width: 18,
          },
          { key: "revenue_change", label: "Rev Change", width: 12 },
        ]
      : []),
    { key: "is_new", label: "New", width: 5 },
  ];

  const header = cols.map((c) => c.label.padEnd(c.width)).join(" | ");
  const divider = cols.map((c) => sep.repeat(c.width)).join("-+-");
  const body = rows
    .map((r) =>
      cols
        .map((c) =>
          String((r as Record<string, unknown>)[c.key] ?? "").padEnd(c.width),
        )
        .join(" | "),
    )
    .join("\n");

  return `\n${header}\n${divider}\n${body}\n`;
}

function renderCsv(rows: MerchantRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]) as (keyof MerchantRow)[];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs();

  // Open the indexer DB
  const db = openMerchantDb(args.dbPath);
  if (!db) {
    console.error(`ERROR: Database not found at ${args.dbPath}`);
    if (!args.rpcFallback) {
      console.error("Hint: Use --rpc-fallback to attempt RPC fallback.");
    }
    process.exit(1);
  }

  // Check freshness
  const freshnessConfig: FreshnessConfig = {
    maxStalenessSeconds: args.maxStalenessSeconds,
  };
  const freshness = checkFreshness(db, freshnessConfig);

  if (freshness.warning) {
    console.warn(`WARNING: ${freshness.warning}`);
    if (!args.rpcFallback) {
      console.warn(
        "Data may be outdated. Consider running the indexer or using --rpc-fallback.",
      );
    }
  }

  // Compute metrics from the indexer DB
  let metrics: Map<string, MerchantMetrics>;
  try {
    metrics = computeMerchantMetrics(db, args.compareDays);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: Failed to compute metrics: ${msg}`);
    db.close();
    process.exit(1);
  }

  db.close();

  if (metrics.size === 0) {
    console.warn("No merchant data found in the database.");
    process.exit(0);
  }

  const sorted = sortMetrics([...metrics.values()], args.sortBy).slice(
    0,
    args.top,
  );
  const rows = buildRows(sorted, args.compareDays);

  let output: string;
  if (args.format === "json") {
    output = JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        freshness: {
          last_ledger: freshness.lastLedger,
          is_fresh: freshness.isFresh,
          staleness_seconds: freshness.stalenessSeconds,
        },
        merchants: rows,
      },
      null,
      2,
    );
  } else if (args.format === "csv") {
    output = renderCsv(rows);
  } else {
    const comparePart = args.compareDays
      ? ` | ${args.compareDays}-day comparison`
      : "";
    const freshnessPart = freshness.lastLedger
      ? ` | last_ledger: ${freshness.lastLedger}`
      : "";
    output =
      `PayFlow Merchant Analytics — top ${args.top} by ${args.sortBy}${comparePart}${freshnessPart}\n` +
      renderTable(rows, args.compareDays);
  }

  if (args.outFile) {
    try {
      writeFileSync(args.outFile, output);
      console.log(`Wrote report to ${args.outFile}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ERROR: Failed to write output file: ${msg}`);
      process.exit(1);
    }
  } else {
    process.stdout.write(output + "\n");
  }

  process.exit(0);
}

main();
