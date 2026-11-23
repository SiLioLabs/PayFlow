/**
 * lib/shutdown.ts — Idempotent, bounded graceful-shutdown coordination.
 *
 * Used by the keeper (keeper.ts) to turn SIGTERM / SIGINT into a safe drain:
 *
 *   1. The first signal flips `shutdownRequested` (so no new work is
 *      scheduled) and starts a hard deadline (`timeoutMs`).
 *   2. In-flight operations registered with `track()` keep running; the
 *      batch already being submitted/recorded is awaited to completion.
 *   3. `waitForDrain()` resolves when every tracked operation has settled or
 *      when the deadline fires — whichever comes first — and reports any
 *      rejections instead of swallowing them.
 *   4. `runCleanup()` runs the caller's flush steps (DLQ, metrics, ...) at
 *      most once, after the drain, no matter how many signals arrive.
 *
 * Repeat signals are recorded and logged but never re-trigger cleanup or a
 * second deadline timer, so the sequence is safe when SIGTERM and SIGINT are
 * both delivered (or the same signal twice).
 *
 * The module contains no keeper-specific logic and never calls
 * `process.exit`, so it can be unit tested with vitest fake timers and a
 * fake signal target (any EventEmitter-shaped object).
 */

/** The subset of the shared logger (logger.ts) this module needs. */
export interface ShutdownLogger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

/** One flush step executed by `runCleanup()` (e.g. DLQ flush, metrics stop). */
export interface CleanupStep {
  name: string;
  run: () => void | Promise<void>;
}

/** A tracked operation that rejected while draining. */
export interface DrainFailure {
  label: string;
  error: unknown;
}

export interface DrainResult {
  /** True when every tracked operation settled without timing out. */
  drained: boolean;
  /** True when the shutdown deadline elapsed before the drain finished. */
  timedOut: boolean;
  /** Rejections observed among the drained operations (never swallowed). */
  failures: DrainFailure[];
  /** Labels of operations still in flight when the drain stopped. */
  pending: string[];
}

export interface CleanupResult {
  /** True when every cleanup step ran without throwing. */
  completed: boolean;
  failed: Array<{ name: string; error: unknown }>;
}

export interface ShutdownTimeoutInfo {
  signal: string;
  timeoutMs: number;
  pending: string[];
}

export interface ShutdownCoordinatorOptions {
  /** Hard upper bound (ms) for the whole shutdown sequence. Must be > 0. */
  timeoutMs: number;
  logger?: ShutdownLogger;
  /**
   * Invoked exactly once when the deadline elapses before shutdown completed.
   * The keeper uses this to log, best-effort flush, and exit non-zero.
   */
  onTimeout?: (info: ShutdownTimeoutInfo) => void;
}

interface TrackedEntry {
  label: string;
  promise: Promise<unknown>;
}

const noopLogger: ShutdownLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Coordinates a single shutdown sequence.
 *
 * Lifecycle: `requestShutdown()` (from a signal) → drain via
 * `waitForDrain()` → `runCleanup()`. The deadline timer starts with the
 * first shutdown request and is cleared when cleanup finishes (or
 * `dispose()` is called).
 */
export class ShutdownCoordinator {
  private readonly timeoutMs: number;
  private readonly logger: ShutdownLogger;
  private readonly onTimeout?: (info: ShutdownTimeoutInfo) => void;

  private started = false;
  private firstSignal: string | null = null;
  private readonly signalsSeen: string[] = [];
  private timeoutHandle: NodeJS.Timeout | null = null;
  private timedOutFlag = false;
  private cleanupPromise: Promise<CleanupResult> | null = null;

  private readonly tracked = new Map<string, TrackedEntry>();
  private readonly labelCounts = new Map<string, number>();
  private readonly shutdownStartCallbacks = new Set<(signal: string) => void>();
  private readonly timeoutWaiters: Array<() => void> = [];

