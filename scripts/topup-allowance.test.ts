/**
 * topup-allowance.test.ts — Unit tests for BigInt ScVal encoding and status validation.
 *
 * Covers:
 *  1. encodeU128 — round-trip at u128 boundaries (0, u64 max, js-max-safe+1, u128 max).
 *  2. decodeU128 — symmetric decode of encoded values.
 *  3. encodeI128 / decodeI128 — signed round-trips including negative values.
 *  4. parseAmount — format guards (decimals, sci notation, negative, empty).
 *  5. parseAmount — range guards (u128 overflow).
 *  6. validateStatus — deny-list: FAILED / NOT_FOUND / ERROR / PENDING / DUPLICATE / TRY_AGAIN_LATER.
 *  7. validateStatus — SUCCESS accepted, unknown status rejected.
 *  8. ABORT_STATUSES set contents.
 *  9. encodeU32 — valid and invalid inputs.
 * 10. encodeAddress — valid Stellar G-address.
 */

import { describe, it, expect } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import {
  encodeU128,
  decodeU128,
  encodeI128,
  decodeI128,
  encodeAddress,
  encodeU32,
  assertU128Range,
  U128_MAX,
  U64_MAX,
  JS_MAX_SAFE,
} from "./lib/scval-helpers.js";
import {
  parseAmount,
  validateStatus,
  ABORT_STATUSES,
  isSuccessStatus,
} from "./topup-allowance.js";

// ── 1. encodeU128 — output type and boundary values ─────────────────────────

describe("encodeU128", () => {
  it("produces a scvU128 ScVal type", () => {
    const val = encodeU128(42n);
    expect(val.switch()).toBe(xdr.ScValType.scvU128());
  });

  it("encodes zero correctly", () => {
    const val = encodeU128(0n);
    const parts = val.u128();
    expect(parts.hi().toString()).toBe("0");
    expect(parts.lo().toString()).toBe("0");
  });

  it("encodes 1 correctly", () => {
    const val = encodeU128(1n);
    const parts = val.u128();
    expect(parts.hi().toString()).toBe("0");
    expect(parts.lo().toString()).toBe("1");
  });

  it("encodes a typical strop amount (1 000 XLM) correctly", () => {
    const stroops = 10_000_000_000n; // 1000 XLM
    const val = encodeU128(stroops);
    const parts = val.u128();
    expect(parts.hi().toString()).toBe("0");
    expect(parts.lo().toString()).toBe(stroops.toString());
  });

  it("encodes u64 max correctly (hi=0, lo=u64_max)", () => {
    const val = encodeU128(U64_MAX);
    const parts = val.u128();
    expect(parts.hi().toString()).toBe("0");
    expect(parts.lo().toString()).toBe(U64_MAX.toString());
  });

  it("encodes u64_max + 1 correctly (hi=1, lo=0)", () => {
    const onePastU64Max = U64_MAX + 1n;
    const val = encodeU128(onePastU64Max);
    const parts = val.u128();
    expect(parts.hi().toString()).toBe("1");
    expect(parts.lo().toString()).toBe("0");
  });

  it("encodes a value above JS_MAX_SAFE without precision loss", () => {
    // JS Number loses precision here — BigInt must be used.
    const aboveSafe = JS_MAX_SAFE + 1n;
    const val = encodeU128(aboveSafe);
    // Round-trip decode must match the original value exactly.
    const decoded = decodeU128(val);
    expect(decoded).toBe(aboveSafe);
  });

  it("encodes U128_MAX correctly", () => {
    const val = encodeU128(U128_MAX);
    const parts = val.u128();
    // hi and lo should both be U64_MAX (all bits set in each half).
    expect(parts.hi().toString()).toBe(U64_MAX.toString());
    expect(parts.lo().toString()).toBe(U64_MAX.toString());
  });

  it("throws RangeError for negative values", () => {
    expect(() => encodeU128(-1n)).toThrowError(RangeError);
  });

  it("throws RangeError for values above U128_MAX", () => {
    expect(() => encodeU128(U128_MAX + 1n)).toThrowError(RangeError);
  });
});

// ── 2. decodeU128 — round-trip ───────────────────────────────────────────────

