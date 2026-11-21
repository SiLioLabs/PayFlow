/**
 * lib/forecast.ts — Pure renewal-forecast math for renewal-forecast.ts.
 *
 * No I/O, no environment access: every function here is a deterministic
 * transform of its arguments so it can be unit-tested and reused.
 */

/** Minimum historical charge intervals needed for a "high" confidence forecast. */
export const MIN_HISTORY_HIGH_CONFIDENCE = 3;
/** Minimum historical charge intervals for a "medium" confidence forecast. */
export const MIN_HISTORY_MEDIUM_CONFIDENCE = 2;

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

/**
 * Validate a single subscription snapshot.  Returns an error string on
 * invalid input, or null when the snapshot is valid.
 */
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
export function forecastRenewals(
  subs: SubscriptionSnapshot[],
  now: Date = new Date(),
): ForecastReport {
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
    generated_at: now.toISOString(),
    total: subs.length,
    forecastable,
    insufficient_data: insufficientData,
    paused,
    inactive,
    forecasts,
  };
}
