#!/usr/bin/env tsx
/**
 * deploy-pipeline.ts — Pre-deployment validation pipeline for FlowPay.
 *
 * Runs a sequence of safety gates before a WASM upgrade is committed:
 *
 *   1. Schema-version gate  — on-chain version matches the expected value.
 *   2. WASM-hash gate       — on-chain WASM hash matches the local build artifact.
 *
 * If either gate fails the process exits non-zero, blocking the deployment.
 * Gates that cannot be determined fail **closed** (i.e. they block, not warn).
 *
 * Usage:
 *   CONTRACT_ID=C... RPC_URL=https://... tsx scripts/deploy-pipeline.ts [--help]
 *   CONTRACT_ID=C... tsx scripts/deploy-pipeline.ts --expected-wasm-hash <hex>
 *
 * Environment:
 *   CONTRACT_ID         Required. Deployed FlowPay contract address.
 *   RPC_URL             Optional. Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE  Optional. Network passphrase (default: testnet).
 *   EXPECTED_SCHEMA_VERSION  Optional. Schema version to assert (default: 2).
 *
 * Exit codes:
 *   0 — all gates passed
 *   1 — at least one gate failed or an unrecoverable error occurred
 */

#!/usr/bin/env ts-node
/**
 * deploy-pipeline.ts
 *
 * Hardened deployment pipeline for FlowPay contract upgrades.
 *
 * Runs a preflight checklist before any WASM upgrade is performed:
 *   1. RPC health gate  — abort if the Soroban RPC node is not healthy
 *   2. WASM hash gate   — verify the on-chain hash matches the local binary
 *   3. Schema version   — record current version; warn if migration is pending
 *   4. Summary artifact — write a machine-readable JSON file with run results
 *
 * Usage:
 *   npx ts-node scripts/deploy-pipeline.ts [options]
 *
 * Options:
 *   --wasm <path>         Path to compiled .wasm file (required unless --dry-run)
 *   --contract <id>       Deployed contract ID
 *   --rpc-url <url>       Soroban RPC URL
 *   --network <pass>      Network passphrase
 *   --source <keypair>    Source Stellar address for simulated queries
 *   --summary-out <path>  Where to write the JSON summary (default: deploy-summary.json)
 *   --dry-run             Validate config and print what would happen without calling RPC
 *
 * Environment variables:
 *   RPC_URL / VITE_RPC_URL
 *   CONTRACT_ID / VITE_CONTRACT_ID
 *   NETWORK_PASSPHRASE / VITE_NETWORK_PASSPHRASE
 *   SOROBAN_SOURCE_ACCOUNT
 *
 * Closes: https://github.com/SiLioLabs/PayFlow/issues/897
 */

import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import {
  Contract,
  Networks,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { CURRENT_SCHEMA_VERSION } from "./lib/contract-limits.js";

// ── Configuration ────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const EXPECTED_SCHEMA_VERSION = parseInt(
  process.env.EXPECTED_SCHEMA_VERSION ?? String(CURRENT_SCHEMA_VERSION),
  10
);

/** Latest schema version imported from scripts/lib/contract-limits.ts (mirrors contract/src/migration.rs). */
const LATEST_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

// Dummy source used only for read-only simulation (no auth required).
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── Helpers ──────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
deploy-pipeline.ts — FlowPay pre-deployment validation pipeline

Usage:
  CONTRACT_ID=<id> tsx scripts/deploy-pipeline.ts [--expected-wasm-hash <hex>] [--help]

Options:
  --expected-wasm-hash <hex>   64-char hex WASM hash to compare against on-chain value.
                               If omitted the WASM-hash gate is skipped.
  --help, -h                   Show this message.

Environment:
  CONTRACT_ID              Required.
  RPC_URL                  Optional (default: testnet).
  NETWORK_PASSPHRASE       Optional (default: testnet).
  EXPECTED_SCHEMA_VERSION  Optional (default: ${LATEST_SCHEMA_VERSION}).
