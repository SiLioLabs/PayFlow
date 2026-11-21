/**
 * scripts/metrics-server.ts — Prometheus metrics for the PayFlow keeper.
 *
 * Exposes a /metrics endpoint on METRICS_PORT (default 9091).
 * All keeper code imports individual counters/gauges from here.
 *
 * Metrics exposed:
 *   payflow_keeper_charges_total{result}       - keeper charge call outcomes
 *   payflow_keeper_batch_duration_seconds      - batch processing latency histogram
 *   payflow_keeper_fee_spend_stroops           - latest resource fee paid (gauge)
 *   payflow_keeper_adaptive_fee_stroops_bucket - histogram of adaptive fees calculated
 *   payflow_keeper_fee_bump_total              - number of fee-bump envelopes submitted
 *   payflow_keeper_rpc_errors_total{operation} - RPC error counter
 *   payflow_keeper_dlq_size                    - dead-letter queue depth (gauge)
 *   payflow_keeper_last_run_timestamp_seconds  - unix timestamp of last keeper run
 *   payflow_keeper_heartbeat_total             - monotonically increasing heartbeat
 */

import http from "http";
import { METRICS_PORT } from "./config";

// ── Minimal Prometheus counter / gauge / histogram ────────────────────────────
// We implement a lightweight subset to avoid a hard prom-client dependency
// while keeping the output 100% Prometheus-compatible text format.

interface LabelSet {
  [key: string]: string | number;
}

class Counter {
  private values = new Map<string, number>();

  constructor(
    private readonly name: string,
    private readonly help: string,
    private readonly labelNames: string[] = []
  ) {}

  inc(labels: LabelSet = {}, amount = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, value] of this.values) {
        lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
      }
    }
    return lines.join("\n");
  }

  private labelKey(labels: LabelSet): string {
    return this.labelNames
      .filter((n) => labels[n] !== undefined)
      .map((n) => `${n}="${labels[n]}"`)
      .join(",");
  }
}

class Gauge {
  private value = 0;

  constructor(
    private readonly name: string,
    private readonly help: string
  ) {}

  set(value: number): void {
    this.value = value;
  }

  inc(amount = 1): void {
    this.value += amount;
  }

  serialize(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      `${this.name} ${this.value}`,
    ].join("\n");
  }
}

class Histogram {
  private buckets: Map<number, number>;
  private sum = 0;
  private count = 0;

  constructor(
    private readonly name: string,
    private readonly help: string,
    bounds: number[]
  ) {
    this.buckets = new Map(bounds.map((b) => [b, 0]));
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;
    for (const bound of this.buckets.keys()) {
      if (value <= bound) {
        this.buckets.set(bound, (this.buckets.get(bound) ?? 0) + 1);
      }
    }
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [bound, cnt] of this.buckets) {
      lines.push(`${this.name}_bucket{le="${bound}"} ${cnt}`);
    }
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${this.name}_sum ${this.sum}`);
    lines.push(`${this.name}_count ${this.count}`);
    return lines.join("\n");
  }
}

// ── Metric instances ──────────────────────────────────────────────────────────

export const chargesTotalCounter = new Counter(
  "payflow_keeper_charges_total",
  "Total number of charge call outcomes by result.",
  ["result"]
);

export const batchDurationHistogram = new Histogram(
  "payflow_keeper_batch_duration_seconds",
  "Histogram of keeper batch processing latency in seconds.",
  [0.1, 0.5, 1, 2, 5, 10, 30, 60]
);

export const feeSpendGauge = new Gauge(
  "payflow_keeper_fee_spend_stroops",
  "Latest resource fee paid by the keeper in stroops."
);

export const adaptiveFeeHistogram = new Histogram(
  "payflow_keeper_adaptive_fee_stroops",
  "Histogram of adaptive resource fees calculated (in stroops).",
  [10000, 50000, 100000, 500000, 1000000, 5000000, 10000000, 100000000]
);

export const feeBumpCounter = new Counter(
  "payflow_keeper_fee_bump_total",
  "Total number of fee-bump envelopes submitted."
);

export const rpcErrorCounter = new Counter(
  "payflow_keeper_rpc_errors_total",
  "Total RPC errors encountered by the keeper.",
  ["operation"]
);

export const dlqSizeGauge = new Gauge(
  "payflow_keeper_dlq_size",
  "Current depth of the dead-letter queue (failed batches awaiting retry)."
);

export const lastRunGauge = new Gauge(
  "payflow_keeper_last_run_timestamp_seconds",
  "Unix timestamp of the last keeper run."
);

export const heartbeatCounter = new Counter(
  "payflow_keeper_heartbeat_total",
  "Monotonically increasing heartbeat counter incremented on every keeper cycle."
);

// ── All metrics registry ──────────────────────────────────────────────────────

const ALL_METRICS = [
  chargesTotalCounter,
  batchDurationHistogram,
  feeSpendGauge,
  adaptiveFeeHistogram,
  feeBumpCounter,
  rpcErrorCounter,
  dlqSizeGauge,
  lastRunGauge,
  heartbeatCounter,
];

// ── HTTP server ───────────────────────────────────────────────────────────────

let server: http.Server | null = null;

/**
 * startMetricsServer — starts the Prometheus /metrics HTTP endpoint.
 * Call once from the keeper entry-point.
 */
export function startMetricsServer(port = METRICS_PORT): http.Server {
  server = http.createServer((req, res) => {
    if (req.url === "/metrics" && req.method === "GET") {
      const body = ALL_METRICS.map((m) => m.serialize()).join("\n\n");
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4",
        "Cache-Control": "no-cache",
      });
      res.end(body + "\n");
    } else if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[PayFlow Keeper] Metrics server listening on :${port}/metrics`);
  });

  return server;
}

/** Stop the metrics server (useful in tests). */
export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
  });
}
