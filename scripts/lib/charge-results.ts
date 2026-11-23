/**
 * lib/charge-results.ts — the single off-chain decoder for `ChargeResult`.
 *
 * `ChargeResult` is a Soroban `#[contracttype]` enum with no payload fields
 * (contract/src/batch.rs), so on the wire each element is an `scvU32` that
 * carries the variant discriminant — NOT an `scvSymbol`. The whole return
 * value of `batch_charge` / `get_batch_charge_estimate` is an `scvVec` of
 * those, one element per input address, in input order.
 *
 * The variant table below is the declaration order of the enum. The
 * discriminants are append-only: a new variant must be appended, and
 * renumbering an existing one breaks every decoder that was ever written.
 * `scripts/__tests__/keeper-decode.test.ts` diffs this table against
 * contract/src/batch.rs so the two cannot drift.
 *
 * See docs/CHARGE-RESULTS.md for the full wire-format reference.
 */

/** The `ChargeResult` variants, in discriminant order. */
export const CHARGE_RESULT_NAMES = [
  "Charged",
  "Skipped",
  "NoSubscription",
  "Inactive",
  "Paused",
  "GracePeriodElapsed",
  "AllowanceInsufficient",
] as const;

export type ChargeResultName = (typeof CHARGE_RESULT_NAMES)[number];

/**
 * Decode a `Vec<ChargeResult>` return value into variant names.
 *
 * Returns one entry per input address, in input order.
 *
 * - A missing value, or a value that is not a vector, yields an empty list:
 *   there is no per-address outcome to report (`scvVoid` means the invocation
 *   panicked, which is "no result", not "all failed").
 * - An unknown discriminant is reported as `Unknown(N)` rather than guessed.
 *   The keeper treats that as "not charged", which is the safe direction.
 */
export function decodeChargeResults(retval: unknown): string[] {
  if (!retval) return [];

  const type = (retval as { switch?: () => { name?: string } }).switch?.()?.name;
  if (type && type !== "scvVec") return [];

  const anyVal = retval as {
    vec?: () => unknown[];
    _value?: { vec?: unknown[] };
  };
  const vec = typeof anyVal.vec === "function" ? anyVal.vec() : anyVal._value?.vec;

  if (!Array.isArray(vec)) return [];

  return vec.map((item) => {
    const scv = item as {
      switch?: () => { name?: string };
      u32?: () => number;
      sym?: () => string;
    };
    const itemType = scv.switch?.()?.name;
    if (itemType === "scvU32") {
      const discriminant = scv.u32!() as number;
      return (
        (CHARGE_RESULT_NAMES as readonly string[])[discriminant] ??
        `Unknown(${discriminant})`
      );
    }
    if (itemType === "scvSymbol") {
      return scv.sym!().toString();
    }
    return String(item);
  });
}
