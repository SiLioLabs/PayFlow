/**
 * health-check.ts — Contract health check script for FlowPay.
 *
 * Shallow mode (default):
 *   Verifies contract responsiveness via get_schema_version() and
 *   get_active_count(). Suitable for Docker health checks and
 *   lightweight cron-based monitoring.
 *
 * Deep mode (--deep or HEALTH_DEEP=true):
 *   Calls the on-chain contract_health_check() to obtain a full
 *   HealthReport, samples get_batch_charge_estimate with an empty
 *   address list to verify the charge-path liveness, and exits
 *   non-zero when any critical invariant fails (paused, unhealthy,
 *   RPC decode errors).
 *
 * Usage:
 *   npx tsx scripts/health-check.ts            # shallow (default)
 *   npx tsx scripts/health-check.ts --deep     # deep checks
 *   npx tsx scripts/health-check.ts --json     # JSON output (any mode)
 *   npx tsx scripts/health-check.ts --deep --json
 *
 * Environment variables:
 *   CONTRACT_ID   — Deployed FlowPay contract ID (required)
 *   RPC_URL       — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *   NETWORK       — Network passphrase identifier (default: testnet)
 *   HEALTH_DEEP   — Set "true" to enable deep checks without --deep flag
 *
 * Exit codes:
 *   0 — healthy
 *   1 — unhealthy (one or more calls failed, returned invalid data,
 *       or a critical invariant was violated)
 */

import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Address,
} from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";
import { logger } from "./logger";

// ── Configuration ────────────────────────────────────────────────────────────

const CONTRACT_ID =
  process.env.CONTRACT_ID || process.env.VITE_CONTRACT_ID || "";
const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK === "mainnet"
    ? Networks.PUBLIC
    : process.env.VITE_NETWORK_PASSPHRASE || Networks.TESTNET;

// A zero-funded source account used solely for simulating read-only calls.
const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DEEP = args.includes("--deep") || process.env.HEALTH_DEEP === "true";
const JSON_OUTPUT = args.includes("--json");

// ── Types ────────────────────────────────────────────────────────────────────

/** Mirrors the on-chain HealthReport struct returned by contract_health_check. */
interface HealthReport {
  is_healthy: boolean;
  contract_paused: boolean;
  token_configured: boolean;
  admin_configured: boolean;
  instance_ttl_ledgers: number;
  active_subscription_count: number;
  schema_version: number;
  fee_collector_set: boolean;
  global_volume_utilization_pct: number;
  pending_merchant_rev_count: number;
}

/** Typed probe result for structured output. */
interface ProbeResult {
  name: string;
  ok: boolean;
  detail?: string;
  data?: unknown;
}

/** Top-level output shape for JSON mode. */
interface HealthCheckOutput {
  status: "healthy" | "unhealthy";
  mode: "shallow" | "deep";
  contract: string;
  timestamp: string;
  probes: ProbeResult[];
  healthReport?: HealthReport;
  batchEstimate?: string;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString();
}

function log(status: "healthy" | "unhealthy", detail?: string): void {
  if (JSON_OUTPUT) return; // suppressed in JSON mode; written at the end
  const line = `${timestamp()} contract=${CONTRACT_ID || "NOT_SET"} status=${status}`;
  if (detail) {
    logger.info(`${line} detail=${detail}`);
  } else {
    logger.info(line);
  }
}

function logJSON(output: HealthCheckOutput): void {
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

/**
 * Simulate a read-only contract call and return the raw result xdr.
 */
async function simulateCall(
  server: MultiEndpointServer,
  fnName: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(SIMULATION_SOURCE).catch(async () => {
    // For simulation-only calls, build a synthetic account if lookup fails.
    return new Account(SIMULATION_SOURCE, "0");
  });

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(fnName, ...args))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);

  if ("error" in simulation && simulation.error) {
    throw new Error(`Simulation failed for ${fnName}: ${simulation.error}`);
  }

  if (!("result" in simulation) || !simulation.result) {
    throw new Error(`No result returned for ${fnName}`);
  }

  return simulation.result;
}

/**
 * Decode a ScVal into a JavaScript object. The Stellar SDK's simulation
 * response may return decoded structs with symbol-keyed properties, raw
 * xdr.ScVal, or already-decoded JS values depending on the SDK version.
 */