describe("decodeU128", () => {
  const roundTrips: Array<[string, bigint]> = [
    ["0", 0n],
    ["1", 1n],
    ["u64_max", U64_MAX],
    ["u64_max + 1", U64_MAX + 1n],
    ["JS_MAX_SAFE + 1", JS_MAX_SAFE + 1n],
    ["U128_MAX", U128_MAX],
    // A typical mainnet top-up: 1000 XLM × 1000 cycles = 10^13 stroops
    ["10^13 stroops", 10_000_000_000_000n],
  ];

  for (const [label, value] of roundTrips) {
    it(`round-trips ${label} through encode/decode`, () => {
      expect(decodeU128(encodeU128(value))).toBe(value);
    });
  }

  it("throws when passed a non-scvU128 ScVal", () => {
    const wrongType = xdr.ScVal.scvU32(5);
    expect(() => decodeU128(wrongType)).toThrow();
  });
});

// ── 3. encodeI128 / decodeI128 — signed round-trips ─────────────────────────

describe("encodeI128", () => {
  it("produces a scvI128 ScVal type", () => {
    const val = encodeI128(0n);
    expect(val.switch()).toBe(xdr.ScValType.scvI128());
  });

  const i128Cases: Array<[string, bigint]> = [
    ["0", 0n],
    ["1", 1n],
    ["-1", -1n],
    ["JS_MAX_SAFE", JS_MAX_SAFE],
    ["-JS_MAX_SAFE", -JS_MAX_SAFE],
    ["i128 max", (1n << 127n) - 1n],
    ["i128 min", -(1n << 127n)],
  ];

  for (const [label, value] of i128Cases) {
    it(`round-trips ${label}`, () => {
      expect(decodeI128(encodeI128(value))).toBe(value);
    });
  }

  it("throws RangeError for values above i128 max", () => {
    expect(() => encodeI128((1n << 127n))).toThrowError(RangeError);
  });

  it("throws RangeError for values below i128 min", () => {
    expect(() => encodeI128(-(1n << 127n) - 1n)).toThrowError(RangeError);
  });
});

// ── 4. parseAmount — format guards ───────────────────────────────────────────

describe("parseAmount — format guards", () => {
  it("accepts a normal decimal string", () => {
    expect(parseAmount("1000000000")).toBe(1_000_000_000n);
  });

  it("accepts string with leading zeros (trimmed to correct value)", () => {
    // BigInt("007") === 7n
    expect(parseAmount("007")).toBe(7n);
  });

  it("accepts '0'", () => {
    expect(parseAmount("0")).toBe(0n);
  });

  it("rejects a decimal fraction (dot notation)", () => {
    expect(() => parseAmount("100.5")).toThrow();
  });

  it("rejects scientific notation", () => {
    expect(() => parseAmount("1e10")).toThrow();
  });

  it("rejects negative sign", () => {
    expect(() => parseAmount("-1")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => parseAmount("")).toThrow();
  });

  it("rejects whitespace-only string", () => {
    expect(() => parseAmount("   ")).toThrow();
  });

  it("rejects hex notation", () => {
    expect(() => parseAmount("0xff")).toThrow();
  });

  it("rejects a non-numeric string", () => {
    expect(() => parseAmount("abc")).toThrow();
  });
});

// ── 5. parseAmount — range guards ────────────────────────────────────────────

describe("parseAmount — range guards", () => {
  it("accepts U128_MAX as a string", () => {
    expect(parseAmount(U128_MAX.toString())).toBe(U128_MAX);
  });

  it("rejects U128_MAX + 1", () => {
    expect(() => parseAmount((U128_MAX + 1n).toString())).toThrow(RangeError);
  });

  it("accepts values above JS_MAX_SAFE without throwing", () => {
    // This must not throw — it just emits a logger.warn.
    const aboveSafe = JS_MAX_SAFE + 1n;
    expect(() => parseAmount(aboveSafe.toString())).not.toThrow();
    expect(parseAmount(aboveSafe.toString())).toBe(aboveSafe);
  });
});

// ── 6. validateStatus — deny-list ────────────────────────────────────────────

