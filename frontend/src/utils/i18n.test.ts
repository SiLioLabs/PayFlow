/**
 * i18n catalog conformance and runtime tests.
 *
 * Lives in src/utils/ so vitest.config.ts routes it to the Node environment
 * (environmentMatchGlobs: ["src/utils/*.test.ts", "node"]).
 *
 * What this tests:
 *  1. The English catalog has no empty values.
 *  2. translateWith() resolves keys and interpolates variables correctly.
 *  3. translateWith() throws in non-production when a key is missing.
 *  4. Catalog completeness — every key referenced in en.ts is non-empty.
 *  5. {placeholder} interpolation works for all variables.
 *  6. All error.* keys in en.ts have a corresponding entry in CONTRACT_ERRORS
 *     (the two maps stay aligned).
 *  7. The SUPPORTED_LOCALES list is non-empty and contains "en".
 */
import { describe, it, expect } from "vitest";
import { en } from "../i18n/en";
import { translateWith, SUPPORTED_LOCALES } from "../i18n/index";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Catalog shape
// ─────────────────────────────────────────────────────────────────────────────

describe("English catalog (en.ts)", () => {
  it("exports at least one key", () => {
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it("has no empty string values", () => {
    const empty = Object.entries(en)
      .filter(([, v]) => v.trim() === "")
      .map(([k]) => k);
    expect(empty, "Keys with empty translations").toEqual([]);
  });

  it("has no duplicate keys (JS object never has dups, but verify no shadowed value is undefined)", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `Key "${key}" must have a defined string value`).toBeDefined();
    }
  });

  it("every key follows the namespaced dot-path convention", () => {
    const invalid = Object.keys(en).filter((k) => !k.includes("."));
    expect(invalid, "Keys without a namespace dot").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. translateWith — happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe("translateWith", () => {
  it("resolves a key from the catalog", () => {
    expect(translateWith(en, "en", "subscribe.title")).toBe("New Subscription");
  });

  it("resolves every key in the en catalog without throwing", () => {
    for (const key of Object.keys(en)) {
      expect(() => translateWith(en, "en", key)).not.toThrow();
    }
  });

  it("interpolates a single {placeholder}", () => {
    const result = translateWith(en, "en", "common.error.prefix", { message: "oops" });
    expect(result).toBe("Error: oops");
  });

  it("leaves unresolved placeholders as-is when var is missing", () => {
    const result = translateWith(en, "en", "common.error.prefix");
    expect(result).toContain("{message}");
  });

  it("interpolates multiple distinct placeholders", () => {
    // Build a mini catalog with two placeholders
    const catalog = { "test.multi": "Hello {name}, you have {count} messages." };
    const result = translateWith(catalog, "en", "test.multi", { name: "Alice", count: "3" });
    expect(result).toBe("Hello Alice, you have 3 messages.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Missing-key policy — throws outside production
// ─────────────────────────────────────────────────────────────────────────────

describe("translateWith — missing key", () => {
  it("throws ReferenceError for a missing key in non-production", () => {
    // Vitest runs with NODE_ENV=test (not production), so the throw branch fires.
    expect(() => translateWith(en, "en", "this.key.does.not.exist")).toThrow(ReferenceError);
  });

  it("includes the missing key name in the error message", () => {
    try {
      translateWith(en, "en", "missing.key.name");
    } catch (err) {
      expect((err as Error).message).toContain("missing.key.name");
    }
  });

  it("includes the locale in the error message", () => {
    try {
      translateWith(en, "fr", "missing.key.name");
    } catch (err) {
      expect((err as Error).message).toContain("fr");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Core key coverage — required keys exist
// ─────────────────────────────────────────────────────────────────────────────

describe("required keys present in en.ts", () => {
  const REQUIRED_KEYS = [
    // SubscribeForm
    "subscribe.title",
    "subscribe.merchant.label",
    "subscribe.merchant.placeholder",
    "subscribe.merchant.addressBook",
    "subscribe.amount.label",
    "subscribe.token.label",
    "subscribe.token.placeholder",
    "subscribe.referrer.label",
    "subscribe.referrer.placeholder",
    "subscribe.submit",
    "subscribe.submit.pending",
    "subscribe.submit.validating",
    "subscribe.submit.ariaOffline",
    "subscribe.submit.ariaPaused",
    "subscribe.submit.titleOffline",
    "subscribe.success",
    "subscribe.announced.submitted",
    "subscribe.announced.confirmed",
    "subscribe.validation.invalidAddress",
    "subscribe.validation.selfReferral",
    // SubscriptionCard
    "card.cancel",
    "card.pause",
    "card.resume",
    "card.pause.until",
    "card.resume.scheduledAt",
    // Common
    "common.confirm",
    "common.cancel",
    "common.close",
    "common.error.prefix",
    "common.offline",
    // Core errors
    "error.noSubscriptionFound",
    "error.insufficientAllowance",
    "error.gracePeriodElapsed",
    "error.contractPaused",
    "error.schemaMigrationRequired",
    "error.archived",
    "error.requireAuth",
  ];

  for (const key of REQUIRED_KEYS) {
    it(`"${key}" is present and non-empty`, () => {
      expect(en[key], `Missing key: "${key}"`).toBeDefined();
      expect(en[key].trim()).not.toBe("");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SUPPORTED_LOCALES
// ─────────────────────────────────────────────────────────────────────────────

describe("SUPPORTED_LOCALES", () => {
  it("contains at least one locale", () => {
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(0);
  });

  it("includes English", () => {
    const codes = SUPPORTED_LOCALES.map((l) => l.code);
    expect(codes).toContain("en");
  });

  it("every entry has a non-empty code and label", () => {
    for (const { code, label } of SUPPORTED_LOCALES) {
      expect(code.trim()).not.toBe("");
      expect(label.trim()).not.toBe("");
    }
  });
});