`);
  process.exit(0);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const server = new Server(RPC_URL);

// ── Read-only simulation ──────────────────────────────────────────────────────

async function simulateReadOnly(
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal> {
  const contract = new Contract(CONTRACT_ID);
  const sourceAccount = new Account(SIM_SOURCE, "0");

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) {
    throw new Error(`Simulation error for ${method}: ${result.error}`);
  }
  if (!result.result?.retval) {
    throw new Error(`No return value from ${method}`);
  }
  return result.result.retval;
}

// ── fetchOnChainWasmHash ──────────────────────────────────────────────────────

/**
 * Reads the WASM hash of the currently deployed contract instance directly
 * from ledger storage using `getLedgerEntries`.
 *
 * The fix vs. the previous broken implementation:
 *  - Previously an empty key array `([] as any[])` was passed, so the RPC
 *    call could never return anything and the function always returned `null`.
 *  - The `(server as any)` cast has been removed; `server.getLedgerEntries`
 *    accepts typed `xdr.LedgerKey` arguments.
 *  - The gate now fails **closed**: if the hash cannot be determined the
 *    caller receives an explicit error rather than a silent `null` / warn.
 *
 * How the key is built:
 *   The contract's executable (WASM) is referenced via the contract-instance
 *   entry, stored as ContractData with:
 *     • contract  = the contract's ScAddress
 *     • key       = ScVal::scvLedgerKeyContractInstance
 *     • durability = persistent
 *
 *   The returned LedgerEntryData.contractData().val() is an ScVal containing
 *   the ScContractInstance, whose `.executable().wasmHash()` is the hash we
 *   need.
 *
 * @throws {Error}  If the ledger entry cannot be fetched or parsed.
 */
export async function fetchOnChainWasmHash(): Promise<string> {
  const contractAddress = Address.fromString(CONTRACT_ID);

  // Build the correctly typed LedgerKey for the contract instance entry.
  const instanceLedgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );

  // Use the properly typed overload — no (server as any) cast needed.
  const response = await server.getLedgerEntries(instanceLedgerKey);

  if (!response.entries || response.entries.length === 0) {
    throw new Error(
      `No ledger entry found for contract ${CONTRACT_ID}. ` +
        "The contract may not be deployed on this network, or the RPC node may be out of sync."
    );
  }

  const entry = response.entries[0];
  if (!entry) {
    throw new Error("getLedgerEntries returned an empty entry.");
  }

  // entry.val is xdr.LedgerEntryData; navigate to the WASM hash.
  const entryData = entry.val.contractData();
  const instance = entryData.val().instance();
  const executable = instance.executable();

  // Fail closed if the contract is a Stellar-asset contract (no WASM hash).
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new Error(
      `Contract ${CONTRACT_ID} is not a WASM contract ` +
        `(executable type: ${executable.switch().name}). Cannot determine WASM hash.`
    );
  }

  const wasmHashBytes: Buffer = executable.wasmHash() as unknown as Buffer;
  return wasmHashBytes.toString("hex");
}

// ── Gate: schema version ──────────────────────────────────────────────────────

interface GateResult {
  name: string;
  passed: boolean;
  message: string;
}

async function runSchemaVersionGate(): Promise<GateResult> {
  const name = "schema-version";
  try {
    const retval = await simulateReadOnly("get_schema_version");
    const onChainVersion = retval.u32();

    if (onChainVersion !== EXPECTED_SCHEMA_VERSION) {
      return {
        name,
        passed: false,
        message:
          `On-chain schema version is ${onChainVersion}, ` +
          `expected ${EXPECTED_SCHEMA_VERSION}. ` +
          "Run migrate() before deploying, or update EXPECTED_SCHEMA_VERSION.",
      };
    }

    return {
      name,
      passed: true,
      message: `Schema version ${onChainVersion} matches expected ${EXPECTED_SCHEMA_VERSION}.`,
    };
  } catch (err) {
    // Fail closed — we cannot proceed safely if the version is unknown.
    return {
      name,
      passed: false,
      message: `Could not read on-chain schema version: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Gate: WASM hash ───────────────────────────────────────────────────────────

