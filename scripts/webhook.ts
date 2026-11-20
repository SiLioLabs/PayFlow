#!/usr/bin/env tsx
/**
 * webhook.ts — Signed webhook delivery with retries and a dead-letter queue (DLQ).
 *
 * Sends an HMAC-SHA256–signed POST to a configured webhook endpoint.
 * On failure the attempt is retried with exponential back-off; payloads that
 * exhaust all retries are written to a local DLQ file for later inspection.
 *
 * Usage:
 *   WEBHOOK_URL=https://hooks.example.com/payflow \
 *   WEBHOOK_SECRET=mysecret \
 *   tsx scripts/webhook.ts
 *
 * Environment:
 *   WEBHOOK_URL     Required. Destination URL.
 *   WEBHOOK_SECRET  Required. HMAC signing secret.
 *   WEBHOOK_TIMEOUT Optional. Per-attempt timeout in ms (default: 10 000).
 *   DLQ_PATH        Optional. Path to the DLQ NDJSON file (default: dlq.ndjson).
 *   MAX_RETRIES     Optional. Maximum delivery attempts (default: 3).
 *   WEBHOOK_LEGACY_SIGNATURE  Optional. "false" stops sending the legacy
 *                   body-only signature headers (default: sent).
 *
 * Signing (replay protection, #1486)
 *   Every attempt sends:
 *     X-PayFlow-Timestamp:    unix seconds at send time
 *     X-PayFlow-Signature-V2: hex HMAC-SHA256(secret, "<timestamp>.<raw body>")
 *   Receivers must recompute the V2 signature and reject requests whose
 *   timestamp is outside their tolerance window (default 300s); see
 *   verifyWebhookSignature() and docs/MERCHANT-INTEGRATION.md.
 *   The legacy body-only headers (X-PayFlow-Signature / X-Signature-SHA256)
 *   are still sent during the transition and can be replayed — receivers
 *   should migrate to V2.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchWithTimeout } from "./utils/fetchWithTimeout.js";
import { appendJsonLine } from "./soroban-admin.js";
import { logger } from "./logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const WEBHOOK_URL    = process.env.WEBHOOK_URL ?? "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
const TIMEOUT_MS     = parseInt(process.env.WEBHOOK_TIMEOUT ?? "10000", 10);
const DLQ_PATH       = process.env.DLQ_PATH ?? "dlq.ndjson";
const MAX_RETRIES    = parseInt(process.env.MAX_RETRIES ?? "3", 10);
const SEND_LEGACY_SIGNATURE = process.env.WEBHOOK_LEGACY_SIGNATURE !== "false";

/** Default receiver tolerance for X-PayFlow-Timestamp, in seconds. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

// ── Timestamped signatures (#1486) ───────────────────────────────────────────

const hmacHex = (secret: string, data: string): string =>
  createHmac("sha256", secret).update(data).digest("hex");

/**
 * Headers proving `body` was sent by the secret holder at `timestamp`.
 * Signs "<timestamp>.<body>" so a captured request cannot be replayed
 * outside the receiver's tolerance window.
 */
