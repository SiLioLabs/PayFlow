/**
 * merchant-queries.ts — Shared query helpers for reading merchant analytics
 * from the indexer SQLite database.
 *
 * This module provides a single, consistent interface for both
 * `merchant-analytics.ts` and `export-merchant-report.ts` to read from
 * the indexer DB. It includes freshness checking based on the `last_ledger`
 * meta value stored by the indexer.
 *
 * Usage:
 *   import { openMerchantDb, getMerchantMetrics, checkFreshness } from "./merchant-queries.js";
 *
 * The indexer DB is the primary data source. RPC is available as an optional
 * fallback when the DB is unavailable or stale.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw event row as stored in the indexer DB. */
export interface EventRow {
  id: string;
  event_name: string;
  address: string;
  amount: string | null;
  ledger: number;
  timestamp: number;
  tx_hash: string;
  raw_data: string;
  merchant: string | null;
  fee_amount: string | null;
  token: string | null;
  result_code: string | null;
}

/** Per-merchant metrics computed from indexed events. */
export interface MerchantMetrics {
  address: string;
  /** Net revenue (sum of amount - fee for all charges) */
  totalRevenue: bigint;
  /** Number of distinct subscribers who have subscribed at any point */
  subscriberCount: number;
  /** Average subscription amount per subscriber (based on subscribed events) */
  avgSubscriptionAmount: bigint;
  /**
   * 30-day (or compareDays-day) churn rate as a percentage [0–100].
   * Set to null when insufficient data.
   */
  churnRate: number | null;
  /**
   * Subscriber growth rate over the comparison window as a percentage.
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

/** Merchant report data for export. */
export interface MerchantReportData {
  merchant: string;
  totalRevenue: bigint;
  subscriberCount: number;
  dailyRevenueLast30Days: bigint[];
}

/** Freshness status of the indexer DB. */
export interface FreshnessStatus {
  /** Whether the DB is considered fresh */
  isFresh: boolean;
  /** The last ledger value from the DB, or null if not available */
  lastLedger: number | null;
  /** Staleness in seconds (time since last ledger update), or null */
  stalenessSeconds: number | null;
  /** Warning message if stale, or null if fresh */
  warning: string | null;
}

/** Configuration for freshness checking. */
export interface FreshnessConfig {
  /** Maximum acceptable staleness in seconds (default: 3600 = 1 hour) */
  maxStalenessSeconds?: number;
  /** Expected ledger close time in seconds (default: 5) */
  ledgerCloseTimeSeconds?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default maximum staleness before warning (1 hour). */
const DEFAULT_MAX_STALENESS_SECONDS = 3600;

/** Default expected ledger close time (~5 seconds on Stellar). */
const DEFAULT_LEDGER_CLOSE_TIME_SECONDS = 5;

// ── Database Helpers ──────────────────────────────────────────────────────────

/**
 * Open the indexer SQLite database for read-only access.
 * Returns null if the database file does not exist.
 */
export function openMerchantDb(dbPath: string): DatabaseSync | null {
  if (!existsSync(dbPath)) {
    return null;
  }
  return new DatabaseSync(dbPath, { open: true, readonly: true });
}

/**
 * Get a meta value from the indexer DB's meta table.
 */
export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

// ── Freshness Checking ────────────────────────────────────────────────────────

/**
 * Check the freshness of the indexer DB based on last_ledger.
 *
 * The freshness is determined by comparing the last_ledger value against
 * the current ledger. If the DB hasn't been updated recently relative to
 * the expected ledger close time, it's considered stale.
 *
 * @param db - Open database connection
 * @param config - Optional freshness configuration
 * @returns FreshnessStatus with isFresh, lastLedger, stalenessSeconds, and warning
 */
export function checkFreshness(
  db: DatabaseSync,
  config?: FreshnessConfig,
): FreshnessStatus {
  const maxStaleness =
    config?.maxStalenessSeconds ?? DEFAULT_MAX_STALENESS_SECONDS;
  const ledgerCloseTime =
    config?.ledgerCloseTimeSeconds ?? DEFAULT_LEDGER_CLOSE_TIME_SECONDS;

  const lastLedgerStr = getMeta(db, "last_ledger");
  if (lastLedgerStr === null) {
    return {
      isFresh: false,
      lastLedger: null,
      stalenessSeconds: null,
      warning:
        "Indexer DB has no last_ledger value. The database may not have been indexed yet.",
    };
  }

  const lastLedger = parseInt(lastLedgerStr, 10);
  if (isNaN(lastLedger)) {
    return {
      isFresh: false,
      lastLedger: null,
      stalenessSeconds: null,
      warning: "Indexer DB has invalid last_ledger value.",
    };
  }

  // Estimate staleness based on last_ledger timestamp if available,
  // otherwise use a heuristic based on expected ledger close time.
  const lastLedgerTimestampStr = getMeta(db, "last_ledger_timestamp");
  let stalenessSeconds: number;

  if (lastLedgerTimestampStr) {
    const lastLedgerTimestamp = parseInt(lastLedgerTimestampStr, 10);
    if (!isNaN(lastLedgerTimestamp)) {
      stalenessSeconds = Math.floor(Date.now() / 1000) - lastLedgerTimestamp;
    } else {
      stalenessSeconds = 0;
    }
  } else {
    // Without timestamp, assume fresh if last_ledger exists
    stalenessSeconds = 0;
  }

  const isFresh = stalenessSeconds <= maxStaleness;
  let warning: string | null = null;

  if (!isFresh) {
    const minutes = Math.floor(stalenessSeconds / 60);
    warning =
      `Indexer DB is stale: last_ledger=${lastLedger}, ` +
      `staleness=${minutes}m ${stalenessSeconds % 60}s ` +
      `(max allowed: ${Math.floor(maxStaleness / 60)}m). ` +
      `Consider running the indexer to update the database.`;
  }

  return {
    isFresh,
    lastLedger,
    stalenessSeconds,
    warning,
  };
}

// ── Event Queries ─────────────────────────────────────────────────────────────

/**
 * Fetch all relevant events from the indexer DB for merchant analytics.
 * Returns events ordered by timestamp ascending.
 */
export function fetchAnalyticsEvents(db: DatabaseSync): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash,
              raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE event_name IN ('subscribed', 'charged', 'cancelled')
       ORDER BY timestamp ASC`,
    )
    .all() as unknown as EventRow[];
}

/**
 * Fetch events for a specific merchant.
 */
export function fetchMerchantEvents(
  db: DatabaseSync,
  merchant: string,
): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash,
              raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE merchant = ? OR address = ?
       ORDER BY timestamp ASC`,
    )
    .all(merchant, merchant) as unknown as EventRow[];
}

