/**
 * Conformance test: CONTRACT_ERRORS table vs contract/src/errors.rs
 *
 * `contract/src/errors.rs` is the canonical source for every numeric code. This
 * suite parses it and asserts the frontend map agrees with it:
 *  1. errors.rs itself has no duplicate numeric codes.
 *  2. Every code in the catalog has exactly one canonical `error(contract, #N)`
 *     key in CONTRACT_ERRORS — including the deprecated and reserved ones, which
 *     are documented rather than dropped.
 *  3. Every canonical key resolves to exactly one message: the bare-code aliases
 *     repeat their code's message verbatim, so a code can never be reported to
 *     the user with two different strings.
 *  4. `friendlyError` actually reaches that message for each code (catches keys
 *     that are shadowed by an earlier substring match, or that can never match
 *     because they are not lowercased).
 *  5. Counts are exact: the codes covered are 1..MAX_CODE with no duplicates.
 *
 * To fix a failure:
 *  - Missing contract code  → add `"error(contract, #N)": "..."` to errors.ts
 *  - Contradictory messages → make the alias/canonical pair use one wording
 *  - New code in errors.rs   → add the message, the table row in the errors.ts
 *                             header comment, and nothing else
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { CONTRACT_ERRORS, friendlyError } from "./errors";

// ---------------------------------------------------------------------------
// Parse errors.rs
// ---------------------------------------------------------------------------

/** Resolve the contract source relative to this file's location */
const ERRORS_RS = path.resolve(
  __dirname,
  "../../../contract/src/errors.rs"
);

interface ContractVariant {
  name: string;
  code: number;
  deprecated: boolean;
}

