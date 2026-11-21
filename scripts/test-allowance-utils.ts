#!/usr/bin/env tsx
/**
 * test-allowance-utils.ts — Tests for allowance-utils.ts constants and helpers.
 *
 * Covers:
 *  - LEDGERS_PER_DAY value matches contract/src/spending_limit.rs
 *  - Rate-limit defaults are exported with correct values
 *  - formatTokenAmount handles XLM and non-XLM tokens correctly
 *  - isAllowanceAtRisk / allowanceGap logic
 *  - RateLimiter throttles and token-bucket refills
 *  - withRetry retries the correct number of times and propagates last error
 *
 * Run:
 *   cd scripts && npx tsx test-allowance-utils.ts
 */

import {
  LEDGERS_PER_DAY,
  DEFAULT_REQUESTS_PER_SECOND,
  DEFAULT_BURST,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  RateLimiter,
  withRetry,
  formatTokenAmount,
  isAllowanceAtRisk,
  allowanceGap,
} from "./allowance-utils.js";

// ── Minimal test harness ──────────────────────────────────────────────────────
 * test-allowance-utils.ts — Unit tests for concurrency, retry, and error-
 * classification logic in allowance-utils.ts.
 *
 * Uses in-process mock RPC functions — no network, no CONTRACT_ID required.
 *
 * Run:
 *   npx tsx scripts/test-allowance-utils.ts
 *
 * Exit codes:
 *   0 — all tests passed
 *   1 — one or more tests failed
 */

