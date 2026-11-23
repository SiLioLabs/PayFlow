import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBundleSizes } from "./check-bundle-size.mjs";

describe("evaluateBundleSizes", () => {
  it("applies vendor-specific budgets and the fallback to each chunk", () => {
    const results = evaluateBundleSizes([
      { name: "stellar-sdk-abc.js", size: 450 * 1024 },
      { name: "react-vendor-def.js", size: 190 * 1024 },
      { name: "index-ghi.js", size: 290 * 1024 },
    ]);

    assert.deepEqual(results.map(({ budget, overBudget }) => [budget, overBudget]), [
      [500 * 1024, false],
      [200 * 1024, false],
      [300 * 1024, false],
    ]);
  });

  it("flags a chunk that exceeds its per-chunk budget", () => {
    const results = evaluateBundleSizes([{ name: "stellar-sdk-abc.js", size: 500 * 1024 + 1 }]);

    assert.equal(results[0].overBudget, true);
  });
});
