/**
 * Precision-safe stroop ↔ XLM conversion utilities.
 *
 * ## Rounding rules
 * - stroopsToXlm: truncates toward zero (floor division). The 7-decimal
 *   fractional part is derived from the remainder, so no floating-point
 *   arithmetic is used for the conversion itself.
 * - xlmToStroops: parses up to 7 decimal places and converts each part
 *   entirely with BigInt. Excess decimal places are rejected by callers.
 *
 * ## Why not Number()?
 * JS Number is a 64-bit float with 53 bits of mantissa (~9e15 safe integer).
 * Stellar's max supply is 100_000_000_000 XLM = 1e18 stroops — well above the
 * safe integer boundary. Any arithmetic on amounts in that range via Number
 * silently loses precision.
 */

const STROOPS_PER_XLM_BIGINT = 10_000_000n;

/**
 * Convert a stroop amount (bigint) to an XLM string with exactly 7 decimal
 * places, e.g. 10_000_001n → "1.0000001".
 *
 * The result never carries a unit suffix — callers append " XLM" as needed.
 * No floating-point arithmetic is used.
 */
export function stroopsToXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;

  const intPart = abs / STROOPS_PER_XLM_BIGINT;
  const fracPart = abs % STROOPS_PER_XLM_BIGINT;

  // Zero-pad fractional part to 7 digits
  const fracStr = fracPart.toString().padStart(7, "0");
  return `${negative ? "-" : ""}${intPart}.${fracStr}`;
}

/**
 * Parse an XLM string (up to 7 decimal places) into stroops (bigint).
 *
 * Throws if the string is not a valid non-negative decimal with ≤ 7 decimal
 * places. Callers are responsible for input validation.
 */
export function xlmToStroops(xlm: string): bigint {
  const trimmed = xlm.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new RangeError(`xlmToStroops: invalid XLM string "${xlm}"`);
  }
  const [intStr, fracStr = ""] = trimmed.split(".");
  // Pad or truncate fractional part to exactly 7 digits
  const fracPadded = fracStr.padEnd(7, "0").slice(0, 7);
  return BigInt(intStr) * STROOPS_PER_XLM_BIGINT + BigInt(fracPadded);
}

// ---------------------------------------------------------------------------
// Coercion helper — normalises string | number | bigint → bigint
// ---------------------------------------------------------------------------

function toBigIntStroops(stroops: string | number | bigint): bigint {
  if (typeof stroops === "bigint") return stroops;
  if (typeof stroops === "number") return BigInt(Math.trunc(stroops));
  // string: may be decimal (e.g. "10000000") or an integer literal
  return BigInt(stroops);
}

// ---------------------------------------------------------------------------
// Display utilities
// ---------------------------------------------------------------------------

/** Display unit for amounts across the UI. */
export type AmountUnit = "XLM" | "STROOP";

/**
 * Format a stroop amount for display according to the requested unit.
 *
 * - "XLM": uses BigInt division to produce a 7-decimal string, then adds
 *   comma thousands separators on the integer part.
 * - "STROOP": returns the raw integer with comma thousands separators.
 *
 * No Number() is used for the conversion arithmetic — only for Intl formatting
 * of the already-correct integer part (which is safe because the integer part
 * of any displayable XLM balance fits comfortably in 53-bit float range).
 */
export function displayAmount(stroops: string | number | bigint, unit: AmountUnit): string {
  const n = toBigIntStroops(stroops);

  if (unit === "XLM") {
    const xlmStr = stroopsToXlm(n); // e.g. "1234567.0000001"
    const dotIdx = xlmStr.indexOf(".");
    const intPart = xlmStr.slice(0, dotIdx);
    const fracPart = xlmStr.slice(dotIdx + 1);
    // toLocaleString is safe: the integer XLM part never exceeds ~1e11 XLM
    const formattedInt = parseInt(intPart, 10).toLocaleString("en-US");
    return `${formattedInt}.${fracPart} XLM`;
  }

  // STROOP: raw integer with comma separators
  return `${n.toLocaleString("en-US")} STROOP`;
}

/**
 * Thin wrapper kept for components that need a plain "N.NNNNNNN XLM" string
 * without the unit toggle context (e.g. sparkline tooltips, allowance display).
 * Replaces the old Number(BigInt(stroops))/1e7 implementation.
 */
export function formatXlm(stroops: string | bigint): string {
  const n = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  return `${stroopsToXlm(n)} XLM`;
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
