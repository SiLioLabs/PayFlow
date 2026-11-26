/**
 * fetchWithTimeout.ts — Shared fetch helper with AbortController timeout.
 *
 * Ensures the AbortController timeout is always cleared (in a finally block)
 * regardless of whether the request succeeds, fails, or throws. This prevents
 * timer leaks that accumulate across retry loops.
 *
 * Usage:
 *   import { fetchWithTimeout } from "./utils/fetchWithTimeout.js";
 *   const response = await fetchWithTimeout(url, { method: "POST", body: "..." }, 10_000);
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Additional signal to combine with the timeout signal (optional). */
  parentSignal?: AbortSignal;
}

/**
 * Performs a `fetch` that is automatically aborted after `timeoutMs` milliseconds.
 *
 * The internal `AbortController` timeout is **always** cleared in a `finally`
 * block — including when `fetch` itself throws (DNS failure, connection refused,
 * invalid URL) — so no timer leaks across retry loops.
 *
 * @param url        The request URL.
 * @param options    Standard `RequestInit` options, plus an optional `parentSignal`.
 * @param timeoutMs  How long to wait before aborting (default: 10 000 ms).
 * @returns          The resolved `Response`.
 * @throws           Re-throws any network error or abort error from `fetch`.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Merge with a parent signal if provided (e.g. from an outer cancellation scope)
  const { parentSignal, ...fetchOptions } = options;
  if (parentSignal) {
    parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    // Always clear the timer — even when fetch() itself throws.
    // Without this, a failed attempt leaks one live timer per call.
    clearTimeout(timeoutId);
  }
}
