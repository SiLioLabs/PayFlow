/**
 * merchant-analytics.ts — Enhanced merchant analytics for the PayFlow protocol.
 *
 * Extends top-merchants.ts with subscriber growth rate, average subscription
 * amount, churn rate, and revenue trends. Supports configurable sorting,
 * top-N limits, period comparisons, and multiple output formats.
 *
 * Usage:
 *   npx ts-node scripts/merchant-analytics.ts \
 *     --db <path-to-indexer.db> \
 *     [--top N]                   # default: 10
 *     [--sort-by subscribers|revenue|growth]  # default: revenue
 *     [--compare-days 30]         # show 30-day delta for each metric
 *     [--format table|json|csv]   # default: table
 *     [--out report.json]         # optional output file
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

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

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
}

interface EventRow {
  event_name: string;
  data: string;
  timestamp: number;
}

interface MerchantMetrics {
  address: string;
  /** Net revenue (sum of amount - fee for all charges) */
  totalRevenue: bigint;
  /** Number of distinct subscribers who have subscribed at any point */
  subscriberCount: number;
  /** Average subscription amount per subscriber (based on subscribed events) */
  avgSubscriptionAmount: bigint;
  /**
   * 30-day (or compareDays-day) churn rate as a percentage [0–100].
   * churnRate = cancellations_in_window / subscribers_at_window_start * 100
   * Set to null when insufficient data (< compareDays days of history).
   */
  churnRate: number | null;
  /**
   * Subscriber growth rate over the comparison window as a percentage.
   * growth = (current_subs - subs_at_window_start) / subs_at_window_start * 100
   * Set to null when there was no history in the window.
   */
  growthRate: number | null;
  /** Revenue generated within the comparison window */
  revenueInWindow: bigint;
  /** Revenue generated before the comparison window */
  revenueBeforeWindow: bigint;
  /** Flags merchants with < compareDays of event history */
  isNew: boolean;
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

  return { dbPath, top, sortBy, compareDays, format, outFile };
}

// ── Data Aggregation ──────────────────────────────────────────────────────────

/**
 * Load all relevant events from the SQLite indexer database and compute
 * per-merchant metrics.
 */