  constructor(options: ShutdownCoordinatorOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("ShutdownCoordinator: timeoutMs must be a positive number");
    }
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger ?? noopLogger;
    this.onTimeout = options.onTimeout;
  }

  /** True once any shutdown signal has been received. */
  get shutdownRequested(): boolean {
    return this.started;
  }

  /** The signal that initiated shutdown, or null. */
  get signal(): string | null {
    return this.firstSignal;
  }

  /** True once the shutdown deadline has elapsed. */
  get timedOut(): boolean {
    return this.timedOutFlag;
  }

  /** Labels of operations currently in flight. */
  get pendingWork(): string[] {
    return [...this.tracked.keys()];
  }

  /**
   * Begin shutdown. Idempotent: only the first call starts the deadline
   * timer and notifies `onShutdownStart` callbacks; later calls (repeat
   * signals) are logged and return false.
   *
   * @returns true when this call initiated shutdown.
   */
  requestShutdown(signal: string): boolean {
    this.signalsSeen.push(signal);
    if (this.started) {
      this.logger.warn(
        "Repeat shutdown signal ignored — cleanup already in progress",
        { signal, first_signal: this.firstSignal },
      );
      return false;
    }

    this.started = true;
    this.firstSignal = signal;
    this.logger.info("Shutdown signal received — draining in-flight batches", {
      signal,
      timeout_ms: this.timeoutMs,
      pending: this.pendingWork,
    });

    for (const callback of [...this.shutdownStartCallbacks]) {
      callback(signal);
    }

    this.timeoutHandle = setTimeout(() => this.handleTimeout(), this.timeoutMs);
    return true;
  }

  /**
   * Invoke `callback` once when shutdown starts (immediately if it already
   * has). Returns an unsubscribe function so per-sleep registrations do not
   * accumulate over a long-running loop.
   */
  onShutdownStart(callback: (signal: string) => void): () => void {
    if (this.started) {
      callback(this.firstSignal ?? "unknown");
      return () => {};
    }
    this.shutdownStartCallbacks.add(callback);
    return () => this.shutdownStartCallbacks.delete(callback);
  }

  /**
   * Register an in-flight operation so the drain waits for it. The returned
   * promise settles exactly like the input promise; its rejection is
   * observed by `waitForDrain()` (reported in `DrainResult.failures`)
   * rather than disappearing as an unhandled rejection.
   */
  track<T>(promise: Promise<T>, label: string): Promise<T> {
    const count = (this.labelCounts.get(label) ?? 0) + 1;
    this.labelCounts.set(label, count);
    const unique = count === 1 ? label : `${label}#${count}`;

    const wrapped = promise.then(
      (value) => {
        this.tracked.delete(unique);
        return value;
      },
      (error) => {
        this.tracked.delete(unique);
        throw error;
      },
    );
    this.tracked.set(unique, { label: unique, promise: wrapped });
    return wrapped;
  }

  /**
   * Wait for every tracked operation to settle, bounded by the shutdown
   * deadline. Never throws: rejections are returned in `failures`.
   */
  async waitForDrain(): Promise<DrainResult> {
    const entries = [...this.tracked.values()];
    let settled: PromiseSettledResult<unknown>[] | null = null;

    if (entries.length > 0) {
      const allSettled: Promise<PromiseSettledResult<unknown>[]> =
        Promise.allSettled(entries.map((entry) => entry.promise));
      const timeout = new Promise<null>((resolve) => {
        if (this.timedOutFlag) resolve(null);
        else this.timeoutWaiters.push(() => resolve(null));
      });
      settled = await Promise.race([allSettled, timeout]);
    }

    const failures: DrainFailure[] = [];
    if (settled) {
      settled.forEach((result, index) => {
        if (result.status === "rejected") {
          failures.push({
            label: entries[index].label,
            error: result.reason,
          });
        }
      });
    }

    const pending = entries
      .filter((entry) => this.tracked.has(entry.label))
      .map((entry) => entry.label);
    const drained = !this.timedOutFlag && pending.length === 0;

    if (this.timedOutFlag) {
      this.logger.error("Shutdown drain cut short by timeout", { pending });
    }

    return { drained, timedOut: this.timedOutFlag, failures, pending };
  }

  /**
   * Drain in-flight work, then run the flush steps — exactly once, no
   * matter how many times this is called. Steps run sequentially and a
   * failing step is logged and collected; it does not skip later steps.
   */
  runCleanup(steps: CleanupStep[]): Promise<CleanupResult> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.executeCleanup(steps);
    }
    return this.cleanupPromise;
  }

  /** Clear the deadline timer (idempotent). Does not resolve drain waiters. */
  dispose(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private async executeCleanup(steps: CleanupStep[]): Promise<CleanupResult> {
    // Drain first: a flush must never run while a batch is still writing.
    const drain = await this.waitForDrain();
    if (drain.timedOut) {
      this.logger.warn(
        "Running shutdown cleanup after drain timeout — in-flight work may be incomplete",
        { pending: drain.pending },
      );
    }

    this.logger.info("Running shutdown cleanup", {
      steps: steps.map((step) => step.name),
    });

    const failed: Array<{ name: string; error: unknown }> = [];
    for (const step of steps) {
      try {
        await step.run();
      } catch (error) {
        failed.push({ name: step.name, error });
        this.logger.error("Shutdown cleanup step failed", {
          step: step.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.dispose();

    if (failed.length === 0) {
      this.logger.info("Shutdown cleanup complete", {
        steps: steps.map((step) => step.name),
      });
    } else {
      this.logger.error("Shutdown cleanup finished with failures", {
        failed: failed.map((entry) => entry.name),
      });
    }

    return { completed: failed.length === 0, failed };
  }

  private handleTimeout(): void {
    if (this.timedOutFlag) return;
    this.timedOutFlag = true;
    this.timeoutHandle = null;

    const info: ShutdownTimeoutInfo = {
      signal: this.firstSignal ?? "unknown",
      timeoutMs: this.timeoutMs,
      pending: this.pendingWork,
    };
    this.logger.error(
      "Shutdown timeout reached before in-flight work settled",
      info,
    );
    for (const resolve of this.timeoutWaiters.splice(0)) resolve();
    this.onTimeout?.(info);
  }
}

/** Minimal signal-target shape (satisfied by `process` and EventEmitter). */
export interface SignalTarget {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface InstallShutdownSignalsOptions {
  /** Defaults to both SIGTERM and SIGINT. */
  signals?: readonly NodeJS.Signals[];
  /** Defaults to `process`. Tests pass an EventEmitter instead. */
  target?: SignalTarget;
}

/**
 * Wire SIGTERM / SIGINT to `coordinator.requestShutdown()`. Returns an
 * uninstall function that detaches every listener again.
 */
export function installShutdownSignals(
  coordinator: ShutdownCoordinator,
  options: InstallShutdownSignalsOptions = {},
): () => void {
  const signals: readonly NodeJS.Signals[] =
    options.signals ?? ["SIGTERM", "SIGINT"];
  const target: SignalTarget = options.target ?? process;
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of signals) {
    const handler = () => {
      coordinator.requestShutdown(signal);
    };
    handlers.set(signal, handler);
    target.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      target.off(signal, handler);
    }
    handlers.clear();
  };
}