export function signWebhookPayload(
  secret: string,
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { "X-PayFlow-Timestamp": string; "X-PayFlow-Signature-V2": string } {
  return {
    "X-PayFlow-Timestamp": String(timestamp),
    "X-PayFlow-Signature-V2": hmacHex(secret, `${timestamp}.${body}`),
  };
}

/**
 * Receiver-side check: valid V2 signature AND timestamp within
 * `toleranceSeconds` of `now` (both in unix seconds).
 */
export function verifyWebhookSignature(params: {
  secret: string;
  body: string;
  timestamp: string | undefined;
  signature: string | undefined;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const { secret, body, timestamp, signature } = params;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const now = params.now ?? Math.floor(Date.now() / 1000);
  const tolerance = params.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance) return false;
  const expected = Buffer.from(hmacHex(secret, `${timestamp}.${body}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── HMAC Signing ─────────────────────────────────────────────────────────────

/**
 * Computes the HMAC-SHA256 hex digest of `body` using `WEBHOOK_SECRET`.
 * Preserved from the original implementation.
 */
function signPayload(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

// ── Dead-Letter Queue ─────────────────────────────────────────────────────────

interface DlqEntry {
  url: string;
  payload: unknown;
  lastError: string;
  failedAt: string;
  attempts: number;
}

function writeToDlq(entry: DlqEntry): void {
  try {
    appendFileSync(DLQ_PATH, JSON.stringify(entry) + "\n", "utf-8");
    console.error(`[webhook] Payload written to DLQ: ${DLQ_PATH}`);
  } catch (err) {
    console.error(`[webhook] CRITICAL: failed to write to DLQ: ${err}`);
  }
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/**
 * Attempts to deliver `payload` to `url` with HMAC signing and a per-attempt
 * timeout. The `AbortController` timeout is always cleared in a `finally` block
 * (via `fetchWithTimeout`) so no timer leaks occur on network failures.
 *
 * @returns `true` on HTTP 2xx, `false` otherwise.
 */
async function attemptDelivery(url: string, body: string): Promise<boolean> {
  // Signed per attempt so retries carry a fresh timestamp.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...signWebhookPayload(WEBHOOK_SECRET, body),
  };
  if (SEND_LEGACY_SIGNATURE) headers["X-Signature-SHA256"] = `sha256=${signPayload(body)}`;

  let response: Response;
  try {
    // fetchWithTimeout guarantees clearTimeout() in a finally block,
    // fixing the timer leak that occurred when fetch() itself threw.
    response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers,
        body,
      },
      TIMEOUT_MS
    );
  } catch (err) {
    // Network / DNS / abort errors — let the caller decide on retry.
    throw err;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return true;
}

/**
 * Delivers `payload` with exponential back-off retries.
 * Payloads that exhaust all retries are written to the DLQ.
 */
export async function deliverWebhook(url: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await attemptDelivery(url, body);
      console.log(`[webhook] Delivered on attempt ${attempt}`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[webhook] Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`);

      if (attempt < MAX_RETRIES) {
        // Exponential back-off: 1 s, 2 s, 4 s …
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  writeToDlq({
    url,
    payload,
    lastError,
    failedAt: new Date().toISOString(),
    attempts: MAX_RETRIES,
  });
  throw new Error(`[webhook] All ${MAX_RETRIES} attempts failed. Payload in DLQ.`);
}

// ── Config-based delivery (used by watch-events.ts) ──────────────────────────

// Exported to allow injecting a mock fetch during tests
export let _webhookFetch = global.fetch;
export function setWebhookFetch(mock: typeof global.fetch) {
  _webhookFetch = mock;
}

export interface WebhookConfig {
  url: string;
  secret: string;
  dlqFile: string;
  maxRetries?: number;
}

/**
 * Serializes the payload, signs it with HMAC-SHA256, and sends it to the webhook URL.
 * Retries on transient errors (network errors, 408, 429, 5xx) with exponential backoff.
 * Writes to a Dead Letter Queue file on permanent failure.
 */
export async function sendWebhook(payload: unknown, config: WebhookConfig): Promise<void> {
  const body = JSON.stringify(payload);
  const legacySignature = createHmac("sha256", config.secret).update(body).digest("hex");
  const maxRetries = config.maxRetries ?? 5;
  const maxAttempts = 1 + maxRetries;

  let attempt = 1;
  let lastError: string | null = null;

  while (attempt <= maxAttempts) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await _webhookFetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Signed per attempt so retries carry a fresh timestamp.
          ...signWebhookPayload(config.secret, body),
          ...(SEND_LEGACY_SIGNATURE ? { "X-PayFlow-Signature": legacySignature } : {}),
          "Connection": "close",
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return; // Delivery success
      }

      const status = response.status;
      const isTransient = status === 408 || status === 429 || status >= 500;

      if (!isTransient) {
        lastError = `HTTP ${status}`;
        break; // Permanent client failure, do not retry
      }

      lastError = `HTTP ${status}`;

      // Respect Retry-After for 429 Responses
      if (status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const delay = parseInt(retryAfter, 10);
          if (!isNaN(delay)) {
            // Cap at 30 seconds
            await sleep(Math.min(delay * 1000, 30000));
            attempt++;
            continue;
          }
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Treat network errors or AbortError (timeout) as transient
    }

    if (attempt < maxAttempts) {
      // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
      await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 30000));
    }
    attempt++;
  }

  // Reached permanent failure or exhausted retries
  logger.error(`Webhook delivery failed permanently after ${attempt - 1} attempts. Writing to DLQ.`);
  await writeConfigDlq(payload, config, lastError, attempt - 1);
}

// Exported for overriding in tests
export let sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
export function setSleep(mock: (ms: number) => Promise<void>) {
  sleep = mock;
}

async function writeConfigDlq(payload: unknown, config: WebhookConfig, error: string | null, attempts: number): Promise<void> {
  const dlqEntry = {
    timestamp: new Date().toISOString(),
    destination: config.url, // Only save URL context, never the secret
    error,
    attempts,
    payload,
  };
  try {
    await appendJsonLine(config.dlqFile, dlqEntry);
  } catch (dlqErr) {
    logger.error(`Failed to write to DLQ (${config.dlqFile}): ${dlqErr}`);
  }
}

// ── CLI Entry-point ───────────────────────────────────────────────────────────

// Exact entry-point check: `endsWith("webhook.ts")` also matched test-webhook.ts.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!WEBHOOK_URL) {
    console.error("Error: WEBHOOK_URL environment variable is required");
    process.exit(1);
  }
  if (!WEBHOOK_SECRET) {
    console.error("Error: WEBHOOK_SECRET environment variable is required");
    process.exit(1);
  }

  const samplePayload = {
    event: "test",
    generated_at: new Date().toISOString(),
    message: "Webhook test from PayFlow scripts",
  };

  deliverWebhook(WEBHOOK_URL, samplePayload).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
