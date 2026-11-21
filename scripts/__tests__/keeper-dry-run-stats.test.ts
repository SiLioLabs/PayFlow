/**
 * Tests for scripts/lib/dry-run-stats.ts — keeper dry-run result counting.
 */
import {
  addPageTally,
  tallyChargeResults,
  type CycleTally,
} from "../lib/dry-run-stats.js";

// Two pages as returned by get_batch_charge_estimate (index-aligned with users).
const pages = [
  {
    users: ["GA", "GB", "GC", "GD"],
    results: ["Charged", "NotDue", "Charged", "GracePeriodElapsed"],
    amounts: [10_000_000n, 25_000_000n],
  },
  {
    users: ["GE", "GF", "GG"],
    results: ["Charged", "NotDue", "InsufficientAllowance"],
    amounts: [5_000_000n],
  },
];

describe("tallyChargeResults", () => {
  it("counts each result in a page once", () => {
    const t = tallyChargeResults(pages[0].users, pages[0].results, pages[0].amounts);
    expect(t.charged).toBe(2);
    expect(t.totalVolume).toBe(35_000_000n);
    expect(t.skipCounts).toEqual({ NotDue: 1, GracePeriodElapsed: 1 });
    expect(t.candidates).toEqual([
      { user: "GA", result: "Charged", amountStroops: "10000000" },
      { user: "GB", result: "NotDue", amountStroops: "0" },
      { user: "GC", result: "Charged", amountStroops: "25000000" },
      { user: "GD", result: "GracePeriodElapsed", amountStroops: "0" },
    ]);
  });

  it("treats a missing amount as zero", () => {
    const t = tallyChargeResults(["GA"], ["Charged"], []);
    expect(t.charged).toBe(1);
    expect(t.totalVolume).toBe(0n);
  });
});

describe("addPageTally", () => {
  it("aggregated dry-run totals match the fixtures exactly (no double counting)", () => {
    const cycle: CycleTally = { totalCharged: 0, totalVolume: 0n, totalSkips: {}, candidates: [] };
    for (const p of pages) {
      addPageTally(cycle, tallyChargeResults(p.users, p.results, p.amounts));
    }

    expect(cycle.totalCharged).toBe(3);
    expect(cycle.totalVolume).toBe(40_000_000n);
    expect(cycle.totalSkips).toEqual({ NotDue: 2, GracePeriodElapsed: 1, InsufficientAllowance: 1 });
    expect(cycle.candidates).toHaveLength(7);
    expect(cycle.candidates.map((c) => c.user)).toEqual(["GA", "GB", "GC", "GD", "GE", "GF", "GG"]);
  });
});
