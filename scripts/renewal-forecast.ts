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
 *   npx tsx scripts/renewal-forecast.ts [--db <path>] [--json] [--out <file>]
 *
 * Modes:
 *   --db   <path>   Read subscriptions from the indexer SQLite DB (requires
 *                    the `subscriptions` table written by subscription-snapshot.ts).
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

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimum historical charge intervals needed for a "high" confidence forecast. */
const MIN_HISTORY_HIGH_CONFIDENCE = 3;
/** Minimum historical charge intervals for a "medium" confidence forecast. */
const MIN_HISTORY_MEDIUM_CONFIDENCE = 2;

/**
 * A single subscription snapshot as produced by subscription-snapshot.ts or
 * read from the indexer DB.  All timestamps are Unix seconds.
 */
export interface SubscriptionSnapshot {
  user: string;
  amount: number;
  interval: number;
  last_charged: number;
  active: boolean;
  paused: boolean;
  /** Ordered ascending array of Unix-second charge timestamps (max 12). */
  charge_history: number[];
}

/** Confidence level for the forecast based on history depth. */
export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient_data";

/** The forecast result for a single subscription. */
export interface ForecastEntry {
  user: string;
  next_renewal: number | null;
  confidence: ConfidenceLevel;
  confidence_band: { low: number; high: number } | null;
  reason: string | undefined;
}

/** Full forecast report. */
export interface ForecastReport {
  generated_at: string;
  total: number;
  forecastable: number;
  insufficient_data: number;
  paused: number;
  inactive: number;
  forecasts: ForecastEntry[];
}

// ── Core forecast logic (exported for testing) ───────────────────────────────

/**
 * Validate a single subscription snapshot.  Returns an error string on
 * invalid input, or null when the snapshot is valid.
 */