function parseContractErrors(): ContractVariant[] {
  const src = fs.readFileSync(ERRORS_RS, "utf-8");
  const variants: ContractVariant[] = [];

  // Match optional #[deprecated...] attribute immediately before a variant line.
  // Pattern: optional `#[deprecated...]` then `VariantName = N,`
  const variantRe =
    /(#\[deprecated[^\]]*\]\s*)?(\w+)\s*=\s*(\d+)\s*,/g;

  let match: RegExpExecArray | null;
  while ((match = variantRe.exec(src)) !== null) {
    const deprecated = Boolean(match[1]);
    const name = match[2];
    const code = parseInt(match[3], 10);
    // Skip the repr attribute itself (e.g. `#[repr(u32)]` isn't a variant, but
    // the regex won't match it because it has no `= N,` form).
    variants.push({ name, code, deprecated });
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Codes with no ContractError variant
// ---------------------------------------------------------------------------

/**
 * Codes that CONTRACT_ERRORS maps but errors.rs does not define, with the
 * reason. Kept explicit so a stray key fails the test instead of hiding.
 */
const RESERVED_CODES: Record<number, string> = {
  37: "Historical gap in the error catalog; no variant claims this code and none is planned.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The canonical key format used in CONTRACT_ERRORS for numeric codes */
const canonicalKey = (code: number) => `error(contract, #${code})`;

/** Every canonical key present in the map, with its code. */
function canonicalEntries(): { key: string; code: number; message: string }[] {
  return Object.entries(CONTRACT_ERRORS)
    .filter(([key]) => /^error\(contract, #\d+\)$/.test(key))
    .map(([key, message]) => ({
      key,
      code: parseInt(key.match(/#(\d+)/)![1], 10),
      message,
    }));
}

/** Bare-code aliases, e.g. "#18". */
function bareAliases(): { key: string; code: number; message: string }[] {
  return Object.entries(CONTRACT_ERRORS)
    .filter(([key]) => /^#\d+$/.test(key))
    .map(([key, message]) => ({
      key,
      code: parseInt(key.slice(1), 10),
      message,
    }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CONTRACT_ERRORS conformance with contract/src/errors.rs", () => {
  const variants = parseContractErrors();
  const canonical = canonicalEntries();

  it("parses at least one variant from errors.rs", () => {
    expect(variants.length).toBeGreaterThan(0);
  });

  it("has no duplicate numeric codes in errors.rs itself", () => {
    const seen = new Map<number, string>();
    const dupes: string[] = [];
    for (const v of variants) {
      if (seen.has(v.code)) {
        dupes.push(`code ${v.code}: ${seen.get(v.code)} vs ${v.name}`);
      } else {
        seen.set(v.code, v.name);
      }
    }
    expect(dupes, "Duplicate codes in errors.rs").toEqual([]);
  });

  it("has no duplicate canonical keys in CONTRACT_ERRORS", () => {
    // CONTRACT_ERRORS is a plain object so JS already deduplicates keys at
    // parse time – the last writer wins silently.  We detect that by counting
    // how many `error(contract, #N)` keys exist vs how many unique codes there
    // are.
    const numericKeys = canonical.map((c) => c.key);
    const uniqueCodes = new Set(numericKeys);
    expect(
      numericKeys.length,
      "Duplicate canonical keys in CONTRACT_ERRORS (last-writer-wins silently)"
    ).toBe(uniqueCodes.size);
  });

  it("covers exactly codes 1..MAX_CODE, each once", () => {
    const codes = canonical.map((c) => c.code).sort((a, b) => a - b);
    const maxCode = Math.max(
      ...variants.map((v) => v.code),
      ...Object.keys(RESERVED_CODES).map(Number)
    );
    const expected = Array.from({ length: maxCode }, (_, i) => i + 1);

    expect(
      codes,
      "CONTRACT_ERRORS must hold one canonical key per code, 1..MAX_CODE, " +
        "so no code can be missing or mapped twice"
    ).toEqual(expected);
  });

  it("has a non-empty message for every canonical key", () => {
    const empty = canonical.filter((c) => c.message.trim() === "").map((c) => c.key);
    expect(empty, "Canonical keys with an empty message").toEqual([]);
  });

  it("uses lowercase keys so friendlyError can match them at all", () => {
    // `friendlyError` lowercases the raw error before matching, so a
    // capitalised key such as "error(Contract, #18)" is dead code — and is how
    // code 18 ended up carrying a second, contradictory message.
    const nonLowercase = Object.keys(CONTRACT_ERRORS).filter((key) => key !== key.toLowerCase());
    expect(nonLowercase, "Keys that can never match: friendlyError lowercases the input").toEqual(
      []
    );
  });

  describe("every contract code has a UI mapping", () => {
    for (const { name, code } of variants) {
      it(`code ${code} (${name}) → "${canonicalKey(code)}"`, () => {
        expect(
          CONTRACT_ERRORS[canonicalKey(code)],
          `Missing entry for ${name} (code ${code}). ` +
            `Add \`"${canonicalKey(code)}": "..."\` to errors.ts.`
        ).toBeDefined();
      });
    }
  });

  describe("deprecated / reserved codes are mapped, not silently dropped", () => {
    const deprecatedVariants = variants.filter((v) => v.deprecated);

    it("errors.rs still declares the deprecated wire-compat codes", () => {
      expect(
        deprecatedVariants.map((v) => v.code).sort((a, b) => a - b),
        "The deprecated codes this test documents changed; update this file and the errors.ts header table."
      ).toEqual([30, 31]);
    });

    for (const { name, code } of deprecatedVariants) {
      it(`deprecated ${name} (code ${code}) has a documented message`, () => {
        const message = CONTRACT_ERRORS[canonicalKey(code)];
        expect(
          message,
          `Deprecated variant ${name} (code ${code}) must stay mapped: a legacy ` +
            `deployment can still emit it, and an unmapped code reaches the user ` +
            `as raw panic text.`
        ).toBeDefined();
        expect(message).not.toContain("undefined");
      });
    }

    it("code 30 (deprecated alias of ContractPaused) reuses code 18's message", () => {
      expect(CONTRACT_ERRORS[canonicalKey(30)]).toBe(CONTRACT_ERRORS[canonicalKey(18)]);
    });
  });

  it("canonical keys with no contract variant are the documented reserved ones", () => {
    const knownCodes = new Set(variants.map((v) => v.code));
    const unmappedSource = canonical
      .map((c) => c.code)
      .filter((code) => !knownCodes.has(code))
      .sort((a, b) => a - b);

    expect(
      unmappedSource,
      "Add the code to RESERVED_CODES (with a reason) or remove the key from errors.ts"
    ).toEqual(
      Object.keys(RESERVED_CODES)
        .map(Number)
        .sort((a, b) => a - b)
    );
  });

  it("RESERVED_CODES entries all have a message in errors.ts", () => {
    for (const [code, reason] of Object.entries(RESERVED_CODES)) {
      expect(
        CONTRACT_ERRORS[canonicalKey(Number(code))],
        `Reserved code ${code} (${reason}) must still be mapped`
      ).toBeDefined();
    }
  });

  describe("one message per code (aliases never contradict the canonical key)", () => {
    for (const { code } of canonical) {
      it(`code ${code}: bare-code aliases repeat the canonical message`, () => {
        const canonicalMessage = CONTRACT_ERRORS[canonicalKey(code)];
        const mismatched = bareAliases()
          .filter((a) => a.code === code)
          .filter((a) => a.message !== canonicalMessage)
          .map((a) => a.key);

        expect(
          mismatched,
          `Alias(es) for code ${code} report a different message than ` +
            `"${canonicalKey(code)}" — the same code must never reach the user twice.`
        ).toEqual([]);
      });
    }
  });

  describe("bare-code aliases cannot shadow a longer code", () => {
    // `friendlyError` matches by substring, so a bare "#2" would also match
    // "error(contract, #24)" and report the wrong condition.
    it("every bare alias is at least as long as the codes it would shadow", () => {
      const codes = canonical.map((c) => c.code);
      const unsafe = bareAliases()
        .filter((a) =>
          codes.some((code) => code !== a.code && String(code).startsWith(String(a.code)))
        )
        .map((a) => a.key);

      expect(
        unsafe,
        "Bare-code aliases whose digits prefix another code — drop them or use the canonical key"
      ).toEqual([]);
    });
  });

  describe("friendlyError resolves every code to its mapped message", () => {
    for (const { key, code, message } of canonical) {
      it(`code ${code} (${key})`, () => {
        // Both the Soroban wire form and the capitalised form clients log.
        expect(friendlyError(key)).toBe(message);
        expect(friendlyError(`Error(Contract, #${code})`)).toBe(message);
      });
    }
  });
});
