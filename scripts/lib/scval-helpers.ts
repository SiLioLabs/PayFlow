/**
 * scval-helpers.ts — BigInt-safe ScVal encoding helpers for Soroban transactions.
 *
 * Soroban token `approve()` takes a u128 amount. JS numbers lose precision
 * above 2^53 − 1 (~9 × 10^15), which is well below u128's maximum of
 * 2^128 − 1. Encoding a large amount via `Number()` or a floating-point
 * path silently truncates it — an irreversible mistake for top-ups.
 *
 * This module provides:
 *  - `encodeU128(amount)` — encodes a BigInt as an xdr.ScVal u128 (scvU128)
 *    using the SDK's `UInt128Parts` (hi/lo 64-bit halves). Never touches
 *    `Number()` for the amount itself.
 *  - `encodeI128(amount)` — same for i128 / scvI128 (signed).
 *  - `encodeAddress(address)` — wraps an Address in scvAddress.
 *  - `encodeU32(n)` — wraps a number in scvU32 (for ledger/expiration args).
 *
 * U128 boundary constants are exported for tests.
 */

import { Address, xdr } from "@stellar/stellar-sdk";

// ── U128 boundary constants ──────────────────────────────────────────────────

/** Maximum value of a u128: 2^128 − 1. */
export const U128_MAX = (1n << 128n) - 1n;

/** Maximum value of a u64 (used to split hi/lo halves). */
export const U64_MAX = (1n << 64n) - 1n;

/** Maximum JS safe integer as a BigInt (useful for boundary-crossing tests). */
export const JS_MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// ── Encoding helpers ─────────────────────────────────────────────────────────

/**
 * Asserts that `amount` fits in a u128 (0 ≤ amount ≤ 2^128 − 1).
 * Throws `RangeError` with a descriptive message otherwise.
 */
export function assertU128Range(amount: bigint): void {
  if (amount < 0n) {
    throw new RangeError(
      `Amount must be non-negative (u128), got ${amount}`
    );
  }
  if (amount > U128_MAX) {
    throw new RangeError(
      `Amount ${amount} exceeds u128 maximum (${U128_MAX})`
    );
  }
}

/**
 * Asserts that `amount` fits in an i128 (−2^127 ≤ amount ≤ 2^127 − 1).
 */
export function assertI128Range(amount: bigint): void {
  const I128_MIN = -(1n << 127n);
  const I128_MAX = (1n << 127n) - 1n;
  if (amount < I128_MIN || amount > I128_MAX) {
    throw new RangeError(
      `Amount ${amount} is outside i128 range [${I128_MIN}, ${I128_MAX}]`
    );
  }
}

/**
 * Encodes a BigInt as an `scvU128` ScVal using `UInt128Parts` (hi/lo u64
 * halves). This is the only safe way to represent amounts that may exceed
 * `Number.MAX_SAFE_INTEGER` without silent truncation.
 *
 * @param amount - A non-negative BigInt ≤ U128_MAX.
 * @returns xdr.ScVal of type scvU128.
 * @throws RangeError if `amount` is out of range.
 *
 * @example
 * // 100 XLM in stroops (safe integer)
 * encodeU128(1_000_000_000n)
 *
 * @example
 * // Near-max u128 value
 * encodeU128(U128_MAX)
 */
export function encodeU128(amount: bigint): xdr.ScVal {
  assertU128Range(amount);

  const lo = amount & U64_MAX;
  const hi = amount >> 64n;

  return xdr.ScVal.scvU128(
    new xdr.UInt128Parts({
      hi: xdr.Uint64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    })
  );
}

/**
 * Encodes a BigInt as an `scvI128` ScVal using `Int128Parts` (hi/lo 64-bit
 * halves). Used when the contract expects a signed 128-bit integer.
 *
 * @param amount - A BigInt within the i128 range.
 * @returns xdr.ScVal of type scvI128.
 * @throws RangeError if `amount` is out of i128 range.
 */
export function encodeI128(amount: bigint): xdr.ScVal {
  assertI128Range(amount);

  // For negative numbers, compute two's complement in 128-bit space.
  const raw = amount < 0n ? amount + (1n << 128n) : amount;
  const lo = raw & U64_MAX;
  const hi = raw >> 64n;

  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(hi.toString()),
      lo: xdr.Uint64.fromString(lo.toString()),
    })
  );
}

/**
 * Encodes a Stellar address string (G-address account or C-address contract)
 * as an `scvAddress` ScVal.
 *
 * Uses `Address.fromString` which accepts both Ed25519 public keys (G…) and
 * Stellar contract addresses (C…) via StrKey decoding.
 *
 * @param address - A Stellar G-address or C-address.
 * @returns xdr.ScVal of type scvAddress.
 * @throws Error if the address is not a valid Stellar address.
 */
export function encodeAddress(address: string): xdr.ScVal {
  return Address.fromString(address).toScVal();
}

/**
 * Encodes a 32-bit unsigned integer as `scvU32`. Suitable for passing
 * ledger sequence numbers as expiration arguments.
 *
 * @param n - A non-negative integer ≤ 2^32 − 1.
 * @returns xdr.ScVal of type scvU32.
 */
export function encodeU32(n: number): xdr.ScVal {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new RangeError(`encodeU32: value ${n} is not a valid u32`);
  }
  return xdr.ScVal.scvU32(n);
}

// ── Decoding helpers ─────────────────────────────────────────────────────────

/**
 * Decodes an `scvU128` ScVal back to a BigInt. Reconstructs the value from
 * the hi/lo 64-bit halves.
 *
 * @param val - A ScVal of type scvU128.
 * @returns The decoded BigInt.
 * @throws Error if `val` is not scvU128.
 */
export function decodeU128(val: xdr.ScVal): bigint {
  if (val.switch() !== xdr.ScValType.scvU128()) {
    throw new Error(`Expected scvU128, got ${val.switch().name}`);
  }
  const parts = val.u128();
  const hi = BigInt(parts.hi().toString());
  const lo = BigInt(parts.lo().toString());
  return (hi << 64n) | lo;
}

/**
 * Decodes an `scvI128` ScVal back to a BigInt. Handles the two's-complement
 * sign extension for negative values.
 *
 * @param val - A ScVal of type scvI128.
 * @returns The decoded BigInt (may be negative).
 * @throws Error if `val` is not scvI128.
 */
export function decodeI128(val: xdr.ScVal): bigint {
  if (val.switch() !== xdr.ScValType.scvI128()) {
    throw new Error(`Expected scvI128, got ${val.switch().name}`);
  }
  const parts = val.i128();
  const hi = BigInt(parts.hi().toString());
  const lo = BigInt(parts.lo().toString());
  const raw = (hi << 64n) | lo;

  // Re-interpret as signed: if the high bit of the 128-bit value is set,
  // subtract 2^128 to recover the negative value.
  return raw >= (1n << 127n) ? raw - (1n << 128n) : raw;
}