describe("validateStatus — deny-list statuses abort", () => {
  const abortStatuses = [
    "FAILED",
    "NOT_FOUND",
    "ERROR",
    "PENDING",
    "DUPLICATE",
    "TRY_AGAIN_LATER",
  ];

  for (const status of abortStatuses) {
    it(`returns an error string for "${status}"`, () => {
      const result = validateStatus(status);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("string");
      expect(result).toContain(status);
    });
  }

  it("returns null for 'SUCCESS'", () => {
    expect(validateStatus("SUCCESS")).toBeNull();
  });

  it("returns an error string for unknown status 'WEIRD_STATUS'", () => {
    const result = validateStatus("WEIRD_STATUS");
    expect(result).not.toBeNull();
    expect(result).toContain("WEIRD_STATUS");
  });

  it("returns an error string for empty string", () => {
    const result = validateStatus("");
    expect(result).not.toBeNull();
  });
});

// ── 7. isSuccessStatus ───────────────────────────────────────────────────────

describe("isSuccessStatus", () => {
  it("returns true only for 'SUCCESS'", () => {
    expect(isSuccessStatus("SUCCESS")).toBe(true);
  });

  it("returns false for 'FAILED'", () => {
    expect(isSuccessStatus("FAILED")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSuccessStatus("")).toBe(false);
  });

  it("is case-sensitive — 'success' is not SUCCESS", () => {
    expect(isSuccessStatus("success")).toBe(false);
  });
});

// ── 8. ABORT_STATUSES set membership ────────────────────────────────────────

describe("ABORT_STATUSES", () => {
  it("contains all expected abort statuses", () => {
    for (const s of [
      "FAILED",
      "NOT_FOUND",
      "ERROR",
      "PENDING",
      "DUPLICATE",
      "TRY_AGAIN_LATER",
    ]) {
      expect(ABORT_STATUSES.has(s)).toBe(true);
    }
  });

  it("does NOT contain 'SUCCESS'", () => {
    expect(ABORT_STATUSES.has("SUCCESS")).toBe(false);
  });

  it("does NOT contain 'SIMULATED'", () => {
    expect(ABORT_STATUSES.has("SIMULATED")).toBe(false);
  });
});

// ── 9. encodeU32 ─────────────────────────────────────────────────────────────

describe("encodeU32", () => {
  it("encodes a valid u32 value", () => {
    const val = encodeU32(12345);
    expect(val.switch()).toBe(xdr.ScValType.scvU32());
    expect(val.u32()).toBe(12345);
  });

  it("encodes 0", () => {
    const val = encodeU32(0);
    expect(val.u32()).toBe(0);
  });

  it("encodes u32 max (0xffffffff = 4294967295)", () => {
    const val = encodeU32(0xffffffff);
    expect(val.u32()).toBe(0xffffffff);
  });

  it("throws RangeError for negative values", () => {
    expect(() => encodeU32(-1)).toThrowError(RangeError);
  });

  it("throws RangeError for values above u32 max", () => {
    expect(() => encodeU32(0x1_0000_0000)).toThrowError(RangeError);
  });

  it("throws RangeError for non-integers", () => {
    expect(() => encodeU32(3.14)).toThrowError(RangeError);
  });
});

// ── 10. encodeAddress ────────────────────────────────────────────────────────

describe("encodeAddress", () => {
  // Valid Stellar G-address (freshly generated test key, no funds).
  const VALID_G_ADDRESS = "GBWWM76QI6RQIMHLDR7GJQPUNIX6U67L3J3EDDZE7CBEN5RD4OP3IC5A";

  it("produces a scvAddress ScVal for a G-address (account)", () => {
    const val = encodeAddress(VALID_G_ADDRESS);
    expect(val.switch()).toBe(xdr.ScValType.scvAddress());
  });

  it("throws on an invalid address", () => {
    expect(() => encodeAddress("not-a-stellar-address")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => encodeAddress("")).toThrow();
  });
});

// ── 11. assertU128Range ───────────────────────────────────────────────────────

describe("assertU128Range", () => {
  it("does not throw for 0", () => {
    expect(() => assertU128Range(0n)).not.toThrow();
  });

  it("does not throw for U128_MAX", () => {
    expect(() => assertU128Range(U128_MAX)).not.toThrow();
  });

  it("throws for negative", () => {
    expect(() => assertU128Range(-1n)).toThrowError(RangeError);
  });

  it("throws for U128_MAX + 1", () => {
    expect(() => assertU128Range(U128_MAX + 1n)).toThrowError(RangeError);
  });
});
