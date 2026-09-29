#!/usr/bin/env tsx
/**
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