async function simulate(
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) throw new Error(`${method}: ${result.error}`);
    return result.result?.retval ?? null;
  } catch (err) {
    console.error(
      `[warn] simulate ${method} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
export function validateSnapshot(s: SubscriptionSnapshot): string | null {
  if (!s || typeof s !== "object") {
    return "snapshot is not an object";
  }
  if (!s.user || typeof s.user !== "string") {
    return "missing or invalid user address";
  }
  if (typeof s.interval !== "number" || !Number.isFinite(s.interval) || s.interval <= 0) {
    return `invalid interval: ${s.interval}`;
  }
  if (typeof s.amount !== "number" || !Number.isFinite(s.amount) || s.amount <= 0) {
    return `invalid amount: ${s.amount}`;
  }
  if (typeof s.last_charged !== "number" || !Number.isFinite(s.last_charged) || s.last_charged <= 0) {
    return `invalid last_charged: ${s.last_charged}`;
  }
  if (!Array.isArray(s.charge_history)) {
    return "charge_history is not an array";
  }
  for (let i = 0; i < s.charge_history.length; i++) {
    const ts = s.charge_history[i];
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
      return `invalid charge_history[${i}]: ${ts}`;
    }
  }
  return null;
}

/**
 * Compute the mean of a numeric array.  Returns 0 for empty arrays.
 * Never returns NaN or Infinity — callers can safely compare.
 */
export function safeMean(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0;
  let sum = 0;
  for (const v of finite) {
    sum += v;
  }
  return sum / finite.length;
}

/**
 * Compute the sample standard deviation of a numeric array.
 * Returns 0 for fewer than 2 finite values (prevents division by zero).
 */
export function safeStdDev(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return 0;
  const mean = safeMean(finite);
  let sumSq = 0;
  for (const v of finite) {
    const diff = v - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (finite.length - 1));
}

/**
 * Compute inter-interval gaps from a sorted ascending array of timestamps.
 * Returns the differences in seconds between consecutive entries.
 * Filters out zero or negative gaps (which would indicate duplicate/bad data).
 */
async function getSubscriberPage(
  offset: bigint,
  limit: number,
): Promise<string[]> {
  const retval = await simulate(
    "get_subscriber_page",
    xdr.ScVal.scvU64(new xdr.Uint64(offset)),
    xdr.ScVal.scvU32(limit),
  );
  if (!retval || retval.switch().name === "scvVoid") return [];

  const vec = retval.vec();
  if (!vec) return [];
  return vec.map((v: xdr.ScVal) => decodeAddress(v));
}

// ── Forecast Logic ──────────────────────────────────────────────────────────

interface DailyBucket {
  date: string; // YYYY-MM-DD
  count: number;
  totalVolumeStroops: bigint;
export function computeIntervals(timestamps: number[]): number[] {
  if (timestamps.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (Number.isFinite(gap) && gap > 0) {
      gaps.push(gap);
    }
  }
  return gaps;
}

/**
 * Determine the confidence level based on the number of historical intervals.
 */
export function confidenceLevel(intervalCount: number): ConfidenceLevel {
  if (intervalCount >= MIN_HISTORY_HIGH_CONFIDENCE) return "high";
  if (intervalCount >= MIN_HISTORY_MEDIUM_CONFIDENCE) return "medium";
  if (intervalCount >= 1) return "low";
  return "insufficient_data";
}

/**
 * Forecast the next renewal for a single subscription.
 *
 * Handles:
 * - Inactive subscriptions → null forecast with reason
 * - Paused subscriptions → null forecast with reason
 * - No charge history → null forecast, insufficient_data
 * - Single charge → uses configured interval, low confidence
 * - Multiple charges → uses mean of actual inter-charge intervals,
 *   with ±1 std-dev confidence band
 * - All outputs are NaN/Inf-free by construction
 */
export function forecastSubscription(sub: SubscriptionSnapshot): ForecastEntry {
  const base: Omit<ForecastEntry, "next_renewal" | "confidence_band"> = {
    user: sub.user,
    confidence: "insufficient_data",
    reason: undefined,
  };

  // Inactive → no forecast
  if (!sub.active) {
    return { ...base, next_renewal: null, confidence_band: null, reason: "subscription_inactive" };
  }

  // Paused → no forecast
  if (sub.paused) {
    return { ...base, next_renewal: null, confidence_band: null, reason: "subscription_paused" };
  }

  // Sort history ascending and compute inter-charge intervals
  const sorted = [...sub.charge_history]
    .filter((ts) => Number.isFinite(ts) && ts > 0)
    .sort((a, b) => a - b);

  const intervals = computeIntervals(sorted);
  const level = confidenceLevel(intervals.length);

  if (level === "insufficient_data") {
    // No history at all — we cannot forecast, but we can use the
    // configured interval as a fallback prediction.
    if (sub.interval > 0 && Number.isFinite(sub.last_charged)) {
      const predicted = sub.last_charged + sub.interval;
      return {
        ...base,
        next_renewal: predicted,
        confidence: "insufficient_data",
        confidence_band: null,
        reason: "no_charge_history_fallback_interval",
      };
    }
    return { ...base, next_renewal: null, confidence_band: null, reason: "no_charge_history" };
  }

  // Compute forecast from actual intervals
  const meanInterval = safeMean(intervals);
  const stdDev = safeStdDev(intervals);

  // Use the last known charge timestamp as anchor
  const anchor = sorted.length > 0 ? sorted[sorted.length - 1] : sub.last_charged;
  if (!Number.isFinite(anchor) || anchor <= 0) {
    return { ...base, next_renewal: null, confidence_band: null, reason: "invalid_anchor_timestamp" };
  }

// ── Output ────────────────────────────────────────────────────────────────────

/** Build a ForecastResult from raw daily buckets */
function buildResult(
  buckets: Map<string, DailyBucket>,
  startDate: string,
  endDate: string,
  activeCount: number,
): ForecastResult {
  const allDates = dateRange(startDate, endDate);
  const daily = allDates.map((date) => {
    const bucket = buckets.get(date);
    return {
      date,
      count: bucket?.count ?? 0,
      totalVolumeXlm: bucket
        ? stroopsToXlm(bucket.totalVolumeStroops)
        : "0.0000000",
    };
  });

  const totalCharges = daily.reduce((sum, d) => sum + d.count, 0);
  const totalVolume = daily.reduce(
    (sum, d) => sum + (buckets.get(d.date)?.totalVolumeStroops ?? 0n),
    0n,
  );
  const predicted = anchor + meanInterval;

  // Confidence band: ±1 std-dev; clamp to at least ±10% of the interval
  // to avoid degenerate zero-width bands when history is very regular.
  const bandMargin = Math.max(stdDev, meanInterval * 0.1);
  const bandLow = predicted - bandMargin;
  const bandHigh = predicted + bandMargin;

  return {
    user: sub.user,
    next_renewal: Math.round(predicted), // integer seconds
    confidence: level,
    confidence_band: {
      low: Math.round(bandLow),
      high: Math.round(bandHigh),
    },
    reason: undefined,
  };
}

/**
 * Generate a full forecast report from a list of subscription snapshots.
 * Performs input validation and returns structured results with no NaN/Inf.
 */
export function forecastRenewals(subs: SubscriptionSnapshot[]): ForecastReport {
  const forecasts: ForecastEntry[] = [];
  let forecastable = 0;
  let insufficientData = 0;
  let paused = 0;
  let inactive = 0;

  for (const sub of subs) {
    const validationError = validateSnapshot(sub);
    if (validationError) {
      forecasts.push({
        user: sub?.user ?? "unknown",
        next_renewal: null,
        confidence: "insufficient_data",
        confidence_band: null,
        reason: `validation_error: ${validationError}`,
      });
      insufficientData++;
      continue;
    }

    const entry = forecastSubscription(sub);

    if (!entry.next_renewal) {
      if (entry.reason === "subscription_inactive") inactive++;
      else if (entry.reason === "subscription_paused") paused++;
      else insufficientData++;
    } else {
      forecastable++;
    }

    forecasts.push(entry);
  }

  return {
    generated_at: new Date().toISOString(),
    total: subs.length,
    forecastable,
    insufficient_data: insufficientData,
    paused,
    inactive,
    forecasts,
  };
}

function printSummary(result: ForecastResult): void {
  console.error(
    `\nSummary: ${result.totalActiveSubscribers} active subscribers, ` +
      `${result.totalProjectedCharges} projected charges, ` +
      `${result.totalVolumeXlm} XLM over ${result.forecastDays} days ` +
      `(${result.forecastStart} → ${result.forecastEnd})`,
  );
// ── CLI helpers ──────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const stdinMode = hasFlag("--stdin");
  const dbPath = getArg("--db");
  const jsonMode = hasFlag("--json");
  const outFile = getArg("--out");

  if (!stdinMode && !dbPath) {
    // Default: try reading from DB, fall back to stdin
    const dataDir = process.env.DATA_DIR ?? "data";
    const defaultDb = process.env.DB_FILE ?? resolve(dataDir, "events.db");
    if (existsSync(defaultDb)) {
      console.error(`Reading from default DB: ${defaultDb}`);
      console.error("Use --db <path> or --stdin to specify input.");
      process.exit(1);
    }
  }

  // Validate required env
  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    console.error(
      "Usage: CONTRACT_ID=your_contract_id tsx scripts/renewal-forecast.ts",
    );
    process.exit(1);
  }

  console.error(
    `Forecasting ${days} days of renewals for contract ${CONTRACT_ID}...`,
  );

  // ── Step 1: Compute forecast window ──────────────────────────────────────
    console.error("Error: No input specified. Use --db <path> or --stdin.");
    console.error("Usage: npx tsx scripts/renewal-forecast.ts [--db <path>] [--stdin] [--json] [--out <file>]");
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
  } else {
    console.error(`DB mode not yet implemented. Use --stdin with JSON input.`);
    console.error("Pipe from subscription-snapshot.ts or provide fixture JSON.");
    process.exit(1);
  }

  if (!Array.isArray(snapshots)) {
    console.error("Error: Input must be a JSON array of subscription snapshots.");
    process.exit(1);
  }

    // Fetch subscription details in parallel for each address in the page
    const results = await Promise.all(
      page.map((addr) => getSubscription(addr)),
    );
  const report = forecastRenewals(snapshots);

  const output = jsonMode || outFile
    ? JSON.stringify(report, null, 2)
    : formatHumanReadable(report);

    // Advance by page size, not returned count — contract skips pruned slots
    // in the scan window but the window always covers `limit` index positions.
    offset += BigInt(PAGE_SIZE);
    console.error(
      `  Scanned through ${offset < totalSubscribers ? offset : totalSubscribers}/${totalSubscribers} slots (${activeSubs.length} active so far)...`,
    );
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

  if (activeSubs.length === 0) {
    const emptyResult = buildResult(new Map(), todayDate, forecastEndDate, 0);
    const output =
      format === "json" ? formatJson(emptyResult) : formatCsv(emptyResult);
    if (outPath) {
      writeFileSync(outPath, output);
      console.error(`Wrote forecast to ${outPath}`);
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
      const date = new Date(f.next_renewal * 1000).toISOString();
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

  const result = buildResult(
    buckets,
    todayDate,
    forecastEndDate,
    activeSubs.length,
  );
  const output = format === "json" ? formatJson(result) : formatCsv(result);
// Only run main() when THIS file is the entry point (not when imported for testing)
const _thisFile = basename(fileURLToPath(import.meta.url));
const _entryFile = basename(process.argv[1] ?? "");

if (_entryFile === _thisFile) {
  main();
}