function decodeScVal(val: unknown): unknown {
  if (val == null) return val;
  // If already a plain JS value (not xdr), return as-is
  if (typeof val === "boolean" || typeof val === "number" || typeof val === "string") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(decodeScVal);
  }
  if (typeof val === "object") {
    // Check for xdr.ScVal marker (has _switch, _arm, _value etc.)
    const obj = val as Record<string, unknown>;
    if ("b" in obj && typeof obj.b === "function") {
      // bool ScVal
      return (obj as { b: () => boolean }).b();
    }
    if ("u32" in obj) return Number((obj as { u32: number }).u32);
    if ("u64" in obj) {
      const v = (obj as { u64: { toString(): string } }).u64;
      return Number(v.toString());
    }
    if ("i128" in obj) {
      const v = (obj as { i128: { hi: number; lo: number } }).i128;
      return Number(v.hi) * 2 ** 32 + Number(v.lo);
    }
    // Map / struct with symbol keys — return as-is
    return obj;
  }
  return val;
}

const HEALTH_REPORT_FIELDS = [
  "is_healthy",
  "contract_paused",
  "token_configured",
  "admin_configured",
  "instance_ttl_ledgers",
  "active_subscription_count",
  "schema_version",
  "fee_collector_set",
  "global_volume_utilization_pct",
  "pending_merchant_rev_count",
] as const;

/**
 * Extract a HealthReport from a simulation result (ScVal or decoded object).
 * The contract returns a struct; the SDK simulation result may be the
 * raw xdr or a decoded object depending on the SDK version.
 */
function extractHealthReport(result: unknown): HealthReport {
  // If it's already a plain object with the expected shape, use it directly
  if (
    result &&
    typeof result === "object" &&
    "is_healthy" in (result as Record<string, unknown>)
  ) {
    return result as HealthReport;
  }

  // Try decoding as ScVal
  const decoded = decodeScVal(result);
  if (
    decoded &&
    typeof decoded === "object" &&
    "is_healthy" in (decoded as Record<string, unknown>)
  ) {
    return decoded as HealthReport;
  }

  // If the result is an array/tuple, map fields by position
  if (Array.isArray(result) || Array.isArray(decoded)) {
    const arr = (Array.isArray(result) ? result : decoded) as unknown[];
    if (arr.length >= 10) {
      const report: Record<string, unknown> = {};
      for (let i = 0; i < HEALTH_REPORT_FIELDS.length; i++) {
        report[HEALTH_REPORT_FIELDS[i]] = decodeScVal(arr[i]);
      }
      return report as unknown as HealthReport;
    }
  }

  // If it looks like an xdr.ScStruct or map with symbol keys, try extracting
  // fields by name from the decoded value
  if (decoded && typeof decoded === "object") {
    const obj = decoded as Record<string, unknown>;
    const hasAllFields = HEALTH_REPORT_FIELDS.every((f) => f in obj);
    if (hasAllFields) {
      const report: Record<string, unknown> = {};
      for (const field of HEALTH_REPORT_FIELDS) {
        report[field] = decodeScVal(obj[field]);
      }
      return report as unknown as HealthReport;
    }
  }

  throw new Error("Unable to decode HealthReport from simulation result");
}

// ── Deep probe functions ─────────────────────────────────────────────────────

/**
 * Call contract_health_check and validate the HealthReport invariants.
 * Returns a ProbeResult indicating pass/fail.
 */
async function probeContractHealthCheck(
  server: MultiEndpointServer,
): Promise<ProbeResult> {
  try {
    const result = await simulateCall(server, "contract_health_check");
    const report = extractHealthReport(result);

    // Validate critical invariants
    const failures: string[] = [];

    if (report.contract_paused) {
      failures.push("contract is paused");
    }
    if (!report.is_healthy) {
      failures.push("is_healthy is false");
    }
    if (!report.token_configured) {
      failures.push("token not configured");
    }
    if (!report.admin_configured) {
      failures.push("admin not configured");
    }
    if (report.instance_ttl_ledgers <= 17_280) {
      failures.push(
        `instance_ttl_ledgers=${report.instance_ttl_ledgers} (below threshold 17280)`,
      );
    }

    const ok = failures.length === 0;
    return {
      name: "contract_health_check",
      ok,
      detail: ok ? "all invariants pass" : failures.join("; "),
      data: report,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "contract_health_check",
      ok: false,
      detail: message,
    };
  }
}

/**
 * Call get_batch_charge_estimate with an empty address list to verify the
 * charge path is responsive (RPC decode works, contract logic reachable).
 * The contract returns an empty Vec for an empty input — any error here
 * signals schema drift, RPC issues, or a broken charge path.
 */