function computeMetrics(
  dbPath: string,
  compareDays: number | null,
): Map<string, MerchantMetrics> {
  const db = new DatabaseSync(dbPath, { open: true });

  const rows = db
    .prepare(
      "SELECT event_name, data, timestamp FROM events WHERE event_name IN ('subscribed', 'charged', 'cancelled') ORDER BY timestamp ASC",
    )
    .all() as unknown as EventRow[];

  db.close();

  // Per-merchant accumulators
  const totalRevenue = new Map<string, bigint>();
  const revenueInWindow = new Map<string, bigint>();
  const revenueBeforeWindow = new Map<string, bigint>();
  // All unique subscriber addresses per merchant
  const subscribers = new Map<string, Set<string>>();
  // subscribers at start of comparison window
  const subscribersBeforeWindow = new Map<string, Set<string>>();
  // cancellations within the comparison window
  const cancellationsInWindow = new Map<string, number>();
  // subscription amounts per merchant for average calculation
  const subscriptionAmounts = new Map<string, bigint[]>();
  // earliest event timestamp per merchant
  const firstEventAt = new Map<string, number>();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart =
    compareDays !== null ? nowSeconds - compareDays * 86400 : null;

  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      continue; // skip malformed rows
    }

    const merchant = String(parsed.merchant ?? "");
    if (!merchant) continue;

    // Track earliest event for "is_new" detection
    if (!firstEventAt.has(merchant)) {
      firstEventAt.set(merchant, row.timestamp);
    }

    if (!subscribers.has(merchant)) subscribers.set(merchant, new Set());
    if (!subscribersBeforeWindow.has(merchant))
      subscribersBeforeWindow.set(merchant, new Set());

    const isBeforeWindow = windowStart === null || row.timestamp < windowStart;

    if (row.event_name === "subscribed") {
      const subscriber = String(parsed.subscriber ?? parsed.user ?? "");
      const amount = BigInt(String(parsed.amount ?? "0"));

      if (subscriber) {
        subscribers.get(merchant)!.add(subscriber);
        if (isBeforeWindow) {
          subscribersBeforeWindow.get(merchant)!.add(subscriber);
        }
      }

      if (!subscriptionAmounts.has(merchant))
        subscriptionAmounts.set(merchant, []);
      if (amount > 0n) subscriptionAmounts.get(merchant)!.push(amount);
    } else if (row.event_name === "charged") {
      const amount = BigInt(String(parsed.amount ?? "0"));
      const fee = BigInt(String(parsed.fee ?? "0"));
      const net = amount - fee;

      totalRevenue.set(merchant, (totalRevenue.get(merchant) ?? 0n) + net);

      if (!isBeforeWindow) {
        revenueInWindow.set(
          merchant,
          (revenueInWindow.get(merchant) ?? 0n) + net,
        );
      } else {
        revenueBeforeWindow.set(
          merchant,
          (revenueBeforeWindow.get(merchant) ?? 0n) + net,
        );
      }
    } else if (row.event_name === "cancelled") {
      if (!isBeforeWindow) {
        cancellationsInWindow.set(
          merchant,
          (cancellationsInWindow.get(merchant) ?? 0) + 1,
        );
      }
    }
  }

  // Build final metrics map
  const metrics = new Map<string, MerchantMetrics>();

  const allMerchants = new Set([...totalRevenue.keys(), ...subscribers.keys()]);

  const windowDays = compareDays ?? 30;
  const oldestEligibleTimestamp = nowSeconds - windowDays * 86400;

  for (const address of allMerchants) {
    const subs = subscribers.get(address) ?? new Set();
    const subsBeforeWindow = subscribersBeforeWindow.get(address) ?? new Set();
    const cancels = cancellationsInWindow.get(address) ?? 0;
    const amounts = subscriptionAmounts.get(address) ?? [];
    const revInWindow = revenueInWindow.get(address) ?? 0n;
    const revBefore = revenueBeforeWindow.get(address) ?? 0n;
    const firstAt = firstEventAt.get(address) ?? nowSeconds;

    const avgAmount =
      amounts.length > 0
        ? amounts.reduce((a, b) => a + b, 0n) / BigInt(amounts.length)
        : 0n;

    const isNew = firstAt > oldestEligibleTimestamp;

    let churnRate: number | null = null;
    let growthRate: number | null = null;

    if (windowStart !== null) {
      const subsAtWindowStart = subsBeforeWindow.size;

      if (subsAtWindowStart > 0) {
        churnRate = Math.round((cancels / subsAtWindowStart) * 10000) / 100;
        const currentSubs = subs.size;
        growthRate =
          Math.round(
            ((currentSubs - subsAtWindowStart) / subsAtWindowStart) * 10000,
          ) / 100;
      } else if (subs.size > 0) {
        // New merchant: no prior subscribers, 100% growth if there are current subs
        growthRate = null; // cannot compute without base
        churnRate = null;
      }
    }

    metrics.set(address, {
      address,
      totalRevenue: totalRevenue.get(address) ?? 0n,
      subscriberCount: subs.size,
      avgSubscriptionAmount: avgAmount,
      churnRate,
      growthRate,
      revenueInWindow: revInWindow,
      revenueBeforeWindow: revBefore,
      isNew,
    });
  }

  return metrics;
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

  let metrics: Map<string, MerchantMetrics>;
  try {
    metrics = computeMetrics(args.dbPath, args.compareDays);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: Failed to read database: ${msg}`);
    process.exit(1);
  }

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
    output = JSON.stringify(rows, null, 2);
  } else if (args.format === "csv") {
    output = renderCsv(rows);
  } else {
    const comparePart = args.compareDays
      ? ` | ${args.compareDays}-day comparison`
      : "";
    output =
      `PayFlow Merchant Analytics — top ${args.top} by ${args.sortBy}${comparePart}\n` +
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
