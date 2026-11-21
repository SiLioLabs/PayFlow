/**
 * batch-optimizer.test.ts — unit tests for the batch optimizer's pure logic.
 *
 * `prioritizeReady` decides which subscribers the keeper charges first, and
 * `chunkBatches` decides how they are grouped into `batch_charge` calls. Both
 * are pure, and both decide where real money moves, so they are pinned here
 * rather than only exercised through the network path.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_BATCH,
  GRACE_URGENCY_FRACTION,
  MAX_BATCH_SIZE_CEILING,
  clampMaxBatchSize,
  computeGraceState,
  isChargeableSubscription,
  prioritizeReady,
  chunkBatches,
  resolveMaxBatchSize,
  toReadySubscriber,
  type ReadySubscriber,
} from "../batch-optimizer.js";

/** Build a ReadySubscriber with sensible defaults. */
function ready(overrides: Partial<ReadySubscriber> = {}): ReadySubscriber {
  return {
    address: "GAAA",
    next_charge_at: 1_000,
    overdue_seconds: 0,
    grace_remaining_seconds: null,
    approaching_grace_expiry: false,
    urgency_score: 0,
    ...overrides,
  };
}

describe("constants", () => {
  it("mirrors the contract's batch defaults", () => {
    expect(DEFAULT_MAX_BATCH).toBe(50);
    expect(MAX_BATCH_SIZE_CEILING).toBe(200);
    expect(GRACE_URGENCY_FRACTION).toBe(0.25);
  });
});

describe("clampMaxBatchSize / resolveMaxBatchSize", () => {
  it("clamps a batch size to the contract ceiling of 200", () => {
    expect(clampMaxBatchSize(201)).toBe(200);
    expect(clampMaxBatchSize(1_000)).toBe(200);
    expect(clampMaxBatchSize(200)).toBe(200);
  });

  it("never returns less than one", () => {
    expect(clampMaxBatchSize(0)).toBe(1);
    expect(clampMaxBatchSize(-5)).toBe(1);
  });

  it("keeps a valid size untouched", () => {
    expect(clampMaxBatchSize(50)).toBe(50);
    expect(clampMaxBatchSize(199)).toBe(199);
  });

  it("uses the env override when one is set", () => {
    expect(resolveMaxBatchSize(25, 100)).toBe(25);
  });

  it("uses the on-chain value when there is no env override", () => {
    expect(resolveMaxBatchSize(undefined, 100)).toBe(100);
    expect(resolveMaxBatchSize(undefined, 0)).toBe(DEFAULT_MAX_BATCH);
    expect(resolveMaxBatchSize(undefined, undefined)).toBe(DEFAULT_MAX_BATCH);
  });

  it("clamps the resolved size to the ceiling", () => {
    expect(resolveMaxBatchSize(undefined, 500)).toBe(200);
    expect(resolveMaxBatchSize(500, undefined)).toBe(200);
  });
});

describe("computeGraceState", () => {
  const GRACE = 1_000;

  it("reports no grace window when the grace period is zero", () => {
    const state = computeGraceState(1_000, 2_000, 0);
    expect(state.grace_remaining_seconds).toBeNull();
    expect(state.approaching_grace_expiry).toBe(false);
  });

  it("is urgent exactly at the 25% threshold", () => {
    // 250 seconds left of a 1000 second window == 25% remaining.
    const state = computeGraceState(0, 750, GRACE);
    expect(state.grace_remaining_seconds).toBe(250);
    expect(state.approaching_grace_expiry).toBe(true);
  });

  it("is not urgent just above the 25% threshold", () => {
    const state = computeGraceState(0, 749, GRACE);
    expect(state.grace_remaining_seconds).toBe(251);
    expect(state.approaching_grace_expiry).toBe(false);
  });

  it("is urgent when the grace window has already closed", () => {
    const state = computeGraceState(0, 5_000, GRACE);
    expect(state.grace_remaining_seconds).toBe(0);
    expect(state.approaching_grace_expiry).toBe(true);
  });

  it("is not urgent with a full grace window left", () => {
    const state = computeGraceState(0, 0, GRACE);
    expect(state.grace_remaining_seconds).toBe(1_000);
    expect(state.approaching_grace_expiry).toBe(false);
  });
});

describe("isChargeableSubscription (not-due filtering)", () => {
  const base = { active: true, paused: false, last_charged: 0, interval: 60 };

  it("accepts an active, unpaused subscription", () => {
    expect(isChargeableSubscription(base)).toBe(true);
  });

  it("rejects a missing subscription", () => {
    expect(isChargeableSubscription(null)).toBe(false);
  });

  it("rejects an inactive (cancelled) subscription", () => {
    expect(isChargeableSubscription({ ...base, active: false })).toBe(false);
  });

  it("rejects a paused subscription", () => {
    expect(isChargeableSubscription({ ...base, paused: true })).toBe(false);
  });

  it("rejects a non-positive interval", () => {
    expect(isChargeableSubscription({ ...base, interval: 0 })).toBe(false);
    expect(isChargeableSubscription({ ...base, interval: -1 })).toBe(false);
  });
});

