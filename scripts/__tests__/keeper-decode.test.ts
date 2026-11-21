/**
 * keeper-decode.test.ts — off-chain conformance test for the `ChargeResult`
 * decoder.
 *
 * `ChargeResult` is a fieldless `#[contracttype]` enum, so it travels on the
 * wire as an `scvU32` discriminant — not as a symbol. The keeper decodes those
 * discriminants back into variant names, and the variant that says "funds
 * moved" decides whether the keeper counts a subscriber as charged.
 *
 * This test pins three things at once:
 *
 *   1. the decoder reads real `ChargeResult` payloads (from
 *      `scripts/fixtures/charge-results.json`),
 *   2. the fixture's discriminants still match the contract source
 *      (`contract/src/batch.rs`), and
 *   3. the decoder's own variant table still matches the contract source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

import { CHARGE_RESULT_NAMES, decodeEnumVec, resolveEffectiveBatchSize } from "../keeper.js";

const scriptsDir = fileURLToPath(new URL("..", import.meta.url));
const contractSrcDir = fileURLToPath(new URL("../../contract/src/", import.meta.url));

interface Fixture {
  variants: { discriminant: number; name: string; single_xdr_base64: string }[];
  vectors: {
    name: string;
    description: string;
    xdr_base64: string;
    expected: string[];
  }[];
  no_result: { name: string; xdr_base64: string };
}

const fixture: Fixture = JSON.parse(
  readFileSync(`${scriptsDir}fixtures/charge-results.json`, "utf8"),
);

/** The `ChargeResult` variants in declaration order, read from the contract. */
function contractVariants(): string[] {
  const src = readFileSync(`${contractSrcDir}batch.rs`, "utf8");
  const m = /pub enum ChargeResult\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error("ChargeResult not found in contract/src/batch.rs");
  return m[1]
    .split("\n")
    .map((line) => /^\s{4}([A-Z][A-Za-z0-9]*),?\s*$/.exec(line)?.[1] ?? "")
    .filter(Boolean);
}

describe("ChargeResult contract conformance", () => {
  it("the decoder's variant table matches contract/src/batch.rs", () => {
    expect([...CHARGE_RESULT_NAMES]).toEqual(contractVariants());
  });

  it("the fixture's discriminants match contract/src/batch.rs", () => {
    const fromContract = contractVariants();
    expect(fixture.variants.map((v) => v.name)).toEqual(fromContract);
    fixture.variants.forEach((variant, index) => {
      expect(variant.discriminant).toBe(index);
    });
  });

  it("the contract's decode-compatibility note lists the same discriminants", () => {
    const src = readFileSync(`${contractSrcDir}batch.rs`, "utf8");
    // The comment block above the enum documents each discriminant.
    for (const variant of fixture.variants) {
      const re = new RegExp(
        `^\\s*//\\s+${variant.name}\\s+= ${variant.discriminant}\\s*$`,
        "m",
      );
      expect(src).toMatch(re);
    }
  });
});

describe("decodeEnumVec", () => {
  it("decodes a real ChargeResult vector", () => {
    for (const vector of fixture.vectors) {
      const retval = xdr.ScVal.fromXDR(vector.xdr_base64, "base64");
      expect(decodeEnumVec(retval)).toEqual(vector.expected);
    }
  });

  it("decodes a single ChargeResult discriminant", () => {
    for (const variant of fixture.variants) {
      const single = xdr.ScVal.fromXDR(variant.single_xdr_base64, "base64");
      // A bare scvU32 is not a valid return value — the contract always
      // returns a vector — so wrap it to decode a one-address batch.
      const retval = xdr.ScVal.scvVec([single]);
      expect(decodeEnumVec(retval)).toEqual([variant.name]);
    }
  });

  it("recognises 'Charged' as the variant that moves funds", () => {
    const retval = xdr.ScVal.fromXDR(
      fixture.vectors.find((v) => v.name === "documented_example")!.xdr_base64,
      "base64",
    );
    const decoded = decodeEnumVec(retval);
    expect(decoded[0]).toBe("Charged");
    // The whole point of the fix: a charged subscriber must not be reported as
    // a skip just because the payload is a u32 and not a symbol.
    expect(decoded.filter((d) => d === "Charged")).toHaveLength(1);
  });

  it("keeps the result vector index-aligned with the input addresses", () => {
    const retval = xdr.ScVal.fromXDR(
      fixture.vectors.find((v) => v.name === "all_variants")!.xdr_base64,
      "base64",
    );
    const decoded = decodeEnumVec(retval);
    expect(decoded).toHaveLength(7);
    expect(decoded[6]).toBe("AllowanceInsufficient");
  });

  it("returns an empty list for a void result (an aborted invocation)", () => {
    const retval = xdr.ScVal.fromXDR(fixture.no_result.xdr_base64, "base64");
    expect(retval.switch().name).toBe("scvVoid");
    expect(decodeEnumVec(retval)).toEqual([]);
  });

  it("returns an empty list for an empty batch", () => {
    const retval = xdr.ScVal.fromXDR(
      fixture.vectors.find((v) => v.name === "empty_batch")!.xdr_base64,
      "base64",
    );
    expect(decodeEnumVec(retval)).toEqual([]);
  });

  it("reports an unknown discriminant instead of guessing", () => {
    // A future contract version that appends variant 7.
    const retval = xdr.ScVal.scvVec([xdr.ScVal.scvU32(7)]);
    const decoded = decodeEnumVec(retval);
    expect(decoded).toEqual(["Unknown(7)"]);
    // "not charged" is the safe direction: the keeper must not treat it as a
    // successful transfer.
    expect(decoded[0]).not.toBe("Charged");
  });

  it("still accepts a legacy symbol payload", () => {
    const retval = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Charged")]);
    expect(decodeEnumVec(retval)).toEqual(["Charged"]);
  });

  it("returns an empty list when the value is not a vector", () => {
    expect(decodeEnumVec(xdr.ScVal.scvU32(0))).toEqual([]);
  });
});

describe("resolveEffectiveBatchSize", () => {
  it("uses the default of 50 when no override is set", () => {
    expect(resolveEffectiveBatchSize(undefined, undefined)).toBe(50);
    expect(resolveEffectiveBatchSize(0, undefined)).toBe(50);
    expect(resolveEffectiveBatchSize(-1, undefined)).toBe(50);
  });

  it("keeps the operator value when it is below the on-chain maximum", () => {
    expect(resolveEffectiveBatchSize(25, 100)).toBe(25);
  });

  it("narrows the operator value to the live on-chain maximum", () => {
    expect(resolveEffectiveBatchSize(100, 40)).toBe(40);
  });

  it("leaves the value un-narrowed when the on-chain read failed", () => {
    expect(resolveEffectiveBatchSize(100, undefined)).toBe(100);
    expect(resolveEffectiveBatchSize(100, 0)).toBe(100);
  });

  it("never exceeds the 200 hard ceiling", () => {
    expect(resolveEffectiveBatchSize(500, undefined)).toBe(200);
    expect(resolveEffectiveBatchSize(500, 1000)).toBe(200);
  });

  it("never returns less than one", () => {
    expect(resolveEffectiveBatchSize(undefined, 0)).toBe(50);
    expect(resolveEffectiveBatchSize(1, 1)).toBe(1);
  });
});
