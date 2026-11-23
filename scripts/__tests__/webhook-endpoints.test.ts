/**
 * Multiple webhook endpoints, event filters and secret rotation (#1485).
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseWebhookEndpoints,
  endpointsForEvent,
  dispatchWebhookEvent,
  setWebhookFetch,
  verifyWebhookSignature,
  type WebhookEndpoint,
} from "../webhook";

const DLQ = join(tmpdir(), `pf-endpoints-dlq-${process.pid}.jsonl`);

type Delivery = { url: string; body: string; headers: Record<string, string> };
let deliveries: Delivery[] = [];

beforeEach(() => {
  deliveries = [];
  setWebhookFetch((async (url: string, init?: RequestInit) => {
    deliveries.push({ url, body: String(init?.body), headers: init?.headers as Record<string, string> });
    return new Response(null, { status: 200 });
  }) as typeof fetch);
});

afterEach(() => setWebhookFetch(globalThis.fetch));

describe("parseWebhookEndpoints", () => {
  it("parses endpoints, filters and env-referenced secrets", () => {
    const eps = parseWebhookEndpoints(
      JSON.stringify([
        { id: "billing", url: "https://billing.example.com/hook", events: ["charged"], secrets: [{ id: "k1", secretEnv: "BILLING_SECRET" }] },
        { id: "all", url: "https://all.example.com/hook", secrets: [{ id: "a1", secret: "s-all" }] },
      ]),
      { BILLING_SECRET: "s-billing" },
    );
    expect(eps[0]).toEqual({ id: "billing", url: "https://billing.example.com/hook", events: ["charged"], secrets: [{ id: "k1", secret: "s-billing" }] });
    expect(eps[1].events).toBeUndefined();
  });

  it.each([
    ["duplicate ids", [{ id: "a", url: "https://x.example", secrets: [{ id: "k", secret: "s" }] }, { id: "a", url: "https://y.example", secrets: [{ id: "k", secret: "s" }] }]],
    ["more than two secrets", [{ id: "a", url: "https://x.example", secrets: [{ id: "1", secret: "s" }, { id: "2", secret: "s" }, { id: "3", secret: "s" }] }]],
    ["no secrets", [{ id: "a", url: "https://x.example", secrets: [] }]],
    ["non-http url", [{ id: "a", url: "ftp://x.example", secrets: [{ id: "k", secret: "s" }] }]],
    ["both secret and secretEnv", [{ id: "a", url: "https://x.example", secrets: [{ id: "k", secret: "s", secretEnv: "E" }] }]],
    ["empty list", []],
  ])("rejects %s", (_name, config) => {
    expect(() => parseWebhookEndpoints(JSON.stringify(config), {})).toThrow();
  });

  it("fails when a secretEnv variable is missing", () => {
    const cfg = [{ id: "a", url: "https://x.example", secrets: [{ id: "k", secretEnv: "MISSING_SECRET" }] }];
    expect(() => parseWebhookEndpoints(JSON.stringify(cfg), {})).toThrow(/MISSING_SECRET/);
  });
});

describe("event routing", () => {
  const endpoints: WebhookEndpoint[] = [
    { id: "billing", url: "https://billing.example.com", events: ["charged", "cancelled"], secrets: [{ id: "b1", secret: "sb" }] },
    { id: "lifecycle", url: "https://lifecycle.example.com", events: ["subscribed", "cancelled"], secrets: [{ id: "l1", secret: "sl" }] },
    { id: "everything", url: "https://all.example.com", events: ["*"], secrets: [{ id: "e1", secret: "se" }] },
    { id: "unfiltered", url: "https://unfiltered.example.com", secrets: [{ id: "u1", secret: "su" }] },
  ];

  it("selects endpoints per filter", () => {
    expect(endpointsForEvent(endpoints, "charged").map((e) => e.id)).toEqual(["billing", "everything", "unfiltered"]);
    expect(endpointsForEvent(endpoints, "cancelled").map((e) => e.id)).toEqual(["billing", "lifecycle", "everything", "unfiltered"]);
    expect(endpointsForEvent(endpoints, "paused").map((e) => e.id)).toEqual(["everything", "unfiltered"]);
  });

  it("delivers each event only to matching endpoints, signed with that endpoint's key", async () => {
    await dispatchWebhookEvent("subscribed", { type: "subscribed" }, endpoints, DLQ);

    expect(deliveries.map((d) => d.url).sort()).toEqual(
      ["https://all.example.com", "https://lifecycle.example.com", "https://unfiltered.example.com"],
    );
    const lifecycle = deliveries.find((d) => d.url === "https://lifecycle.example.com")!;
    expect(lifecycle.headers["X-PayFlow-Key-Id"]).toBe("l1");
    expect(verifyWebhookSignature({
      secret: "sl", body: lifecycle.body,
      timestamp: lifecycle.headers["X-PayFlow-Timestamp"], signature: lifecycle.headers["X-PayFlow-Signature-V2"],
    })).toBe(true);
  });
});

describe("secret rotation without downtime", () => {
  const rotating: WebhookEndpoint = {
    id: "merchant",
    url: "https://merchant.example.com",
    secrets: [{ id: "k2", secret: "new-secret" }, { id: "k1", secret: "old-secret" }],
  };

  async function deliver(endpoint: WebhookEndpoint): Promise<Delivery> {
    await dispatchWebhookEvent("charged", { type: "charged", amount: "10" }, [endpoint], DLQ);
    return deliveries[deliveries.length - 1];
  }

  const verifyAs = (secret: string | string[], d: Delivery) =>
    verifyWebhookSignature({
      secret,
      body: d.body,
      timestamp: d.headers["X-PayFlow-Timestamp"],
      signature: d.headers["X-PayFlow-Signature-V2"],
      signatures: d.headers["X-PayFlow-Signatures"],
    });

  it("signs with every active key so receivers on either secret keep verifying", async () => {
    const d = await deliver(rotating);

    expect(d.headers["X-PayFlow-Key-Id"]).toBe("k2");
    expect(d.headers["X-PayFlow-Signatures"]).toMatch(/^k2=[0-9a-f]{64},k1=[0-9a-f]{64}$/);
    expect(verifyAs("old-secret", d)).toBe(true); // receiver not yet updated
    expect(verifyAs("new-secret", d)).toBe(true); // receiver already updated
    expect(verifyAs(["new-secret", "old-secret"], d)).toBe(true); // receiver accepting both
  });

  it("stops accepting the old secret once it is removed from the config", async () => {
    const d = await deliver({ ...rotating, secrets: [rotating.secrets[0]] });

    expect(d.headers["X-PayFlow-Signatures"]).toMatch(/^k2=[0-9a-f]{64}$/);
    expect(verifyAs("new-secret", d)).toBe(true);
    expect(verifyAs("old-secret", d)).toBe(false);
  });
});
