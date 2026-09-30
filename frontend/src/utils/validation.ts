/**
 * Canonical Stroop amount validation utility.
 *
 * This is the single source of truth for Stroop amount validation across
 * all three flows: StroopInput, PayPerUseForm, and useFormValidation.
 *
 * ## Representation
 * Input amounts are supplied as raw strings typed by the user, together with
 * the active display unit ("XLM" or "STROOP").  The function validates and
 * converts them to a bigint stroop value.
 *
 * ## Rounding
 * XLM input is converted to stroops via `Math.round(num * STROOPS_PER_XLM)`
 * using the same approach as the existing StroopInput / PayPerUseForm code.
 * This is safe for the value range supported by the UI (max 9e15 stroops),
 * which is well within Number.MAX_SAFE_INTEGER.
 *
 * ## Decimal precision
 * XLM values are capped at 7 decimal places (the maximum Stellar precision).
 * STROOP values must be whole integers.
 *
 * ## Bounds
 * - Minimum: MIN_STROOPS (1 stroop)
 * - Maximum: controlled by the `maxStroops` argument so each call-site can
 *   pass its own contract-specific cap
 *   (CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT or MAX_SUBSCRIPTION_AMOUNT).
 */

import { MIN_STROOPS, STROOPS_PER_XLM } from "../constants";
import { stroopsToXlm } from "./format";
import type { AmountUnit } from "./format";

export interface StroopValidationResult {
  /** Parsed stroop value when valid; null when invalid or empty. */
  stroops: bigint | null;
  /** Human-readable error message; null when valid or empty. */
  error: string | null;
}

/**
 * Validate and parse a user-supplied amount string into stroops.
 *
 * @param raw       Raw input string from the user (may be empty).
 * @param unit      Display unit the user is entering: "XLM" or "STROOP".
 * @param maxStroops Upper bound (inclusive) in stroops.  Callers supply the
 *                  appropriate contract-specific maximum.
 * @returns {StroopValidationResult}
 */
export function validateStroopAmount(
  raw: string,
  unit: AmountUnit,
  maxStroops: bigint
): StroopValidationResult {
  // Empty input — no error yet (field may not have been touched)
  if (!raw) return { stroops: null, error: null };

  const num = parseFloat(raw);
  if (isNaN(num) || num <= 0) {
    return { stroops: null, error: "Must be a positive number" };
  }

  let stroops: bigint;

  if (unit === "XLM") {
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    if (decimals > 7) {
      return { stroops: null, error: "Max 7 decimal places" };
    }
    stroops = BigInt(Math.round(num * STROOPS_PER_XLM));
  } else {
    // STROOP unit — must be a whole number
    if (raw.includes(".")) {
      return { stroops: null, error: "Stroops must be whole numbers" };
    }
    try {
      stroops = BigInt(raw);
    } catch {
      return { stroops: null, error: "Invalid integer" };
    }
  }

  if (stroops < MIN_STROOPS) {
    return {
      stroops: null,
      error:
        unit === "XLM"
          ? `Must be at least ${stroopsToXlm(MIN_STROOPS)} XLM`
          : `Must be at least ${MIN_STROOPS} STROOP`,
    };
  }

  if (stroops > maxStroops) {
    return {
      stroops: null,
      error:
        unit === "XLM"
          ? `Must be at most ${stroopsToXlm(maxStroops)} XLM`
          : `Must be at most ${maxStroops} STROOP`,
    };
  }

  return { stroops, error: null };
}