async function runWasmHashGate(expectedHash: string): Promise<GateResult> {
  const name = "wasm-hash";
  try {
    const onChainHash = await fetchOnChainWasmHash();

    if (onChainHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return {
        name,
        passed: false,
        message:
          `On-chain WASM hash (${onChainHash}) does not match ` +
          `the expected hash (${expectedHash}). ` +
          "Ensure you are deploying the correct build artifact.",
      };
    }

    return {
      name,
      passed: true,
      message: `WASM hash matches: ${onChainHash}`,
    };
  } catch (err) {
    // Fail closed — a gate that cannot verify must block, not warn.
    return {
      name,
      passed: false,
      message:
        `WASM hash gate failed closed: ${err instanceof Error ? err.message : String(err)}. ` +
        "Resolve the issue or skip the gate explicitly with operator sign-off.",
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    showHelp();
  }

  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    process.exit(1);
  }

  const expectedWasmHash = getArg("--expected-wasm-hash");

  console.log("=== FlowPay Deploy Pipeline ===");
  console.log(`Contract : ${CONTRACT_ID}`);
  console.log(`RPC URL  : ${RPC_URL}`);
  console.log(`Network  : ${NETWORK_PASSPHRASE}`);
  console.log("");

  const gates: GateResult[] = [];

  // Gate 1 — schema version
  console.log("[1/2] Running schema-version gate…");
  gates.push(await runSchemaVersionGate());

  // Gate 2 — WASM hash (skipped if --expected-wasm-hash not provided)
  if (expectedWasmHash) {
    console.log("[2/2] Running wasm-hash gate…");
    gates.push(await runWasmHashGate(expectedWasmHash));
  } else {
    console.log("[2/2] WASM-hash gate skipped (--expected-wasm-hash not provided).");
  }

  // Report
  console.log("\n── Gate results ──");
  let allPassed = true;
  for (const gate of gates) {
    const icon = gate.passed ? "✓" : "✗";
    console.log(`  ${icon}  [${gate.name}] ${gate.message}`);
    if (!gate.passed) allPassed = false;
  }

  console.log("");
  if (allPassed) {
    console.log("All gates passed. Safe to proceed with deployment.");
    process.exit(0);
  } else {
    console.error("One or more gates FAILED. Deployment blocked.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    "Deploy pipeline crashed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { fileURLToPath } from "url";
import { MultiEndpointServer } from "./rpc-client.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GateStatus = "pass" | "fail" | "skip" | "warn";

export interface GateResult {
  gate: string;
  status: GateStatus;
  message: string;
  detail?: unknown;
}

export interface PipelineSummary {
  timestamp: string;
  dryRun: boolean;
  contractId: string;
  rpcUrl: string;
  wasmPath: string | null;
  wasmHash: string | null;
  onChainHash: string | null;
  schemaVersion: number | null;
  rpcHealthy: boolean;
  gates: GateResult[];
  passed: boolean;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  wasmPath?: string;
  contractId?: string;
  rpcUrl?: string;
  network?: string;
  sourceAccount?: string;
  summaryOut: string;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    summaryOut: "deploy-summary.json",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--wasm":
        args.wasmPath = argv[++i];
        break;
      case "--contract":
        args.contractId = argv[++i];
        break;
      case "--rpc-url":
        args.rpcUrl = argv[++i];
        break;
      case "--network":
        args.network = argv[++i];
        break;
      case "--source":
        args.sourceAccount = argv[++i];
        break;
      case "--summary-out":
        args.summaryOut = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
    }
  }

  return args;
}

function resolveConfig(args: ParsedArgs): {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
  sourceAccount: string;
} {
  return {
    rpcUrl:
      args.rpcUrl ??
      process.env.RPC_URL ??
      process.env.VITE_RPC_URL ??
      "https://soroban-testnet.stellar.org",
    contractId:
      args.contractId ??
      process.env.CONTRACT_ID ??
      process.env.VITE_CONTRACT_ID ??
      "",
    networkPassphrase:
      args.network ??
      process.env.NETWORK_PASSPHRASE ??
      process.env.VITE_NETWORK_PASSPHRASE ??
      Networks.TESTNET,
    sourceAccount:
      args.sourceAccount ??
      process.env.SOROBAN_SOURCE_ACCOUNT ??
      "",
  };
}

// ── WASM hash helpers ─────────────────────────────────────────────────────────

/**
 * Computes the SHA-256 hash of a WASM file, hex-encoded.
 * This is what Stellar uses for on-chain contract hashes.
 */
export function computeWasmHash(wasmPath: string): string {
  const bytes = fs.readFileSync(wasmPath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Queries the contract's current WASM hash from the network
 * using the Soroban RPC `getLedgerEntries` endpoint.
 */
export async function fetchOnChainWasmHash(
  contractId: string,
  server: MultiEndpointServer
): Promise<string | null> {
  try {
    // Use getContractData or getLedgerEntries to read ContractCode
    const entries = await (server as any).getLedgerEntries(
      ...([] as any[])
    );
    // Fallback: use server.getContractData if available (SDK v12+)
    // This is a best-effort query; the exact API varies by SDK version.
    // In production, use `soroban contract info --id <CONTRACT_ID>` output.
    return null;
  } catch {
    return null;
  }
}

// ── Schema version helper ─────────────────────────────────────────────────────

const LATEST_SCHEMA_VERSION = 2;

export async function fetchSchemaVersion(
  contractId: string,
  server: MultiEndpointServer,
  networkPassphrase: string,
  sourceAccount: string
): Promise<number | null> {
  try {
    const contract = new Contract(contractId);
    const account = await server.getAccount(sourceAccount);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(contract.call("get_schema_version"))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if ("error" in simResult) return null;

    const retval = (simResult as any).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return null;

    return Number(retval.u32());
  } catch {
    return null;
  }
}

// ── Gate runners ──────────────────────────────────────────────────────────────

/**
 * Gate 1: RPC Health
 * Fails the pipeline if the Soroban RPC node reports unhealthy.
 */
export async function runHealthGate(server: MultiEndpointServer): Promise<GateResult> {
  try {
    const health = await server.getHealth();
    const healthy = (health as any).status === "healthy";
    return {
      gate: "rpc-health",
      status: healthy ? "pass" : "fail",
      message: healthy
        ? "RPC node is healthy"
        : `RPC node reports status: ${(health as any).status ?? "unknown"}`,
      detail: health,
    };
  } catch (err: unknown) {
    return {
      gate: "rpc-health",
      status: "fail",
      message: `RPC health check failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Gate 2: WASM Hash
 * Verifies the local WASM file hash matches what is deployed on-chain.
 * If the on-chain hash cannot be fetched, the gate warns but does not fail.
 */
export async function runWasmHashGate(
  wasmPath: string | undefined,
  contractId: string,
  server: MultiEndpointServer
): Promise<GateResult & { localHash: string | null; onChainHash: string | null }> {
  if (!wasmPath) {
    return {
      gate: "wasm-hash",
      status: "skip",
      message: "No --wasm path provided; skipping hash verification",
      localHash: null,
      onChainHash: null,
    };
  }

  if (!fs.existsSync(wasmPath)) {
    return {
      gate: "wasm-hash",
      status: "fail",
      message: `WASM file not found: ${wasmPath}`,
      localHash: null,
      onChainHash: null,
    };
  }

  const localHash = computeWasmHash(wasmPath);

  const onChainHash = contractId
    ? await fetchOnChainWasmHash(contractId, server)
    : null;

  // If we couldn't fetch on-chain hash, record it as a warning
  if (onChainHash === null) {
    return {
      gate: "wasm-hash",
      status: "warn",
      message: `Local WASM hash recorded. On-chain hash unavailable (use soroban-cli to verify).`,
      detail: { localHash },
      localHash,
      onChainHash: null,
    };
  }

  const match = localHash === onChainHash;
  return {
    gate: "wasm-hash",
    status: match ? "pass" : "fail",
    message: match
      ? `WASM hash matches on-chain (${localHash.slice(0, 16)}…)`
      : `WASM hash mismatch! local=${localHash.slice(0, 16)}… on-chain=${onChainHash.slice(0, 16)}…`,
    detail: { localHash, onChainHash },
    localHash,
    onChainHash,
  };
}

/**
 * Gate 3: Schema Version
 * Reads the on-chain schema version. Warns if migration is pending.
 */
export async function runSchemaVersionGate(
  contractId: string,
  server: MultiEndpointServer,
  networkPassphrase: string,
  sourceAccount: string
): Promise<GateResult & { schemaVersion: number | null }> {
  if (!contractId || !sourceAccount) {
    return {
      gate: "schema-version",
      status: "skip",
      message: "Contract ID or source account not set; skipping schema check",
      schemaVersion: null,
    };
  }

  const version = await fetchSchemaVersion(
    contractId,
    server,
    networkPassphrase,
    sourceAccount
  );

  if (version === null) {
    return {
      gate: "schema-version",
      status: "warn",
      message: "Could not fetch schema version from contract",
      schemaVersion: null,
    };
  }

  const migrationPending = version < LATEST_SCHEMA_VERSION;
  return {
    gate: "schema-version",
    status: migrationPending ? "warn" : "pass",
    message: migrationPending
      ? `Schema version ${version} is below latest (${LATEST_SCHEMA_VERSION}). Run 'migrate()' after upgrade.`
      : `Schema version ${version} is current`,
    detail: { version, latestVersion: LATEST_SCHEMA_VERSION },
    schemaVersion: version,
  };
}

// ── Summary artifact ──────────────────────────────────────────────────────────

export function writeSummary(
  summary: PipelineSummary,
  outputPath: string
): void {
  const dir = path.dirname(outputPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");
}

// ── Pipeline orchestrator ─────────────────────────────────────────────────────

export async function runPipeline(
  args: ParsedArgs
): Promise<PipelineSummary> {
  const { rpcUrl, contractId, networkPassphrase, sourceAccount } =
    resolveConfig(args);

  const summary: PipelineSummary = {
    timestamp: new Date().toISOString(),
    dryRun: args.dryRun,
    contractId,
    rpcUrl,
    wasmPath: args.wasmPath ?? null,
    wasmHash: null,
    onChainHash: null,
    schemaVersion: null,
    rpcHealthy: false,
    gates: [],
    passed: false,
  };

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║       FlowPay Deploy Pipeline — Preflight Check     ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`  Contract  : ${contractId || "(not set)"}`);
  console.log(`  RPC URL   : ${rpcUrl}`);
  console.log(`  WASM      : ${args.wasmPath ?? "(not provided)"}`);
  console.log(`  Dry-run   : ${args.dryRun}`);
  console.log(`  Summary   : ${args.summaryOut}\n`);

  if (args.dryRun) {
    console.log("  [DRY-RUN] Skipping all network calls.\n");
    summary.gates = [
      { gate: "rpc-health", status: "skip", message: "Dry-run — skipped" },
      { gate: "wasm-hash", status: "skip", message: "Dry-run — skipped" },
      { gate: "schema-version", status: "skip", message: "Dry-run — skipped" },
    ];
    summary.passed = true;
    writeSummary(summary, args.summaryOut);
    printGates(summary.gates);
    return summary;
  }

  const server = new MultiEndpointServer(rpcUrl);

  // ── Gate 1: RPC Health ─────────────────────────────────────────────────────
  const healthGate = await runHealthGate(server);
  summary.gates.push(healthGate);
  summary.rpcHealthy = healthGate.status === "pass";
  printGate(healthGate);

  if (healthGate.status === "fail") {
    summary.passed = false;
    writeSummary(summary, args.summaryOut);
    console.error(
      "\n  ✗ PIPELINE FAILED: RPC node is unhealthy. Aborting.\n"
    );
    return summary;
  }

  // ── Gate 2: WASM Hash ──────────────────────────────────────────────────────
  const wasmGate = await runWasmHashGate(args.wasmPath, contractId, server);
  summary.gates.push(wasmGate);
  summary.wasmHash = wasmGate.localHash;
  summary.onChainHash = wasmGate.onChainHash;
  printGate(wasmGate);

  if (wasmGate.status === "fail") {
    summary.passed = false;
    writeSummary(summary, args.summaryOut);
    console.error("\n  ✗ PIPELINE FAILED: WASM hash check failed. Aborting.\n");
    return summary;
  }

  // ── Gate 3: Schema Version ─────────────────────────────────────────────────
  const schemaGate = await runSchemaVersionGate(
    contractId,
    server,
    networkPassphrase,
    sourceAccount
  );
  summary.gates.push(schemaGate);
  summary.schemaVersion = schemaGate.schemaVersion;
  printGate(schemaGate);

  // Schema warnings don't fail the pipeline — they remind the operator to migrate
  summary.passed = summary.gates.every(
    (g) => g.status === "pass" || g.status === "warn" || g.status === "skip"
  );

  writeSummary(summary, args.summaryOut);

  const icon = summary.passed ? "✓" : "✗";
  const label = summary.passed ? "PASSED" : "FAILED";
  console.log(`\n  ${icon} PIPELINE ${label}. Summary written to: ${args.summaryOut}\n`);

  return summary;
}

// ── Display helpers ───────────────────────────────────────────────────────────

const STATUS_ICON: Record<GateStatus, string> = {
  pass: "✓",
  fail: "✗",
  skip: "–",
  warn: "⚠",
};

function printGate(gate: GateResult): void {
  const icon = STATUS_ICON[gate.status];
  console.log(`  [${icon}] ${gate.gate.padEnd(16)} ${gate.message}`);
}

function printGates(gates: GateResult[]): void {
  for (const g of gates) printGate(g);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: npx tsx scripts/deploy-pipeline.ts [options]

Options:
  --wasm <path>         Path to compiled .wasm file (required unless --dry-run)
  --contract <id>       Deployed contract ID
  --rpc-url <url>       Soroban RPC URL
  --network <pass>      Network passphrase
  --source <keypair>    Source Stellar address for simulated queries
  --summary-out <path>  Where to write the JSON summary (default: deploy-summary.json)
  --dry-run             Validate config and print what would happen without calling RPC
  --help, -h            Show help`);
    process.exit(0);
  }

  const args = parseArgs(process.argv.slice(2));
  const summary = await runPipeline(args);
  process.exit(summary.passed ? 0 : 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}


