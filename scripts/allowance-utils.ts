/**
 * allowance-utils.ts — Shared allowance helpers and rate-limit / retry defaults.
 *
 * Exported constants
 * ──────────────────
 * All default values for RPC rate-limiting and retry behaviour live here so
 * that tuning a single constant propagates to every consumer automatically.
 * Previously the same three values were duplicated in:
 *   - allowance-utils.ts header comment (not exported, could drift)
 *   - check-allowances.ts:59-64
 *   - alert-expiring-allowances.ts:58-63
 *
 * LEDGERS_PER_DAY
 * ───────────────
 * Stellar closes approximately one ledger every 5 seconds.
 *   17 280 = 86 400 s/day ÷ 5 s/ledger
 *
 * This matches:
 *   - contract/src/spending_limit.rs:7  (LEDGERS_PER_DAY = 17_280)
 *   - contract/src/upgrade.rs:5        (TTL = 17_280)
 *
 * NOTE: The ~5 s/ledger assumption should be validated against the live
 * network periodically.  The Stellar network targets 5 s but actual close
 * times vary.  Use server.getLatestLedger() to derive an empirical value
 * when precision matters.
 */

// ── Ledger-time constants ─────────────────────────────────────────────────────

/**
 * Approximate number of ledgers closed in one day on Stellar.
 * Mirrors contract/src/spending_limit.rs:7 and contract/src/upgrade.rs:5.
 *
 * NOTE: Based on the ~5 s/ledger assumption — validate against the live
 * network if precision matters.
 */
export const LEDGERS_PER_DAY = 17_280;

// ── RPC rate-limit defaults ───────────────────────────────────────────────────

/**
 * Default number of RPC requests allowed per second before throttling.
 * Tuning this value propagates to check-allowances.ts and
 * alert-expiring-allowances.ts automatically.
 */
export const DEFAULT_REQUESTS_PER_SECOND = 5;

/**
 * Default burst capacity: how many requests may be issued above the
 * per-second rate limit before throttling kicks in.
 */
export const DEFAULT_BURST = 10;

/**
 * Default sliding-window duration (in milliseconds) used for rate-limit
 * accounting.
 */
export const DEFAULT_WINDOW_MS = 1_000;

// ── Retry defaults ────────────────────────────────────────────────────────────

/**
 * Default maximum number of retry attempts for a failing RPC call.
 */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * Default initial back-off delay in milliseconds (doubles on each retry).
 */
export const DEFAULT_RETRY_DELAY_MS = 500;

// ── Rate-limiter helper ───────────────────────────────────────────────────────

/**
 * Minimal token-bucket rate limiter for RPC calls.
 *
 * @param requestsPerSecond  Maximum steady-state RPS (default: DEFAULT_REQUESTS_PER_SECOND).
 * @param burst              Extra capacity above the steady rate (default: DEFAULT_BURST).
 * @param windowMs           Accounting window in ms (default: DEFAULT_WINDOW_MS).
 */
export interface RateLimiterOptions {
  requestsPerSecond?: number;
  burst?: number;
  windowMs?: number;
}

export class RateLimiter {
  private readonly requestsPerSecond: number;
  private readonly burst: number;
  private readonly windowMs: number;
  private tokens: number;
  private lastRefill: number;

  constructor(opts: RateLimiterOptions = {}) {
    this.requestsPerSecond = opts.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND;
    this.burst = opts.burst ?? DEFAULT_BURST;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.tokens = this.burst;
    this.lastRefill = Date.now();
  }

  /** Waits until a token is available, then consumes one. */
  async throttle(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      const refill = (elapsed / this.windowMs) * this.requestsPerSecond;
      this.tokens = Math.min(this.burst, this.tokens + refill);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Wait until enough tokens accumulate for one request
      const waitMs = ((1 - this.tokens) / this.requestsPerSecond) * this.windowMs;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(waitMs)));
    }
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

