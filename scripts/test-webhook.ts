#!/usr/bin/env tsx
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { setWebhookFetch, sendWebhook, WebhookConfig, setSleep } from "./webhook.js";

import { Server as HttpServer } from "node:http";

async function runTestServer(): Promise<{ server: HttpServer; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const expectedSignature = createHmac("sha256", "test-secret-key").update(body).digest("hex");
        const receivedSignature = req.headers["x-payflow-signature"];
        if (receivedSignature !== expectedSignature) {
          res.writeHead(400);
          res.end("Invalid Signature");
          return;
        }

        if (req.url === "/success") {
          res.writeHead(200);
          res.end("OK");
        } else if (req.url === "/transient") {
          res.writeHead(500);
          res.end("Internal Server Error");
        } else if (req.url === "/rate-limited") {
          res.writeHead(429, { "Retry-After": "1" });
          res.end("Rate Limited");
        } else if (req.url === "/permanent") {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });
    });
    server.listen(0, () => {
      resolve({ server, port: (server.address() as any).port });
    });
  });
}

async function runTests() {
  const { server, port } = await runTestServer();
  const baseUrl = `http://localhost:${port}`;
  const secret = "test-secret-key";

  const config: WebhookConfig = {
    url: "",
    secret,
    dlqFile: "data/test-dlq.jsonl",
    maxRetries: 3
  };

  let fetchCallCount = 0;

  // Inject mock fetch to count calls
  const originalFetch = global.fetch;
  setWebhookFetch(async (url, init) => {
    fetchCallCount++;
    return originalFetch(url, init);
  });

  // Inject mock sleep to speed up tests
  setSleep(async () => {});

  const payload = { event_id: "123", type: "test" };
  const bodyStr = JSON.stringify(payload);
  const expectedSig = createHmac("sha256", secret).update(bodyStr).digest("hex");

  console.log("Testing successful delivery...");
  fetchCallCount = 0;
  await sendWebhook(payload, { ...config, url: `${baseUrl}/success` });
  if (fetchCallCount !== 1) throw new Error(`Expected 1 fetch call, got ${fetchCallCount}`);

  console.log("Testing permanent failure...");
  fetchCallCount = 0;
  await sendWebhook(payload, { ...config, url: `${baseUrl}/permanent` });
  if (fetchCallCount !== 1) throw new Error(`Expected 1 fetch call for permanent failure, got ${fetchCallCount}`);

  console.log("Testing transient failure retries...");
  fetchCallCount = 0;
  await sendWebhook(payload, { ...config, url: `${baseUrl}/transient` });
  if (fetchCallCount !== 4) throw new Error(`Expected 4 fetch calls for transient failure, got ${fetchCallCount}`);

  console.log("Testing rate limiting with Retry-After...");
  fetchCallCount = 0;
  await sendWebhook(payload, { ...config, url: `${baseUrl}/rate-limited` });
  if (fetchCallCount !== 4) throw new Error(`Expected 4 fetch calls for rate limited, got ${fetchCallCount}`);

  console.log("All webhook utility tests passed!");
  server.close();
}

runTests().catch(console.error);
