/**
 * lib/dry-run-stats.ts — Pure charge-result counting for keeper.ts.
 *
 * `tallyChargeResults` turns one page's index-aligned batch results into a
 * tally; `addPageTally` folds a page tally into a cycle total. Each result is
 * counted exactly once: once when the page is tallied, never again when pages
 * are aggregated.
 */

/** One subscriber's outcome within a cycle. */
export interface CandidateRecord {
  user: string;
  result: string;
  /** Subscription amount in stroops. "0" when the result is not Charged. */
  amountStroops: string;
}

export interface PageTally {
  charged: number;
  totalVolume: bigint;
  skipCounts: Record<string, number>;
  candidates: CandidateRecord[];
}

export interface CycleTally {
  totalCharged: number;
  totalVolume: bigint;
  totalSkips: Record<string, number>;
  candidates: CandidateRecord[];
}

/**
 * Tally one page of batch results. `results` is index-aligned with `users`;
 * `amounts` holds one entry per "Charged" result, in order.
 */
export function tallyChargeResults(
  users: string[],
  results: string[],
  amounts: bigint[],
): PageTally {
  const tally: PageTally = { charged: 0, totalVolume: 0n, skipCounts: {}, candidates: [] };
  let amountIdx = 0;
  for (let i = 0; i < results.length; i++) {
    const variant = results[i];
    const user = i < users.length ? users[i] : "unknown";

    if (variant === "Charged") {
      const amt = amountIdx < amounts.length ? amounts[amountIdx] : 0n;
      tally.charged++;
      tally.totalVolume += amt;
      tally.candidates.push({ user, result: variant, amountStroops: amt.toString() });
      amountIdx++;
    } else {
      tally.skipCounts[variant] = (tally.skipCounts[variant] || 0) + 1;
      tally.candidates.push({ user, result: variant, amountStroops: "0" });
    }
  }
  return tally;
}

/** Fold a page tally into the running cycle totals (mutates `cycle`). */
export function addPageTally(cycle: CycleTally, page: PageTally): void {
  cycle.totalCharged += page.charged;
  cycle.totalVolume += page.totalVolume;
  for (const [k, v] of Object.entries(page.skipCounts)) {
    cycle.totalSkips[k] = (cycle.totalSkips[k] || 0) + v;
  }
  cycle.candidates.push(...page.candidates);
}
