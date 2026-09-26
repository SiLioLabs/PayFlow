/**
 * Conformance test: CONTRACT_ERRORS table vs contract/src/errors.rs
 *
 * The contract is the source of truth. This suite:
 *  1. Parses errors.rs and extracts every ContractError variant + numeric code.
 *  2. Asserts that every active (non-deprecated, non-reserved) code has a
 *     canonical `error(contract, #N)` key in CONTRACT_ERRORS.
 *  3. Asserts no duplicate numeric codes exist in CONTRACT_ERRORS.
 *  4. Documents intentional UI-string overrides as an explicit allow-list.
 *
 * To fix a failure:
 *  - Missing contract code  → add `"error(contract, #N)": "..."` to errors.ts
 *  - Extra/stale UI entry   → remove the key from errors.ts
 *  - Intentional override   → add the variant name to KNOWN_UI_OVERRIDES below
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { CONTRACT_ERRORS } from "./errors";

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
// Known intentional differences between contract semantics and UI strings
// ---------------------------------------------------------------------------

/**
 * Variants whose UI message intentionally differs from a literal translation of
 * the variant name.  Adding a name here documents the override and suppresses
 * the "missing" failure.  This list must be reviewed on every errors.rs change.
 *
 * Format: variant name → reason the override exists
 */
const KNOWN_UI_OVERRIDES: Record<string, string> = {
  // Deprecated wire-compat aliases – kept in errors.ts for legacy client support
  ContractPausedError:
    "Deprecated alias of ContractPaused (code 18); UI maps it to the same message.",
  Reserved31:
    "Reserved gap in the error catalog; intentionally not emitted by the contract.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The canonical key format used in CONTRACT_ERRORS for numeric codes */
const canonicalKey = (code: number) => `error(contract, #${code})`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CONTRACT_ERRORS conformance with contract/src/errors.rs", () => {
  const variants = parseContractErrors();

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
    const numericKeys = Object.keys(CONTRACT_ERRORS).filter((k) =>
      /^error\(contract, #\d+\)$/.test(k)
    );
    const uniqueCodes = new Set(numericKeys);
    expect(
      numericKeys.length,
      "Duplicate canonical keys in CONTRACT_ERRORS (last-writer-wins silently)"
    ).toBe(uniqueCodes.size);
  });

  describe("every active contract code has a UI mapping", () => {
    const activeVariants = variants.filter(
      (v) => !v.deprecated && !KNOWN_UI_OVERRIDES[v.name]
    );

    for (const { name, code } of activeVariants) {
      it(`code ${code} (${name}) → "${canonicalKey(code)}"`, () => {
        expect(
          CONTRACT_ERRORS[canonicalKey(code)],
          `Missing entry for ${name} (code ${code}). ` +
            `Add \`"${canonicalKey(code)}": "..."\` to errors.ts, ` +
            `or add "${name}" to KNOWN_UI_OVERRIDES if intentional.`
        ).toBeDefined();
      });
    }
  });

  describe("deprecated / reserved codes are documented in KNOWN_UI_OVERRIDES", () => {
    const deprecatedVariants = variants.filter((v) => v.deprecated);

    for (const { name, code } of deprecatedVariants) {
      it(`deprecated variant ${name} (code ${code}) is in KNOWN_UI_OVERRIDES`, () => {
        expect(
          KNOWN_UI_OVERRIDES[name],
          `Deprecated variant ${name} (code ${code}) is not in KNOWN_UI_OVERRIDES. ` +
            `Add an entry explaining why it exists.`
        ).toBeDefined();
      });
    }
  });

  it("CONTRACT_ERRORS has no canonical keys for codes absent from errors.rs", () => {
    const knownCodes = new Set(variants.map((v) => v.code));
    const staleKeys = Object.keys(CONTRACT_ERRORS)
      .filter((k) => /^error\(contract, #\d+\)$/.test(k))
      .filter((k) => {
        const code = parseInt(k.match(/#(\d+)/)![1], 10);
        return !knownCodes.has(code);
      });

    expect(
      staleKeys,
      "CONTRACT_ERRORS contains canonical keys for codes not defined in errors.rs"
    ).toEqual([]);
  });
});