async function probeBatchEstimate(
  server: MultiEndpointServer,
): Promise<ProbeResult> {
  try {
    // get_batch_charge_estimate expects Vec<Address>. An empty vec is valid.
    const emptyVec = nativeToScVal([], { type: "vec" });
    const result = await simulateCall(
      server,
      "get_batch_charge_estimate",
      [emptyVec],
    );

    // The result should be an empty Vec — any decode failure means the
    // charge path has schema drift.
    const decoded = decodeScVal(result);
    const isEmpty =
      decoded === null ||
      decoded === undefined ||
      (Array.isArray(decoded) && decoded.length === 0);

    if (!isEmpty) {
      return {
        name: "get_batch_charge_estimate",
        ok: true, // non-empty is unexpected for empty input but not unhealthy
        detail: `unexpected non-empty result (${Array.isArray(decoded) ? decoded.length : "unknown"} items)`,
        data: decoded,
      };
    }

    return {
      name: "get_batch_charge_estimate",
      ok: true,
      detail: "empty list accepted, charge path responsive",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "get_batch_charge_estimate",
      ok: false,
      detail: `charge path probe failed: ${message}`,
    };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate configuration
  if (!CONTRACT_ID) {
    log("unhealthy", "CONTRACT_ID environment variable is not set");
    if (JSON_OUTPUT) {
      logJSON({
        status: "unhealthy",
        mode: DEEP ? "deep" : "shallow",
        contract: "",
        timestamp: timestamp(),
        probes: [],
        error: "CONTRACT_ID environment variable is not set",
      });
    }
    process.exit(1);
  }

  const server = new MultiEndpointServer(RPC_URL);
  const probes: ProbeResult[] = [];
  let healthReport: HealthReport | undefined;
  let batchEstimate: string | undefined;
  let overallError: string | undefined;

  try {
    // ── Shallow probes (always run) ───────────────────────────────────

    // Probe 1: get_schema_version
    try {
      const schemaResult = await simulateCall(server, "get_schema_version");
      if (schemaResult === undefined || schemaResult === null) {
        probes.push({
          name: "get_schema_version",
          ok: false,
          detail: "returned no data",
        });
      } else {
        probes.push({
          name: "get_schema_version",
          ok: true,
          detail: `schema version response received`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      probes.push({
        name: "get_schema_version",
        ok: false,
        detail: message,
      });
    }

    // Probe 2: get_active_count
    try {
      const countResult = await simulateCall(server, "get_active_count");
      if (countResult === undefined || countResult === null) {
        probes.push({
          name: "get_active_count",
          ok: false,
          detail: "returned no data",
        });
      } else {
        probes.push({
          name: "get_active_count",
          ok: true,
          detail: "active count response received",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      probes.push({
        name: "get_active_count",
        ok: false,
        detail: message,
      });
    }

    // ── Deep probes (only when --deep or HEALTH_DEEP=true) ────────────

    if (DEEP) {
      // Probe 3: contract_health_check
      const healthProbe = await probeContractHealthCheck(server);
      probes.push(healthProbe);
      if (healthProbe.data && typeof healthProbe.data === "object") {
        healthReport = healthProbe.data as HealthReport;
      }

      // Probe 4: get_batch_charge_estimate (empty list liveness)
      const batchProbe = await probeBatchEstimate(server);
      probes.push(batchProbe);
      if (batchProbe.detail) {
        batchEstimate = batchProbe.detail;
      }
    }

    // ── Evaluate overall status ───────────────────────────────────────

    // All probes must pass
    const allProbesPassed = probes.every((p) => p.ok);

    // In deep mode, also require healthReport.is_healthy and not paused
    let deepInvariantsPass = true;
    if (DEEP && healthReport) {
      deepInvariantsPass =
        healthReport.is_healthy && !healthReport.contract_paused;
    }

    const healthy = allProbesPassed && deepInvariantsPass;

    if (healthy) {
      log("healthy");
      if (JSON_OUTPUT) {
        logJSON({
          status: "healthy",
          mode: DEEP ? "deep" : "shallow",
          contract: CONTRACT_ID,
          timestamp: timestamp(),
          probes,
          healthReport,
          batchEstimate,
        });
      }
      process.exit(0);
    } else {
      const reasons = probes
        .filter((p) => !p.ok)
        .map((p) => `${p.name}: ${p.detail}`)
        .join("; ");
      log("unhealthy", reasons || "invariant check failed");

      if (!reasons) {
        overallError = "deep invariant check failed (paused or unhealthy)";
      }

      if (JSON_OUTPUT) {
        logJSON({
          status: "unhealthy",
          mode: "deep",
          contract: CONTRACT_ID,
          timestamp: timestamp(),
          probes,
          healthReport,
          batchEstimate,
          error: overallError || reasons,
        });
      }
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log("unhealthy", message);
    if (JSON_OUTPUT) {
      logJSON({
        status: "unhealthy",
        mode: DEEP ? "deep" : "shallow",
        contract: CONTRACT_ID,
        timestamp: timestamp(),
        probes,
        healthReport,
        batchEstimate,
        error: message,
      });
    }
    process.exit(1);
  }
}

main();
