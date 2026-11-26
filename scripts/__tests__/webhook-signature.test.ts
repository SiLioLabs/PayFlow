/**
 * Timestamped webhook signatures / replay protection (#1486).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  sendWebhook,
  setWebhookFetch,
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
} from "../webhook";

const SECRET = "whsec_test";
const BODY = JSON.stringify({ event: "charged", user: "GUSER", amount: "50000000" });
const T0 = 1_800_000_000;

describe("signWebhookPayload / verifyWebhookSignature", () => {
  it("signs '<timestamp>.<body>' and verifies within tolerance", () => {
    const headers = signWebhookPayload(SECRET, BODY, T0);

    expect(headers["X-PayFlow-Timestamp"]).toBe(String(T0));
    expect(headers["X-PayFlow-Signature-V2"]).toBe(
      createHmac("sha256", SECRET).update(`${T0}.${BODY}`).digest("hex"),
    );
    expect(verifyWebhookSignature({
      secret: SECRET, body: BODY, now: T0 + 10,
      timestamp: headers["X-PayFlow-Timestamp"], signature: headers["X-PayFlow-Signature-V2"],
    })).toBe(true);
  });

  it("rejects a replay outside the tolerance window", () => {
    const h = signWebhookPayload(SECRET, BODY, T0);
    const replayAt = T0 + DEFAULT_SIGNATURE_TOLERANCE_SECONDS + 1;

    expect(verifyWebhookSignature({
      secret: SECRET, body: BODY, now: replayAt,
      timestamp: h["X-PayFlow-Timestamp"], signature: h["X-PayFlow-Signature-V2"],
    })).toBe(false);
  });

  it("rejects timestamps too far in the future, and honours a custom tolerance", () => {
    const h = signWebhookPayload(SECRET, BODY, T0 + 600);
    const args = { secret: SECRET, body: BODY, now: T0, timestamp: h["X-PayFlow-Timestamp"], signature: h["X-PayFlow-Signature-V2"] };

    expect(verifyWebhookSignature(args)).toBe(false);
    expect(verifyWebhookSignature({ ...args, toleranceSeconds: 900 })).toBe(true);
  });

  it("rejects a replayed signature with a refreshed timestamp", () => {
    const h = signWebhookPayload(SECRET, BODY, T0);
    expect(verifyWebhookSignature({
      secret: SECRET, body: BODY, now: T0 + 1000,
      timestamp: String(T0 + 1000), signature: h["X-PayFlow-Signature-V2"],
    })).toBe(false);
  });

  it("rejects a tampered body, a wrong secret and missing headers", () => {
    const h = signWebhookPayload(SECRET, BODY, T0);
    const base = { now: T0, timestamp: h["X-PayFlow-Timestamp"], signature: h["X-PayFlow-Signature-V2"] };

    expect(verifyWebhookSignature({ ...base, secret: SECRET, body: BODY.replace("50000000", "1") })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secret: "other", body: BODY })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secret: SECRET, body: BODY, timestamp: undefined })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secret: SECRET, body: BODY, signature: undefined })).toBe(false);
  });
});

describe("sendWebhook headers", () => {
  afterEach(() => setWebhookFetch(globalThis.fetch));

  it("sends X-PayFlow-Timestamp, X-PayFlow-Signature-V2 and the legacy header", async () => {
    let seen: Record<string, string> = {};
    setWebhookFetch((async (_url: string, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>;
      return new Response(null, { status: 200 });
    }) as typeof fetch);

    const before = Math.floor(Date.now() / 1000);
    await sendWebhook(JSON.parse(BODY), { url: "https://hooks.example.com", secret: SECRET, dlqFile: join(tmpdir(), "pf-dlq.jsonl") });

    expect(Number(seen["X-PayFlow-Timestamp"])).toBeGreaterThanOrEqual(before);
    expect(verifyWebhookSignature({
      secret: SECRET, body: BODY, timestamp: seen["X-PayFlow-Timestamp"], signature: seen["X-PayFlow-Signature-V2"],
    })).toBe(true);
    expect(seen["X-PayFlow-Signature"]).toBe(createHmac("sha256", SECRET).update(BODY).digest("hex"));
  });
});