import {
  withRetry,
  pLimit,
  runConcurrent,
  isTransientError,
  DefinitiveError,
  sleep,
} from "./allowance-utils.js";

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓  ${message}`);
    passed++;
  } else {
    console.error(`  ✗  ${message}`);
function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok =
    typeof actual === "object"
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : actual === expected;
  if (ok) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`);
    console.error(`         expected: ${JSON.stringify(expected)}`);
    console.error(`         actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function assertThrows(
  fn: () => Promise<unknown>,
  message: string
): Promise<void> {
  try {
    await fn();
    console.error(`  ✗  ${message} (expected throw but none occurred)`);
    failed++;
  } catch {
    console.log(`  ✓  ${message}`);
    passed++;
  }
}

// ── LEDGERS_PER_DAY ───────────────────────────────────────────────────────────

console.log("\n=== LEDGERS_PER_DAY ===");

// The contract value is 17_280 (contract/src/spending_limit.rs:7).
// Scripts must stay in sync with it.
assert(
  LEDGERS_PER_DAY === 17_280,
  `LEDGERS_PER_DAY is 17 280 (mirrors contract/src/spending_limit.rs:7)`
);

// Sanity: 86_400 s/day ÷ 5 s/ledger = 17_280
assert(
  LEDGERS_PER_DAY === Math.round(86_400 / 5),
  "LEDGERS_PER_DAY derivation: 86 400 ÷ 5 = 17 280"
);

// ── Rate-limit defaults ───────────────────────────────────────────────────────

console.log("\n=== Rate-limit defaults ===");

assert(typeof DEFAULT_REQUESTS_PER_SECOND === "number" && DEFAULT_REQUESTS_PER_SECOND > 0,
  "DEFAULT_REQUESTS_PER_SECOND is a positive number");
assert(typeof DEFAULT_BURST === "number" && DEFAULT_BURST >= DEFAULT_REQUESTS_PER_SECOND,
  "DEFAULT_BURST >= DEFAULT_REQUESTS_PER_SECOND");
assert(typeof DEFAULT_WINDOW_MS === "number" && DEFAULT_WINDOW_MS > 0,
  "DEFAULT_WINDOW_MS is a positive number");
assert(typeof DEFAULT_MAX_RETRIES === "number" && DEFAULT_MAX_RETRIES >= 1,
  "DEFAULT_MAX_RETRIES is at least 1");
assert(typeof DEFAULT_RETRY_DELAY_MS === "number" && DEFAULT_RETRY_DELAY_MS > 0,
  "DEFAULT_RETRY_DELAY_MS is a positive number");

// ── formatTokenAmount ─────────────────────────────────────────────────────────

console.log("\n=== formatTokenAmount ===");

// XLM: 1 XLM = 10_000_000 stroops (7 decimals)
assert(
  formatTokenAmount(10_000_000n) === "1.0000000",
  "formatTokenAmount: 10_000_000 stroops → 1.0000000 XLM"
);
assert(
  formatTokenAmount("0") === "0.0000000",
  "formatTokenAmount: 0 stroops → 0.0000000"
);
assert(
  formatTokenAmount(1n) === "0.0000001",
  "formatTokenAmount: 1 stroop → 0.0000001"
);
assert(
  formatTokenAmount(123_456_789n) === "12.3456789",
  "formatTokenAmount: 123_456_789 → 12.3456789"
);

// Non-XLM token with 6 decimals (e.g. USDC)
assert(
  formatTokenAmount(1_000_000n, 6) === "1.000000",
  "formatTokenAmount: 1_000_000 units (6 decimals) → 1.000000"
);
assert(
  formatTokenAmount(500n, 6) === "0.000500",
  "formatTokenAmount: 500 units (6 decimals) → 0.000500"
);

// ── isAllowanceAtRisk / allowanceGap ─────────────────────────────────────────

console.log("\n=== isAllowanceAtRisk / allowanceGap ===");

assert(
  isAllowanceAtRisk(500n, 1000n) === true,
  "isAllowanceAtRisk: 500 < 1000 → at risk"
);
assert(
  isAllowanceAtRisk(1000n, 1000n) === false,
  "isAllowanceAtRisk: 1000 == 1000 → not at risk"
);
assert(
  isAllowanceAtRisk(2000n, 1000n) === false,
  "isAllowanceAtRisk: 2000 > 1000 → not at risk"
);

assert(
  allowanceGap(500n, 1000n) === 500n,
  "allowanceGap: 1000 required, 500 available → gap 500"
);
assert(
  allowanceGap(1000n, 1000n) === 0n,
  "allowanceGap: exactly covered → gap 0"
);
assert(
  allowanceGap(2000n, 1000n) === 0n,
  "allowanceGap: surplus → gap 0"
);

// ── withRetry ─────────────────────────────────────────────────────────────────

console.log("\n=== withRetry ===");

// Succeeds on first attempt
await (async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return 42;
  }, 3, 1);
  assert(result === 42, "withRetry: returns value on first success");
  assert(calls === 1, "withRetry: calls fn exactly once on immediate success");
})();

// Succeeds on third attempt
await (async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    3,
    1
  );
  assert(result === "ok", "withRetry: returns value after transient failures");
  assert(calls === 3, "withRetry: retries up to maxRetries times");
})();

// Exhausts retries and rethrows last error
await assertThrows(async () => {
  await withRetry(async () => { throw new Error("permanent"); }, 2, 1);
}, "withRetry: throws after exhausting all retries");

// Propagates the last error message
await (async () => {
  let caught: Error | null = null;
  try {
    await withRetry(async () => { throw new Error("last-error"); }, 2, 1);
  } catch (err) {
    caught = err as Error;
  }
  assert(
    caught?.message === "last-error",
    "withRetry: propagates the last thrown error"
  );
})();

// ── RateLimiter ───────────────────────────────────────────────────────────────

console.log("\n=== RateLimiter ===");

// With high burst, first N calls should be immediate
await (async () => {
  const limiter = new RateLimiter({ requestsPerSecond: 100, burst: 5, windowMs: 1000 });
  const start = Date.now();
  for (let i = 0; i < 5; i++) {
    await limiter.throttle();
  }
  const elapsed = Date.now() - start;
  // 5 burst calls should complete in well under 200 ms
  assert(elapsed < 200, `RateLimiter: burst of 5 completes quickly (${elapsed} ms < 200 ms)`);
})();

// With 0 burst and very low RPS, subsequent call should be delayed
await (async () => {
  // 10 rps, burst=1 (one free token then must wait ~100ms per token)
  const limiter = new RateLimiter({ requestsPerSecond: 10, burst: 1, windowMs: 1000 });
  await limiter.throttle(); // consume the burst token
  const start = Date.now();
  await limiter.throttle(); // this one must wait ~100 ms
  const elapsed = Date.now() - start;
  assert(
    elapsed >= 80,
    `RateLimiter: second call after burst is throttled (${elapsed} ms ≥ 80 ms)`
  );
})();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);

if (failed > 0) {
  process.exit(1);
async function assertRejects(
  fn: () => Promise<unknown>,
  label: string,
  msgContains?: string,
): Promise<void> {
  try {
    await fn();
    console.error(`  [FAIL] ${label} (expected rejection, got resolution)`);
    failed++;
  } catch (err) {
    if (
      msgContains &&
      !(err instanceof Error && err.message.includes(msgContains))
    ) {
      console.error(
        `  [FAIL] ${label} (error message "${err instanceof Error ? err.message : String(err)}" does not contain "${msgContains}")`,
      );
      failed++;
    } else {
      console.log(`  [PASS] ${label}`);
      passed++;
    }
  }
}

// ── Suite 1: isTransientError ─────────────────────────────────────────────────
console.log("\n=== Suite 1: isTransientError ===");

{
  assert(
    !isTransientError(new DefinitiveError("insufficient allowance")),
    "DefinitiveError is NOT transient",
  );

  const transientMessages = [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "socket hang up",
    "fetch failed",
    "429 too many requests",
    "503 service unavailable",
    "504 gateway timeout",
    "internal server error",
    "network error",
  ];

  for (const msg of transientMessages) {
    assert(
      isTransientError(new Error(msg)),
      `"${msg}" is transient`,
    );
  }

  const definitiveMessages = [
    "invalid address",
    "400 bad request",
    "401 unauthorized",
    "403 forbidden",
    "404 not found",
  ];

  for (const msg of definitiveMessages) {
    assert(
      !isTransientError(new Error(msg)),
      `"${msg}" is NOT transient`,
    );
  }

  // Unknown error type — conservatively transient
  assert(isTransientError("some string error"), "unknown error is transient");
  assert(isTransientError(42), "numeric error is transient");
}

// ── Suite 2: withRetry — success on first attempt ─────────────────────────────
console.log("\n=== Suite 2: withRetry — success on first attempt ===");

{
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  });
  assertEqual(result, "ok", "returns value on success");
  assertEqual(calls, 1, "fn called exactly once");
}

// ── Suite 3: withRetry — retries on transient, succeeds eventually ─────────────
console.log("\n=== Suite 3: withRetry — retries on transient errors ===");

{
  let calls = 0;
  const retryEvents: number[] = [];

  // Fail twice with a transient error, then succeed on the third attempt
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("ECONNRESET simulated");
      return "recovered";
    },
    {
      maxRetries: 3,
      baseDelayMs: 0, // no delay in tests
      onRetry: (attempt) => retryEvents.push(attempt),
    },
  );

  assertEqual(result, "recovered", "returns value after retries");
  assertEqual(calls, 3, "fn called 3 times total (2 failures + 1 success)");
  assertEqual(retryEvents, [1, 2], "onRetry called for attempts 1 and 2");
}

// ── Suite 4: withRetry — exhausts retries and rethrows ────────────────────────
console.log("\n=== Suite 4: withRetry — exhausts retries ===");

{
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error("ECONNREFUSED persistent");
        },
        { maxRetries: 2, baseDelayMs: 0 },
      ),
    "rethrows after exhausting retries",
    "ECONNREFUSED",
  );
  assertEqual(calls, 3, "fn called 3 times (1 original + 2 retries)");
}

// ── Suite 5: withRetry — does NOT retry on DefinitiveError ────────────────────
console.log("\n=== Suite 5: withRetry — no retry on DefinitiveError ===");

{
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new DefinitiveError("subscription not found");
        },
        { maxRetries: 5, baseDelayMs: 0 },
      ),
    "DefinitiveError propagates immediately without retry",
    "subscription not found",
  );
  assertEqual(calls, 1, "fn called exactly once (no retries)");
}

// ── Suite 6: withRetry — does NOT retry on non-transient HTTP errors ──────────
console.log(
  "\n=== Suite 6: withRetry — no retry on non-transient errors ===",
);

{
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error("404 not found");
        },
        { maxRetries: 5, baseDelayMs: 0 },
      ),
    "404 error propagates immediately",
    "404",
  );
  assertEqual(calls, 1, "fn called exactly once for 404");
}

// ── Suite 7: withRetry — maxRetries=0 means no retries ───────────────────────
console.log("\n=== Suite 7: withRetry — maxRetries=0 ===");

{
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error("ETIMEDOUT");
        },
        { maxRetries: 0, baseDelayMs: 0 },
      ),
    "maxRetries=0 propagates on first failure",
  );
  assertEqual(calls, 1, "fn called exactly once when maxRetries=0");
}

// ── Suite 8: pLimit — concurrency cap ────────────────────────────────────────
console.log("\n=== Suite 8: pLimit — concurrency cap ===");

{
  const LIMIT = 3;
  const run = pLimit(LIMIT);

  let activeNow = 0;
  let peakActive = 0;
  const results: number[] = [];

  const tasks = Array.from({ length: 10 }, (_, i) =>
    run(async () => {
      activeNow++;
      if (activeNow > peakActive) peakActive = activeNow;
      await sleep(5); // tiny async gap so concurrent tasks overlap
      activeNow--;
      results.push(i);
      return i;
    }),
  );

  const resolved = await Promise.all(tasks);

  assert(peakActive <= LIMIT, `peak concurrency (${peakActive}) ≤ limit (${LIMIT})`);
  assertEqual(resolved.length, 10, "all 10 tasks resolved");
  assert(
    resolved.every((v, i) => v === i),
    "results are in input order",
  );
}

// ── Suite 9: pLimit — limit=1 serialises tasks ────────────────────────────────
console.log("\n=== Suite 9: pLimit — limit=1 serialises ===");

{
  const run = pLimit(1);
  const order: number[] = [];
  let activeNow = 0;
  let concurrent = false;

  await Promise.all(
    [0, 1, 2, 3, 4].map((i) =>
      run(async () => {
        activeNow++;
        if (activeNow > 1) concurrent = true;
        await sleep(2);
        order.push(i);
        activeNow--;
      }),
    ),
  );

  assert(!concurrent, "limit=1: no two tasks ran simultaneously");
  assertEqual(order, [0, 1, 2, 3, 4], "limit=1: tasks executed in submission order");
}

// ── Suite 10: pLimit — rejects on invalid limit ───────────────────────────────
console.log("\n=== Suite 10: pLimit — rejects invalid limit ===");

{
  let threw = false;
  try {
    pLimit(0);
  } catch {
    threw = true;
  }
  assert(threw, "pLimit(0) throws RangeError");
}

// ── Suite 11: runConcurrent — all tasks succeed ───────────────────────────────
console.log("\n=== Suite 11: runConcurrent — all succeed ===");

{
  const tasks = [1, 2, 3, 4, 5].map((n) => async () => n * 2);
  const results = await runConcurrent(tasks, 3);
  assertEqual(results, [2, 4, 6, 8, 10], "runConcurrent returns results in order");
}

// ── Suite 12: runConcurrent — partial failures captured as Error objects ───────
console.log("\n=== Suite 12: runConcurrent — partial failures ===");

{
  const tasks = [
    async () => "a",
    async (): Promise<string> => {
      throw new Error("task-2-failed");
    },
    async () => "c",
    async (): Promise<string> => {
      throw new Error("task-4-failed");
    },
    async () => "e",
  ];

  const results = await runConcurrent(tasks, 2);

  assertEqual(results.length, 5, "runConcurrent returns an entry for every task");
  assertEqual(results[0], "a", "task 0 succeeded");
  assert(results[1] instanceof Error, "task 1 failure is an Error object");
  assert(
    (results[1] as Error).message.includes("task-2-failed"),
    "task 1 error message preserved",
  );
  assertEqual(results[2], "c", "task 2 succeeded");
  assert(results[3] instanceof Error, "task 3 failure is an Error object");
  assertEqual(results[4], "e", "task 4 succeeded");
}

// ── Suite 13: runConcurrent — concurrency cap respected ───────────────────────
console.log("\n=== Suite 13: runConcurrent — concurrency cap ===");

{
  const LIMIT = 4;
  let active = 0;
  let peak = 0;

  const tasks = Array.from({ length: 20 }, () => async () => {
    active++;
    if (active > peak) peak = active;
    await sleep(3);
    active--;
    return true;
  });

  await runConcurrent(tasks, LIMIT);

  assert(peak <= LIMIT, `runConcurrent peak (${peak}) ≤ limit (${LIMIT})`);
}

// ── Suite 14: withRetry — mock flaky RPC (3-of-5 failures then success) ────────
console.log(
  "\n=== Suite 14: withRetry — mock flaky RPC (intermittent 503) ===",
);

{
  const callLog: Array<{ attempt: number; outcome: string }> = [];
  let attempt = 0;
  const retryAttempts: number[] = [];

  // Simulates an RPC that fails 4 times then succeeds
  const mockRpc = async (): Promise<string> => {
    attempt++;
    if (attempt <= 4) {
      callLog.push({ attempt, outcome: "503 service unavailable" });
      throw new Error("503 service unavailable");
    }
    callLog.push({ attempt, outcome: "success" });
    return "data";
  };

  const result = await withRetry(mockRpc, {
    maxRetries: 5,
    baseDelayMs: 0,
    onRetry: (a) => retryAttempts.push(a),
  });

  assertEqual(result, "data", "mock flaky RPC eventually returns data");
  assertEqual(callLog.length, 5, "mock RPC called 5 times");
  assertEqual(retryAttempts, [1, 2, 3, 4], "onRetry fired for retries 1-4");
  assertEqual(
    callLog.filter((e) => e.outcome === "503 service unavailable").length,
    4,
    "4 transient failures before success",
  );
}

// ── Suite 15: withRetry — retry count visible in onRetry callback ──────────────
console.log("\n=== Suite 15: withRetry — onRetry receives correct attempt numbers ===");

{
  const attempts: number[] = [];
  await withRetry(
    async () => {
      if (attempts.length < 3) throw new Error("ECONNRESET");
      return "done";
    },
    {
      maxRetries: 5,
      baseDelayMs: 0,
      onRetry: (n) => attempts.push(n),
    },
  );
  // attempts should be [1, 2, 3] (three retries before success)
  assertEqual(attempts, [1, 2, 3], "onRetry receives 1-based attempt numbers");
}

// ── Suite 16: runConcurrent — empty task list ─────────────────────────────────
console.log("\n=== Suite 16: runConcurrent — empty task list ===");

{
  const results = await runConcurrent([], 5);
  assertEqual(results, [], "empty task list returns empty array");
}

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All allowance-utils tests passed ✓");
  process.exit(0);
}
