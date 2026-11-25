/**
 * keeper-shutdown.test.ts — graceful-shutdown behavior for the keeper (#1474).
 *
 * The keeper must turn SIGTERM/SIGINT into a bounded drain: no new batch is
 * scheduled after the signal, the in-flight batch finishes, the DLQ and
 * metrics flush exactly once, and a drain that cannot finish inside
 * SHUTDOWN_TIMEOUT_MS reports failure instead of hanging. The generic
 * coordination lives in `lib/shutdown.ts`; the keeper-specific pieces
 * (`canScheduleNextBatch`, `flushDlq`) are imported from keeper.ts itself.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShutdownCoordinator, installShutdownSignals } from "../lib/shutdown.js";
import {
  canScheduleNextBatch,
  flushDlq,
  shutdown as keeperShutdown,
} from "../keeper.js";

describe("ShutdownCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains an in-flight batch before running cleanup steps", async () => {
    const target = new EventEmitter();
    const coordinator = new ShutdownCoordinator({ timeoutMs: 30_000 });
    const uninstall = installShutdownSignals(coordinator, { target });

    let finishBatch!: () => void;
    const batch = new Promise<void>((resolve) => {
      finishBatch = resolve;
    });
    coordinator.track(batch, "charge-cycle");

    const order: string[] = [];
    target.emit("SIGTERM");
    expect(coordinator.shutdownRequested).toBe(true);
    expect(coordinator.signal).toBe("SIGTERM");

    const cleanup = coordinator.runCleanup([
      { name: "dlq-flush", run: () => void order.push("dlq-flush") },
      { name: "metrics-flush", run: () => void order.push("metrics-flush") },
    ]);

    // The batch is still in flight: no flush may have run yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);

    finishBatch();
    const result = await cleanup;
    expect(result.completed).toBe(true);
    expect(order).toEqual(["dlq-flush", "metrics-flush"]);

    const drain = await coordinator.waitForDrain();
    expect(drain.drained).toBe(true);
    expect(drain.failures).toEqual([]);

    uninstall();
    expect(target.listenerCount("SIGTERM")).toBe(0);
  });

  it("treats repeat SIGTERM/SIGINT as one shutdown with one deadline timer", async () => {
    vi.useFakeTimers();
    const target = new EventEmitter();
    const coordinator = new ShutdownCoordinator({ timeoutMs: 5_000 });
    const uninstall = installShutdownSignals(coordinator, { target });

    target.emit("SIGTERM");
    expect(vi.getTimerCount()).toBe(1);

    target.emit("SIGTERM");
    target.emit("SIGINT");
    expect(vi.getTimerCount()).toBe(1);
    expect(coordinator.signal).toBe("SIGTERM");

    const step = vi.fn();
    const first = await coordinator.runCleanup([{ name: "dlq-flush", run: step }]);
    const second = await coordinator.runCleanup([{ name: "dlq-flush", run: step }]);
    expect(step).toHaveBeenCalledTimes(1);
    expect(first).toBe(second); // repeat calls reuse the single cleanup run
    expect(vi.getTimerCount()).toBe(0); // dispose() cleared the deadline

    uninstall();
  });

  it("stops waiting at the deadline, reports pending labels, and times out once", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const coordinator = new ShutdownCoordinator({
      timeoutMs: 1_000,
      onTimeout,
    });

    const stuck = new Promise<void>(() => {});
    coordinator.track(stuck, "charge-cycle");
    coordinator.requestShutdown("SIGTERM");

    const drainPromise = coordinator.waitForDrain();
    vi.advanceTimersByTime(1_000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith({
      signal: "SIGTERM",
      timeoutMs: 1_000,
      pending: ["charge-cycle"],
    });

    vi.advanceTimersByTime(10_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    const drain = await drainPromise;
    expect(drain.timedOut).toBe(true);
    expect(drain.drained).toBe(false);
    expect(drain.pending).toEqual(["charge-cycle"]);
    expect(coordinator.timedOut).toBe(true);
  });

  it("surfaces a batch that rejects while draining instead of swallowing it", async () => {
    const coordinator = new ShutdownCoordinator({ timeoutMs: 30_000 });
    const failing = Promise.reject(new Error("submission failed"));
    const tracked = coordinator.track(failing, "charge-cycle");
    tracked.catch(() => {}); // the rejection is asserted through waitForDrain
    coordinator.requestShutdown("SIGTERM");

    const drain = await coordinator.waitForDrain();
    expect(drain.failures).toHaveLength(1);
    expect(drain.failures[0].label).toBe("charge-cycle");
    expect((drain.failures[0].error as Error).message).toBe("submission failed");
    expect(drain.drained).toBe(true); // settled (rejected): nothing pending
    expect(drain.pending).toEqual([]);
  });

  it("notifies onShutdownStart once, immediately for late subscribers, and honours unsubscribe", () => {
    const coordinator = new ShutdownCoordinator({ timeoutMs: 1_000 });
    const early = vi.fn();
    const unsubscribe = coordinator.onShutdownStart(early);

    const dropped = vi.fn();
    coordinator.onShutdownStart(dropped)();
    coordinator.requestShutdown("SIGTERM");
    expect(early).toHaveBeenCalledTimes(1);
    expect(early).toHaveBeenCalledWith("SIGTERM");
    expect(dropped).not.toHaveBeenCalled();

    coordinator.requestShutdown("SIGINT"); // repeat: no second notification
    expect(early).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    coordinator.onShutdownStart(late);
    expect(late).toHaveBeenCalledWith("SIGTERM");

    unsubscribe();
    coordinator.dispose();
  });

  it("collects cleanup step failures and still runs later steps", async () => {
    const coordinator = new ShutdownCoordinator({ timeoutMs: 30_000 });
    const good = vi.fn();
    const result = await coordinator.runCleanup([
      {
        name: "dlq-flush",
        run: () => {
          throw new Error("disk full");
        },
      },
      { name: "metrics-flush", run: good },
    ]);
    expect(result.completed).toBe(false);
    expect(result.failed.map((entry) => entry.name)).toEqual(["dlq-flush"]);
    expect(good).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("drains immediately when nothing is in flight", async () => {
    const coordinator = new ShutdownCoordinator({ timeoutMs: 30_000 });
    const drain = await coordinator.waitForDrain();
    expect(drain).toEqual({
      drained: true,
      timedOut: false,
      failures: [],
      pending: [],
    });
    coordinator.dispose();
  });
});

describe("keeper shutdown integration", () => {
  let tmpDir: string;
  let previousDlqFile: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "payflow-shutdown-"));
    previousDlqFile = process.env.DLQ_FILE;
  });

  afterEach(() => {
    if (previousDlqFile === undefined) delete process.env.DLQ_FILE;
    else process.env.DLQ_FILE = previousDlqFile;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exposes an idle module-level coordinator for the keeper", () => {
    expect(keeperShutdown).toBeInstanceOf(ShutdownCoordinator);
    expect(keeperShutdown.shutdownRequested).toBe(false);
    expect(canScheduleNextBatch(keeperShutdown)).toBe(true);
  });

  it("blocks scheduling new batches once shutdown has been requested", () => {
    const coordinator = new ShutdownCoordinator({ timeoutMs: 30_000 });
    expect(canScheduleNextBatch(coordinator)).toBe(true);
    coordinator.requestShutdown("SIGTERM");
    expect(canScheduleNextBatch(coordinator)).toBe(false);

    // The gate takes any object exposing the flag, so both paging loops can
    // consult the module-level coordinator without threading state.
    expect(canScheduleNextBatch({ shutdownRequested: true })).toBe(false);
    expect(canScheduleNextBatch({ shutdownRequested: false })).toBe(true);
    coordinator.dispose();
  });

  it("flushDlq is a no-op when the DLQ file does not exist", () => {
    process.env.DLQ_FILE = path.join(tmpDir, "missing.jsonl");
    expect(() => flushDlq()).not.toThrow();
    expect(fs.existsSync(process.env.DLQ_FILE)).toBe(false);
  });

  it("flushDlq fsyncs an existing DLQ file without changing its contents", () => {
    const file = path.join(tmpDir, "failed-batches.jsonl");
    const line = `${JSON.stringify({ error: "allowance_insufficient" })}\n`;
    fs.writeFileSync(file, line, "utf8");
    process.env.DLQ_FILE = file;
    expect(() => flushDlq()).not.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(line);
  });
});
