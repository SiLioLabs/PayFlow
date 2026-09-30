/**
 * #1059 — Stroop amount validation conformance tests.
 *
 * These tests verify that all three consumer flows (StroopInput, PayPerUseForm,
 * and useFormValidation) agree on whether an amount is accepted or rejected,
 * and that they all delegate to the same canonical validateStroopAmount
 * implementation from utils/validation.ts.
 */
import { describe, it, expect } from "vitest";
import {
  validateStroopAmount,
  type StroopValidationResult,
} from "../../utils/validation";
import { validateStroopInput } from "../../components/StroopInput";
import { validatePayPerUseInput } from "../../components/PayPerUseForm";
import { validateStroopAmount as formValidateStroopAmount } from "../../hooks/useFormValidation";
import { MIN_STROOPS, MAX_STROOPS, CONTRACT_LIMITS } from "../../constants";

// ── Canonical validateStroopAmount tests ─────────────────────────────────────

describe("validateStroopAmount (canonical — utils/validation.ts)", () => {
  describe("Valid values", () => {
    it("accepts a normal integer XLM amount", () => {
      const r = validateStroopAmount("5", "XLM", MAX_STROOPS);
      expect(r.stroops).toBe(50_000_000n);
      expect(r.error).toBeNull();
    });

    it("accepts a decimal XLM amount", () => {
      const r = validateStroopAmount("1.5", "XLM", MAX_STROOPS);
      expect(r.stroops).toBe(15_000_000n);
      expect(r.error).toBeNull();
    });

    it("accepts full 7-decimal precision (0.0000001 XLM = 1 stroop)", () => {
      const r = validateStroopAmount("0.0000001", "XLM", MAX_STROOPS);
      expect(r.stroops).toBe(1n);
      expect(r.error).toBeNull();
    });

    it("accepts exactly MIN_STROOPS in STROOP unit", () => {
      const r = validateStroopAmount(MIN_STROOPS.toString(), "STROOP", MAX_STROOPS);
      expect(r.stroops).toBe(MIN_STROOPS);
      expect(r.error).toBeNull();
    });

    it("accepts exactly MAX_STROOPS in STROOP unit", () => {
      const r = validateStroopAmount(MAX_STROOPS.toString(), "STROOP", MAX_STROOPS);
      expect(r.stroops).toBe(MAX_STROOPS);
      expect(r.error).toBeNull();
    });

    it("accepts the contract pay-per-use maximum in STROOP", () => {
      const max = CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT;
      const r = validateStroopAmount(max.toString(), "STROOP", max);
      expect(r.stroops).toBe(max);
      expect(r.error).toBeNull();
    });

    it("accepts the contract subscription maximum in STROOP", () => {
      const max = CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT;
      const r = validateStroopAmount(max.toString(), "STROOP", max);
      expect(r.stroops).toBe(max);
      expect(r.error).toBeNull();
    });
  });

  describe("Invalid values", () => {
    it("returns no error for empty input (field not yet touched)", () => {
      const r = validateStroopAmount("", "XLM", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).toBeNull();
    });

    it("rejects zero XLM", () => {
      const r = validateStroopAmount("0", "XLM", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });

    it("rejects zero STROOP", () => {
      const r = validateStroopAmount("0", "STROOP", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });

    it("rejects negative XLM", () => {
      const r = validateStroopAmount("-1", "XLM", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });

    it("rejects non-numeric input", () => {
      const r = validateStroopAmount("abc", "XLM", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });

    it("rejects more than 7 decimal places in XLM", () => {
      const r = validateStroopAmount("0.00000001", "XLM", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).toBe("Max 7 decimal places");
    });

    it("rejects decimal STROOP values", () => {
      const r = validateStroopAmount("1.5", "STROOP", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).toBe("Stroops must be whole numbers");
    });

    it("rejects value below MIN_STROOPS in STROOP unit", () => {
      const r = validateStroopAmount("0", "STROOP", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });

    it("rejects value above maxStroops in STROOP unit", () => {
      const max = CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT;
      const r = validateStroopAmount((max + 1n).toString(), "STROOP", max);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });

    it("rejects value above maxStroops in XLM unit", () => {
      const max = CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT;
      // max = 100_000_000_000 stroops = 10000 XLM; enter 10001 XLM
      const r = validateStroopAmount("10001", "XLM", max);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });
  });

  describe("Boundary tests", () => {
    it("accepts MIN_STROOPS (1 stroop = 0.0000001 XLM) in XLM unit", () => {
      const r = validateStroopAmount("0.0000001", "XLM", MAX_STROOPS);
      expect(r.stroops).toBe(1n);
      expect(r.error).toBeNull();
    });

    it("rejects exactly 8 decimal places in XLM (one beyond precision boundary)", () => {
      const r = validateStroopAmount("0.00000001", "XLM", MAX_STROOPS);
      expect(r.error).toBe("Max 7 decimal places");
    });

    it("accepts exactly 7 decimal places in XLM (at precision boundary)", () => {
      const r = validateStroopAmount("1.0000001", "XLM", MAX_STROOPS);
      expect(r.stroops).not.toBeNull();
      expect(r.error).toBeNull();
    });

    it("accepts MAX_STROOPS - 1 in STROOP unit (just below upper bound)", () => {
      const r = validateStroopAmount((MAX_STROOPS - 1n).toString(), "STROOP", MAX_STROOPS);
      expect(r.stroops).toBe(MAX_STROOPS - 1n);
      expect(r.error).toBeNull();
    });

    it("rejects MAX_STROOPS + 1 in STROOP unit (just above upper bound)", () => {
      const r = validateStroopAmount((MAX_STROOPS + 1n).toString(), "STROOP", MAX_STROOPS);
      expect(r.stroops).toBeNull();
      expect(r.error).not.toBeNull();
    });
  });
});

// ── Three-flow conformance tests ──────────────────────────────────────────────

/**
 * These tests verify that StroopInput, PayPerUseForm, and useFormValidation
 * produce the same accept/reject decision for the same inputs.
 *
 * Conformance is established by comparing the outcome of each flow's public
 * validation function against the canonical validateStroopAmount from
 * utils/validation.ts.
 */
describe("Three-flow conformance (#1059)", () => {
  const MAX = CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT;

  /**
   * Normalise the three different return shapes into a single accepted/error pair
   * so we can compare them uniformly.
   */
  function fromStroopInput(raw: string, maxStroops: bigint) {
    const r = validateStroopInput(raw, "XLM", maxStroops);
    return { accepted: r.stroops !== null, error: r.error };
  }

  function fromPayPerUse(raw: string, maxStroops: bigint) {
    const r = validatePayPerUseInput(raw, "XLM", maxStroops);
    return { accepted: r.stroops !== null, error: r.error };
  }

  function fromFormValidation(raw: string, maxStroops: bigint) {
    const r = formValidateStroopAmount(raw, maxStroops);
    return { accepted: r.valid, error: r.error };
  }

  function canonical(raw: string, maxStroops: bigint): StroopValidationResult {
    return validateStroopAmount(raw, "XLM", maxStroops);
  }

  const REPRESENTATIVE_CASES: Array<{ label: string; raw: string }> = [
    { label: "normal integer (5 XLM)", raw: "5" },
    { label: "decimal (1.5 XLM)", raw: "1.5" },
    { label: "full 7-decimal precision (0.0000001 XLM)", raw: "0.0000001" },
    { label: "zero", raw: "0" },
    { label: "negative", raw: "-1" },
    { label: "empty", raw: "" },
    { label: "8 decimal places (beyond precision)", raw: "0.00000001" },
    { label: "exactly at max (10000 XLM = 1e11 stroops)", raw: "10000" },
    { label: "above max (10001 XLM)", raw: "10001" },
    { label: "just above max (10000.0000001 XLM)", raw: "10000.0000001" },
    { label: "non-numeric", raw: "abc" },
  ];

  for (const { label, raw } of REPRESENTATIVE_CASES) {
    it(`all three flows agree for "${label}" (raw="${raw}")`, () => {
      const expected = canonical(raw, MAX);
      const expectedAccepted = expected.stroops !== null;

      const si = fromStroopInput(raw, MAX);
      const pp = fromPayPerUse(raw, MAX);
      const fv = fromFormValidation(raw, MAX);

      expect(si.accepted).toBe(expectedAccepted);
      expect(pp.accepted).toBe(expectedAccepted);
      expect(fv.accepted).toBe(expectedAccepted);
    });
  }

  it("all three flows agree that 7-decimal input is accepted", () => {
    const raw = "1.0000001";
    const expected = canonical(raw, MAX);
    expect(expected.stroops).not.toBeNull();

    expect(fromStroopInput(raw, MAX).accepted).toBe(true);
    expect(fromPayPerUse(raw, MAX).accepted).toBe(true);
    expect(fromFormValidation(raw, MAX).accepted).toBe(true);
  });

  it("all three flows agree that 8-decimal input is rejected", () => {
    const raw = "0.00000001";
    const expected = canonical(raw, MAX);
    expect(expected.stroops).toBeNull();

    expect(fromStroopInput(raw, MAX).accepted).toBe(false);
    expect(fromPayPerUse(raw, MAX).accepted).toBe(false);
    expect(fromFormValidation(raw, MAX).accepted).toBe(false);
  });

  it("all three flows use identical error messages for >7 decimals", () => {
    const raw = "0.00000001";
    const canonicalError = canonical(raw, MAX).error;

    expect(fromStroopInput(raw, MAX).error).toBe(canonicalError);
    expect(fromPayPerUse(raw, MAX).error).toBe(canonicalError);
    // Note: formValidation wraps the error so the message comes from the core function
    expect(fromFormValidation(raw, MAX).error).toBe(canonicalError);
  });
});