/**
 * Retries `fn` up to `maxRetries` times with exponential back-off.
 *
 * @param fn          Async function to call.
 * @param maxRetries  Maximum attempts (default: DEFAULT_MAX_RETRIES).
 * @param delayMs     Initial back-off delay in ms (default: DEFAULT_RETRY_DELAY_MS).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  delayMs: number = DEFAULT_RETRY_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

// ── Allowance parsing helpers ─────────────────────────────────────────────────

/**
 * Converts a stroop value (smallest XLM unit) to a human-readable decimal
 * string using the token's decimal places.
 *
 * For XLM (7 decimals): 10_000_000 stroops = 1.0000000 XLM.
 * For other SAC tokens pass the appropriate `decimals` value — do NOT
 * hard-code 7 for non-XLM tokens.
 *
 * @param stroops   Raw token amount as a string or bigint.
 * @param decimals  Number of decimal places for the token (default: 7 for XLM).
 */
export function formatTokenAmount(
  stroops: string | bigint,
  decimals = 7
): string {
  const value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const frac = value % divisor;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${whole}.${fracStr}`;
}

/**
 * Returns `true` when `allowance` (in token base units) is insufficient
 * to cover `required`.
 *
 * @param allowance   Current approved allowance.
 * @param required    Amount required for the next charge.
 */
export function isAllowanceAtRisk(allowance: bigint, required: bigint): boolean {
  return allowance < required;
}

/**
 * Calculates the shortfall between `required` and `allowance`.
 * Returns 0n if the allowance is sufficient.
 *
 * @param allowance   Current approved allowance.
 * @param required    Amount required for the next charge.
 */
export function allowanceGap(allowance: bigint, required: bigint): bigint {
  return required > allowance ? required - allowance : 0n;
 * allowance-utils.ts — Shared concurrency, retry, and type utilities for
 * allowance audit scripts (check-allowances.ts, alert-expiring-allowances.ts).
 *
 * Exports
 * ───────
 *  withRetry<T>()        — bounded exponential-backoff retry for transient RPC errors
 *  pLimit()              — token-bucket concurrency limiter
 *  isTransientError()    — classifier: network/timeout = transient; business = definitive
 *  runConcurrent()       — fan-out a list of tasks under a concurrency cap
 *
 * Shared JSON schema types are also exported so both scripts produce compatible
 * shapes consumable by downstream alerting pipelines.
 *
 * Environment knobs (read by scripts, documented here for reference):
 *   CONCURRENCY      Max simultaneous RPC calls (default: 5)
 *   MAX_RETRIES      Max retry attempts per call (default: 3)
 *   RETRY_BASE_MS    Base delay in ms before first retry (default: 300)
 */

// ── Transient-error classifier ────────────────────────────────────────────────

/**
 * Signals that an error is definitively a business-logic result, not a
 * transport fault — callers should NOT retry on this.
 *
 * Throw or wrap errors with this to mark them as non-retryable.
 */
export class DefinitiveError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DefinitiveError";
  }
}

/**
 * Returns `true` for errors that are transient transport or RPC infrastructure
 * failures (network timeout, connection refused, rate-limit 429, server-side
 * 5xx) that are safe to retry.
 *
 * Returns `false` for:
 *  - `DefinitiveError` — business logic results (e.g. insufficient allowance)
 *  - 4xx client errors other than 429 (bad request, auth, not found)
 *  - Any error that does not look like a network/transport fault
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof DefinitiveError) return false;

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // Explicit non-retriable patterns
    if (
      msg.includes("invalid") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden") ||
      msg.includes("not found") ||
      msg.includes("bad request") ||
      msg.includes("400") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("404")
    ) {
      return false;
    }

    // Transient patterns
    if (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("enotfound") ||
      msg.includes("socket") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("fetch failed") ||
      msg.includes("429") ||
      msg.includes("too many requests") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("internal server error") ||
      msg.includes("service unavailable")
    ) {
      return true;
    }
  }

  // Unknown errors — conservatively treat as transient so we don't silently
  // drop valid subscribers on ephemeral infrastructure blips.
  return true;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the first call). Default 3. */
  maxRetries?: number;
  /** Base delay in ms before the first retry. Doubles each attempt. Default 300. */
  baseDelayMs?: number;
  /** Optional jitter fraction [0, 1] applied to each delay. Default 0.2. */
  jitter?: number;
  /** Called before each retry attempt with the attempt index (1-based) and error. */
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * Executes `fn` and retries it on transient errors with truncated exponential
 * backoff plus jitter.
 *
 * - DefinitiveError and non-transient errors propagate immediately without retry.
 * - After `maxRetries` exhausted retries, the last error is rethrown.
 *
 * @example
 *   const result = await withRetry(() => server.simulateTransaction(tx), { maxRetries: 3 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const jitter = options.jitter ?? 0.2;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;

      // Do not retry definitive or non-transient errors
      if (!isTransientError(err)) {
        throw err;
      }

      // Last attempt — rethrow
      if (attempt === maxRetries) {
        break;
      }

      const delay =
        baseDelayMs * 2 ** attempt * (1 + jitter * (Math.random() * 2 - 1));
      options.onRetry?.(attempt + 1, err);
      await sleep(delay);
    }
  }

  throw lastErr;
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

/**
 * Returns a function that wraps async tasks so at most `limit` run in parallel.
 * Excess tasks are queued and started as slots free up.
 *
 * @example
 *   const run = pLimit(5);
 *   const results = await Promise.all(addresses.map(addr => run(() => check(addr))));
 */
export function pLimit(
  limit: number,
): <T>(fn: () => Promise<T>) => Promise<T> {
  if (limit < 1) throw new RangeError("pLimit: limit must be >= 1");

  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && active < limit) {
      active++;
      const resume = queue.shift()!;
      resume();
    }
  }

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = (): void => {
        fn().then(
          (v) => {
            active--;
            next();
            resolve(v);
          },
          (e) => {
            active--;
            next();
            reject(e);
          },
        );
      };

      if (active < limit) {
        active++;
        execute();
      } else {
        queue.push(execute);
      }
    });
  };
}

// ── Fan-out runner ────────────────────────────────────────────────────────────

/**
 * Runs `tasks` with at most `concurrency` tasks in flight simultaneously.
 * Returns results in the same order as `tasks`, analogous to Promise.all but
 * bounded.
 *
 * Individual task failures are caught and returned as `Error` instances in the
 * result array so one failure never aborts the entire batch.
 */
export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<Array<T | Error>> {
  const run = pLimit(concurrency);
  return Promise.all(
    tasks.map((task) =>
      run(() => task()).catch((err: unknown) =>
        err instanceof Error ? err : new Error(String(err)),
      ),
    ),
  );
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Shared JSON schema types ──────────────────────────────────────────────────

/**
 * Per-subscriber result emitted by check-allowances.ts.
 * Stable schema: downstream alerting pipelines may parse this.
 */
export interface AuditResult {
  /** Stellar G-address of the subscriber. */
  address: string;
  /** Subscription charge amount in stroops. */
  subscription_amount: string;
  /** Current approved allowance in stroops. */
  allowance: string;
  /** Shortfall (subscription_amount - allowance) in stroops, "0" when sufficient. */
  gap: string;
  /** SAC token contract address. */
  token: string;
  /** Whether the subscription is active. */
  active: boolean;
  /** Whether the subscription is paused. */
  paused: boolean;
  /** true when the subscription is active, not paused, and gap > 0. */
  at_risk: boolean;
  /**
   * Set when the check could not be completed normally.
   * Values: "invalid_address" | "no_subscription" | "rpc_error" | "unknown_error"
   */
  error?: string;
}

/**
 * Top-level report produced by check-allowances.ts.
 */
export interface AllowanceCheckReport {
  generated_at: string;
  contract: string;
  total_checked: number;
  healthy_count: number;
  at_risk_count: number;
  error_count: number;
  results: AuditResult[];
}

/**
 * Per-subscriber expiry entry produced by alert-expiring-allowances.ts.
 */
export interface ExpiryEntry {
  /** Stellar G-address of the subscriber. */
  address: string;
  /** Merchant address. */
  merchant: string;
  /** Current allowance amount in stroops. */
  allowance_amount: string;
  /** Ledger sequence at which the allowance expires (0 = no expiry / not found). */
  expires_at_ledger: number;
  /** Ledgers until expiry. 0 if already expired. */
  ledgers_remaining: number;
}

/**
 * Top-level report produced by alert-expiring-allowances.ts.
 */
export interface ExpiryAlertReport {
  generated_at: string;
  contract: string;
  current_ledger: number;
  alert_window_ledgers: number;
  expiring_count: number;
  expiring: ExpiryEntry[];
}