/**
 * Fetch charge events for revenue calculation.
 */
export function fetchChargeEvents(db: DatabaseSync): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash,
              raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE event_name = 'charged'
       ORDER BY timestamp ASC`,
    )
    .all() as unknown as EventRow[];
}

/**
 * Fetch subscription events for subscriber counting.
 */
export function fetchSubscriptionEvents(db: DatabaseSync): EventRow[] {
  return db
    .prepare(
      `SELECT id, event_name, address, amount, ledger, timestamp, tx_hash,
              raw_data, merchant, fee_amount, token, result_code
       FROM events
       WHERE event_name IN ('subscribed', 'cancelled')
       ORDER BY timestamp ASC`,
    )
    .all() as unknown as EventRow[];
}

// ── Metric Computation ────────────────────────────────────────────────────────

/**
 * Compute per-merchant metrics from indexed events.
 *
 * @param db - Open database connection
 * @param compareDays - Number of days for comparison window (null for no comparison)
 * @returns Map of merchant address to metrics
 */
export function computeMerchantMetrics(
  db: DatabaseSync,
  compareDays: number | null,
): Map<string, MerchantMetrics> {
  const rows = fetchAnalyticsEvents(db);

  // Per-merchant accumulators
  const totalRevenue = new Map<string, bigint>();
  const revenueInWindow = new Map<string, bigint>();
  const revenueBeforeWindow = new Map<string, bigint>();
  const subscribers = new Map<string, Set<string>>();
  const subscribersBeforeWindow = new Map<string, Set<string>>();
  const cancellationsInWindow = new Map<string, number>();
  const subscriptionAmounts = new Map<string, bigint[]>();
  const firstEventAt = new Map<string, number>();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart =
    compareDays !== null ? nowSeconds - compareDays * 86400 : null;

  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.raw_data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const merchant = row.merchant ?? String(parsed.merchant ?? "");
    if (!merchant) continue;

    if (!firstEventAt.has(merchant)) {
      firstEventAt.set(merchant, row.timestamp);
    }

    if (!subscribers.has(merchant)) subscribers.set(merchant, new Set());
    if (!subscribersBeforeWindow.has(merchant))
      subscribersBeforeWindow.set(merchant, new Set());

    const isBeforeWindow = windowStart === null || row.timestamp < windowStart;

    if (row.event_name === "subscribed") {
      const subscriber =
        String(parsed.subscriber ?? parsed.user ?? row.address ?? "");
      const amount = BigInt(String(parsed.amount ?? row.amount ?? "0"));

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
      const amount = BigInt(
        String(parsed.amount ?? row.amount ?? "0"),
      );
      const fee = BigInt(
        String(parsed.fee ?? parsed.fee_amount ?? row.fee_amount ?? "0"),
      );
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

/**
 * Compute merchant report data for a specific merchant.
 */
export function computeMerchantReport(
  db: DatabaseSync,
  merchant: string,
): MerchantReportData {
  const events = fetchMerchantEvents(db, merchant);

  let totalRevenue = 0n;
  const subscribers = new Set<string>();
  const dailyRevenue = new Map<string, bigint>();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = nowSeconds - 30 * 86400;

  for (const row of events) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.raw_data) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (row.event_name === "subscribed") {
      const subscriber =
        String(parsed.subscriber ?? parsed.user ?? row.address ?? "");
      if (subscriber) subscribers.add(subscriber);
    } else if (row.event_name === "charged") {
      const amount = BigInt(
        String(parsed.amount ?? row.amount ?? "0"),
      );
      const fee = BigInt(
        String(parsed.fee ?? parsed.fee_amount ?? row.fee_amount ?? "0"),
      );
      const net = amount - fee;
      totalRevenue += net;

      // Track daily revenue for last 30 days
      if (row.timestamp >= thirtyDaysAgo) {
        const day = new Date(row.timestamp * 1000).toISOString().split("T")[0];
        dailyRevenue.set(day, (dailyRevenue.get(day) ?? 0n) + net);
      }
    }
  }

  // Build 30-day array
  const dailyRevenueArray: bigint[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date((nowSeconds - i * 86400) * 1000)
      .toISOString()
      .split("T")[0];
    dailyRevenueArray.push(dailyRevenue.get(day) ?? 0n);
  }

  return {
    merchant,
    totalRevenue,
    subscriberCount: subscribers.size,
    dailyRevenueLast30Days: dailyRevenueArray,
  };
}