describe("toReadySubscriber", () => {
  const sub = { active: true, paused: false, last_charged: 1_000, interval: 600 };

  it("returns null for a subscription that must not be charged", () => {
    expect(toReadySubscriber("GAAA", null, 2_000, 0)).toBeNull();
    expect(
      toReadySubscriber("GAAA", { ...sub, paused: true }, 2_000, 0),
    ).toBeNull();
  });

  it("computes the next charge time and the overdue seconds", () => {
    const r = toReadySubscriber("GAAA", sub, 2_000, 0);
    expect(r).not.toBeNull();
    expect(r!.next_charge_at).toBe(1_600);
    expect(r!.overdue_seconds).toBe(400);
    expect(r!.grace_remaining_seconds).toBeNull();
    expect(r!.approaching_grace_expiry).toBe(false);
  });

  it("never reports negative overdue seconds", () => {
    const r = toReadySubscriber("GAAA", sub, 500, 0);
    expect(r!.overdue_seconds).toBe(0);
  });

  it("carries the urgency score through", () => {
    const r = toReadySubscriber("GAAA", sub, 2_000, 0, 42);
    expect(r!.urgency_score).toBe(42);
  });
});

describe("prioritizeReady", () => {
  it("does not mutate its input", () => {
    const input = [ready({ address: "GB" }), ready({ address: "GA" })];
    const copy = [...input];
    prioritizeReady(input);
    expect(input).toEqual(copy);
  });

  it("puts the higher urgency score first", () => {
    const low = ready({ address: "GLOW", urgency_score: 1 });
    const high = ready({ address: "GHIGH", urgency_score: 9 });
    const out = prioritizeReady([low, high]);
    expect(out.map((r) => r.address)).toEqual(["GHIGH", "GLOW"]);
  });

  it("puts a grace-approaching subscriber before a non-approaching one", () => {
    const normal = ready({
      address: "GNORMAL",
      approaching_grace_expiry: false,
      grace_remaining_seconds: 900,
      overdue_seconds: 10_000,
    });
    const urgent = ready({
      address: "GURGENT",
      approaching_grace_expiry: true,
      grace_remaining_seconds: 100,
      overdue_seconds: 0,
    });
    const out = prioritizeReady([normal, urgent]);
    expect(out.map((r) => r.address)).toEqual(["GURGENT", "GNORMAL"]);
  });

  it("charges the closest grace expiry first", () => {
    const far = ready({
      address: "GFAR",
      approaching_grace_expiry: true,
      grace_remaining_seconds: 200,
    });
    const near = ready({
      address: "GNEAR",
      approaching_grace_expiry: true,
      grace_remaining_seconds: 10,
    });
    const out = prioritizeReady([far, near]);
    expect(out.map((r) => r.address)).toEqual(["GNEAR", "GFAR"]);
  });

  it("falls back to most-overdue first when the grace state is the same", () => {
    const less = ready({ address: "GLESS", overdue_seconds: 10 });
    const more = ready({ address: "GMORE", overdue_seconds: 500 });
    const out = prioritizeReady([less, more]);
    expect(out.map((r) => r.address)).toEqual(["GMORE", "GLESS"]);
  });

  it("breaks a full tie on the address, so the order is deterministic", () => {
    const b = ready({ address: "GB" });
    const a = ready({ address: "GA" });
    const out = prioritizeReady([b, a]);
    expect(out.map((r) => r.address)).toEqual(["GA", "GB"]);
  });

  it("treats a missing urgency score as zero", () => {
    const withScore = ready({ address: "GSCORE", urgency_score: 5 });
    const withoutScore = ready({
      address: "NOSCORE",
      urgency_score: undefined,
    });
    const out = prioritizeReady([withoutScore, withScore]);
    expect(out.map((r) => r.address)).toEqual(["GSCORE", "NOSCORE"]);
  });

  it("handles an empty list", () => {
    expect(prioritizeReady([])).toEqual([]);
  });
});

describe("chunkBatches", () => {
  const many = (n: number): ReadySubscriber[] =>
    Array.from({ length: n }, (_, i) => ready({ address: `G${i}` }));

  it("splits the scheduled users into batches of the requested size", () => {
    const { batches, deferred } = chunkBatches(many(120), 50, 1_000);
    expect(batches).toHaveLength(3);
    expect(batches[0].users).toHaveLength(50);
    expect(batches[1].users).toHaveLength(50);
    expect(batches[2].users).toHaveLength(20);
    expect(deferred).toHaveLength(0);
  });

  it("numbers the batches from one", () => {
    const { batches } = chunkBatches(many(120), 50, 1_000);
    expect(batches.map((b) => b.batch)).toEqual([1, 2, 3]);
  });

  it("reports the number of users in each batch", () => {
    const { batches } = chunkBatches(many(5), 2, 1_000);
    expect(batches.map((b) => b.estimated_success_count)).toEqual([2, 2, 1]);
  });

  it("defers the users beyond the cycle cap", () => {
    const { batches, deferred } = chunkBatches(many(120), 50, 60);
    expect(batches).toHaveLength(2);
    expect(deferred).toHaveLength(60);
    expect(deferred[0].address).toBe("G60");
  });

  it("keeps the default batch size of 50", () => {
    const { batches } = chunkBatches(many(50), DEFAULT_MAX_BATCH, 1_000);
    expect(batches).toHaveLength(1);
    expect(batches[0].users).toHaveLength(50);
  });

  it("never produces a batch larger than the ceiling", () => {
    const { batches } = chunkBatches(many(250), MAX_BATCH_SIZE_CEILING, 1_000);
    expect(batches).toHaveLength(2);
    expect(batches[0].users).toHaveLength(200);
    expect(batches[1].users).toHaveLength(50);
  });

  it("treats a non-positive batch size as one", () => {
    const { batches } = chunkBatches(many(3), 0, 1_000);
    expect(batches).toHaveLength(3);
    expect(batches.every((b) => b.users.length === 1)).toBe(true);
  });

  it("handles an empty list", () => {
    const { batches, deferred } = chunkBatches([], 50, 1_000);
    expect(batches).toEqual([]);
    expect(deferred).toEqual([]);
  });
});
