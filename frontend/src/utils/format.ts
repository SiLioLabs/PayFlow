import { STROOPS_PER_XLM } from "../constants";

export function formatAddress(addr: string, prefixLen = 6, suffixLen = 4): string {
  if (addr.length <= prefixLen + suffixLen) return addr;
  return `${addr.slice(0, prefixLen)}…${addr.slice(-suffixLen)}`;
}

export function formatXlm(stroops: string | bigint): string {
  return `${(Number(BigInt(stroops)) / 10_000_000).toFixed(7)} XLM`;
}

/** Display unit for amounts across the UI. */
export type AmountUnit = "XLM" | "STROOP";

/**
 * Format a stroop amount for display according to the requested unit.
 *
 * - "XLM": divides by 10,000,000 and rounds to 7 decimal places (1 stroop
 *   precision), formats with comma thousands separators.
 * - "STROOP": returns the raw integer with comma thousands separators.
 *
 * Edge cases:
 *   - 0 stroops → "0.0000000 XLM" or "0 STROOP"
 *   - 1 stroop → "0.0000001 XLM" or "1 STROOP"
 *   - Very large amounts are formatted with commas for readability.
 *
 * @param stroops - Amount in stroops (integer, may be string, number, or bigint)
 * @param unit - Display unit: "XLM" or "STROOP"
 * @returns Formatted string with unit suffix
 */
export function displayAmount(stroops: string | number | bigint, unit: AmountUnit): string {
  const stroopsNum = Number(BigInt(typeof stroops === "number" ? Math.trunc(stroops) : stroops));

  if (unit === "XLM") {
    const xlm = stroopsNum / STROOPS_PER_XLM;
    // Format with 7 decimal places and thousands separators on integer part
    const [intPart, fracPart] = xlm.toFixed(7).split(".");
    const formattedInt = Number(intPart).toLocaleString("en-US");
    return `${formattedInt}.${fracPart} XLM`;
  }

  // STROOP: raw integer with comma separators
  return `${stroopsNum.toLocaleString("en-US")} STROOP`;
}

/**
 * Progress percentage for daily limit (0-100). Returns 0 when limit is null or zero.
 */
export function dailyLimitProgress(spent: bigint, limit: bigint | null): number {
  if (limit === null || limit <= 0n) return 0;
  const pct = Number((spent * 100n) / limit);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Whether a pay-per-use amount would exceed the remaining daily budget.
 */
export function exceedsRemaining(amount: bigint | null, remaining: bigint | null): boolean {
  if (amount === null || remaining === null) return false;
  return amount > remaining;
}
