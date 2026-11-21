/**
 * scripts/__tests__/metrics-server.test.ts
 *
 * Tests for the Prometheus metrics server (issue #1479).
 *
 * Covers:
 *  - Counter, Gauge, Histogram serialisation
 *  - /metrics endpoint returns correct content type and body
 *  - /health endpoint returns {status: "ok"}
 *  - 404 for unknown paths
 *  - startMetricsServer / stopMetricsServer lifecycle
 */

import { describe, it, expect, afterEach } from "vitest";
import http from "http";
import {
  chargesTotalCounter,
  batchDurationHistogram,
  feeSpendGauge,
  rpcErrorCounter,
  heartbeatCounter,
  dlqSizeGauge,
  startMetricsServer,
  stopMetricsServer,
} from "../metrics-server";

// ── Metric primitive tests ────────────────────────────────────────────────────

describe("Counter", () => {
  it("starts at 0 and increments", () => {
    heartbeatCounter.inc();
    const output = (heartbeatCounter as any).serialize() as string;
    expect(output).toContain("payflow_keeper_heartbeat_total");
    // Value will be ≥ 1 because other tests may have incremented
    expect(output).toMatch(/payflow_keeper_heartbeat_total \d+/);
  });

  it("tracks labels independently", () => {
    chargesTotalCounter.inc({ result: "Charged" }, 3);
    chargesTotalCounter.inc({ result: "Failed" }, 1);
    const output = (chargesTotalCounter as any).serialize() as string;
    expect(output).toContain('result="Charged"');
    expect(output).toContain('result="Failed"');
  });
});

describe("Gauge", () => {
  it("set and read", () => {
    feeSpendGauge.set(42000);
    const output = (feeSpendGauge as any).serialize() as string;
    expect(output).toContain("payflow_keeper_fee_spend_stroops 42000");
  });

  it("inc increments the gauge", () => {
    dlqSizeGauge.set(0);
    dlqSizeGauge.inc();
    dlqSizeGauge.inc();
    const output = (dlqSizeGauge as any).serialize() as string;
    expect(output).toContain("payflow_keeper_dlq_size 2");
  });
});

describe("Histogram", () => {
  it("records observations and updates sum/count", () => {
    batchDurationHistogram.observe(0.5);
    batchDurationHistogram.observe(2);
    const output = (batchDurationHistogram as any).serialize() as string;
    expect(output).toContain("payflow_keeper_batch_duration_seconds_sum");
    expect(output).toContain("payflow_keeper_batch_duration_seconds_count");
    expect(output).toContain('le="+Inf"');
  });
});

// ── HTTP server ───────────────────────────────────────────────────────────────

function fetchUrl(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body,
          headers: res.headers as Record<string, string>,
        })
      );
    }).on("error", reject);
  });
}

describe("metrics HTTP server", () => {
  let server: ReturnType<typeof startMetricsServer>;

  afterEach(async () => {
    await stopMetricsServer();
  });

  it("serves /metrics with correct content-type", async () => {
    server = startMetricsServer(19091);
    // Give the server a moment to start
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetchUrl("http://127.0.0.1:19091/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("payflow_keeper_heartbeat_total");
    expect(res.body).toContain("# HELP");
    expect(res.body).toContain("# TYPE");
  });

  it("serves /health with {status: ok}", async () => {
    server = startMetricsServer(19092);
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetchUrl("http://127.0.0.1:19092/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    server = startMetricsServer(19093);
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetchUrl("http://127.0.0.1:19093/unknown");
    expect(res.status).toBe(404);
  });
});
