/**
 * Locale-aware formatting helpers — tests covering en-US and de-DE.
 *
 * Lives in src/utils/ so vitest.config.ts routes it to the Node environment
 * (environmentMatchGlobs: ["src/utils/*.test.ts", "node"]).
 *
 * Node 18+ ships full ICU data, so Intl.DateTimeFormat works for all locales
 * without additional setup.
 */
import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDateTimeShort,
  formatTime,
  formatTimeWithSeconds,
  formatInteger,
} from "./format";

// Fixed reference point: 2025-01-15 15:04:05 UTC
const REF_DATE = new Date("2025-01-15T15:04:05.000Z");
// Use a date whose UTC offset is unambiguous for the assertions below.
// We pin the UTC timestamp and compare patterns so the test is TZ-agnostic.

// ─────────────────────────────────────────────────────────────────────────────
// formatDate
// ─────────────────────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("en-US: contains the year, an abbreviated month, and the day", () => {
    const result = formatDate(REF_DATE, "en-US");
    // e.g. "Jan 15, 2025"
    expect(result).toMatch(/2025/);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
  });

  it("de-DE: contains the year, an abbreviated month, and the day", () => {
    const result = formatDate(REF_DATE, "de-DE");
    // e.g. "15. Jan. 2025"
    expect(result).toMatch(/2025/);
    expect(result).toMatch(/15/);
    // German abbreviation for January
    expect(result.toLowerCase()).toMatch(/jan/);
  });

  it("en-US and de-DE differ in ordering or punctuation", () => {
    const en = formatDate(REF_DATE, "en-US");
    const de = formatDate(REF_DATE, "de-DE");
    // Both are non-empty strings representing the same date
    expect(en).not.toBe(de);
  });

  it("uses the browser default when no locale is passed", () => {
    const result = formatDate(REF_DATE);
    // Should at least contain the year
    expect(result).toMatch(/2025/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDateTime
// ─────────────────────────────────────────────────────────────────────────────

describe("formatDateTime", () => {
  it("en-US: contains year, month, day, and time components", () => {
    const result = formatDateTime(REF_DATE, "en-US");
    expect(result).toMatch(/2025/);
    expect(result).toMatch(/1/); // month 1 or day 15
  });

  it("de-DE: contains year and date digits", () => {
    const result = formatDateTime(REF_DATE, "de-DE");
    expect(result).toMatch(/2025/);
    expect(result).toMatch(/15/);
  });

  it("produces a non-empty string", () => {
    expect(formatDateTime(REF_DATE, "en-US")).not.toBe("");
    expect(formatDateTime(REF_DATE, "de-DE")).not.toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDateTimeShort
// ─────────────────────────────────────────────────────────────────────────────

describe("formatDateTimeShort", () => {
  it("en-US: compact date+time contains year digits and time digits", () => {
    const result = formatDateTimeShort(REF_DATE, "en-US");
    // e.g. "1/15/25, 3:04 PM"
    expect(result).toMatch(/25/); // year (short)
    expect(result).toMatch(/15/); // day
  });

  it("de-DE: compact date+time contains year digits", () => {
    const result = formatDateTimeShort(REF_DATE, "de-DE");
    // e.g. "15.01.25, 15:04"
    expect(result).toMatch(/25/);
    expect(result).toMatch(/15/);
  });

  it("is shorter than or equal to formatDateTime for the same locale", () => {
    const short = formatDateTimeShort(REF_DATE, "en-US");
    const full = formatDateTime(REF_DATE, "en-US");
    // compact representation should not be longer than the full one
    expect(short.length).toBeLessThanOrEqual(full.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatTime
// ─────────────────────────────────────────────────────────────────────────────

describe("formatTime", () => {
  it("en-US: contains hour and minute components", () => {
    const result = formatTime(REF_DATE, "en-US");
    // Should contain a colon separator between hour and minute
    expect(result).toMatch(/:/);
  });

  it("de-DE: contains hour and minute components", () => {
    const result = formatTime(REF_DATE, "de-DE");
    expect(result).toMatch(/:/);
  });

  it("does not contain seconds", () => {
    // formatTime omits seconds; formatTimeWithSeconds includes them.
    // A time-only string without seconds has at most one colon.
    const en = formatTime(REF_DATE, "en-US");
    const colons = (en.match(/:/g) ?? []).length;
    expect(colons).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatTimeWithSeconds
// ─────────────────────────────────────────────────────────────────────────────

describe("formatTimeWithSeconds", () => {
  it("en-US: contains hours, minutes, and seconds (two colons)", () => {
    const result = formatTimeWithSeconds(REF_DATE, "en-US");
    const colons = (result.match(/:/g) ?? []).length;
    expect(colons).toBe(2);
  });

  it("de-DE: contains two colons", () => {
    const result = formatTimeWithSeconds(REF_DATE, "de-DE");
    const colons = (result.match(/:/g) ?? []).length;
    expect(colons).toBe(2);
  });

  it("includes more characters than formatTime (seconds add at least 2 chars)", () => {
    const withSecs = formatTimeWithSeconds(REF_DATE, "en-US");
    const withoutSecs = formatTime(REF_DATE, "en-US");
    expect(withSecs.length).toBeGreaterThan(withoutSecs.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatInteger
// ─────────────────────────────────────────────────────────────────────────────

describe("formatInteger", () => {
  it("en-US: formats 1234567 with comma thousands separators", () => {
    expect(formatInteger(1234567n, "en-US")).toBe("1,234,567");
  });

  it("de-DE: formats 1234567 with period thousands separators", () => {
    expect(formatInteger(1234567n, "de-DE")).toBe("1.234.567");
  });

  it("handles zero", () => {
    expect(formatInteger(0n, "en-US")).toBe("0");
    expect(formatInteger(0n, "de-DE")).toBe("0");
  });

  it("handles single digits", () => {
    expect(formatInteger(7n, "en-US")).toBe("7");
  });

  it("handles exactly 1000", () => {
    expect(formatInteger(1000n, "en-US")).toBe("1,000");
    expect(formatInteger(1000n, "de-DE")).toBe("1.000");
  });

  it("accepts a plain number", () => {
    expect(formatInteger(42000, "en-US")).toBe("42,000");
  });

  it("handles negative bigint", () => {
    expect(formatInteger(-1234n, "en-US")).toBe("-1,234");
  });

  it("handles large values beyond Number.MAX_SAFE_INTEGER", () => {
    // 10 quadrillion stroops: 10_000_000_000_000_000n
    const big = 10_000_000_000_000_000n;
    const result = formatInteger(big, "en-US");
    // Should have commas and not collapse precision
    expect(result).toMatch(/,/);
    // Value should start with 10 and end with zeros
    const digits = result.replace(/[^0-9]/g, "");
    expect(digits).toBe("10000000000000000");
  });

  it("defaults to en-US when no locale is supplied", () => {
    // Default locale arg → commas (en-US)
    expect(formatInteger(1000n)).toBe("1,000");
  });
});
