import { createHmac } from "node:crypto";
import { appendJsonLine } from "./soroban-admin.js";
import { logger } from "./logger.js";

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
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");
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
          "X-PayFlow-Signature": signature,
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
  await writeToDlq(payload, config, lastError, attempt - 1);
}

// Exported for overriding in tests
export let sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
export function setSleep(mock: (ms: number) => Promise<void>) {
  sleep = mock;
}

async function writeToDlq(payload: unknown, config: WebhookConfig, error: string | null, attempts: number): Promise<void> {
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
