#!/usr/bin/env ts-node
/**
 * pre-upgrade-check.ts
 *
 * Standalone preflight validator that is also called by deploy-pipeline.ts.
 * Run this before invoking `upgrade()` on the FlowPay contract to catch
 * common misconfiguration issues.
 *
 * Checks:
 *   1. WASM file exists and its SHA-256 hash is recorded
 *   2. Target network RPC is reachable and healthy
 *   3. Contract ID is a valid Stellar contract address
 *   4. Schema version is readable (migration status)
 *   5. Source account exists on the network (funded)
 *
 * Usage:
 *   npx ts-node scripts/pre-upgrade-check.ts --wasm path/to/flowpay.wasm
 *
 * Options:
 *   --wasm <path>      Path to compiled .wasm file
 *   --contract <id>    Deployed contract ID
 *   --rpc-url <url>    Soroban RPC URL
 *   --network <pass>   Network passphrase
 *   --source <addr>    Source account (for read-only RPC queries)
 *   --dry-run          Skip network calls, print config only
 *
 * Closes: https://github.com/SiLioLabs/PayFlow/issues/897
 */

import * as fs from "fs";
import {
  StrKey,
  Networks,
  Contract,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { computeWasmHash, type GateResult } from "./deploy-pipeline";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PreUpgradeReport {
  timestamp: string;
  passed: boolean;
  checks: GateResult[];
  wasmHash: string | null;
  schemaVersion: number | null;
}

// ── Individual checks ─────────────────────────────────────────────────────────

export function checkWasmFile(wasmPath: string | undefined): GateResult & { hash: string | null } {
  if (!wasmPath) {
    return {
      gate: "wasm-file",
      status: "fail",
      message: "No --wasm path provided",
      hash: null,
    };
  }

  if (!fs.existsSync(wasmPath)) {
    return {
      gate: "wasm-file",
      status: "fail",
      message: `WASM file not found: ${wasmPath}`,
      hash: null,
    };
  }

  const stats = fs.statSync(wasmPath);
  if (stats.size === 0) {
    return {
      gate: "wasm-file",
      status: "fail",
      message: `WASM file is empty: ${wasmPath}`,
      hash: null,
    };
  }

  const hash = computeWasmHash(wasmPath);
  return {
    gate: "wasm-file",
    status: "pass",
    message: `WASM file valid (${(stats.size / 1024).toFixed(1)} KB), SHA-256: ${hash}`,
    hash,
  };
}

export function checkContractId(contractId: string): GateResult {
  if (!contractId) {
    return {
      gate: "contract-id",
      status: "fail",
      message: "CONTRACT_ID is not set",
    };
  }

  // Stellar contract IDs start with 'C' and are 56 chars (StrKey contract)
  const valid = StrKey.isValidContract(contractId);
  return {
    gate: "contract-id",
    status: valid ? "pass" : "fail",
    message: valid
      ? `Contract ID is valid: ${contractId}`
      : `Contract ID is not a valid Stellar contract address: ${contractId}`,
  };
}

export async function checkRpcReachable(server: Server): Promise<GateResult> {
  try {
    const health = await server.getHealth();
    const healthy = (health as any).status === "healthy";
    return {
      gate: "rpc-reachable",
      status: healthy ? "pass" : "fail",
      message: healthy
        ? "RPC is reachable and healthy"
        : `RPC responded but status is: ${(health as any).status}`,
    };
  } catch (err: unknown) {
    return {
      gate: "rpc-reachable",
      status: "fail",
      message: `Cannot reach RPC: ${(err as Error).message}`,
    };
  }
}

export async function checkSourceAccountFunded(
  server: Server,
  sourceAccount: string
): Promise<GateResult> {
  if (!sourceAccount) {
    return {
      gate: "source-account",
      status: "skip",
      message: "No source account configured",
    };
  }

  try {
    await server.getAccount(sourceAccount);
    return {
      gate: "source-account",
      status: "pass",
      message: `Source account exists on network: ${sourceAccount}`,
    };
  } catch (err: unknown) {
    return {
      gate: "source-account",
      status: "fail",
      message: `Source account not found or unfunded: ${sourceAccount}`,
    };
  }
}

export async function checkSchemaVersion(
  server: Server,
  contractId: string,
  networkPassphrase: string,
  sourceAccount: string
): Promise<GateResult & { version: number | null }> {
  if (!contractId || !sourceAccount) {
    return {
      gate: "schema-version",
      status: "skip",
      message: "Skipped — contract ID or source account missing",
      version: null,
    };
  }

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
    if ("error" in simResult) {
      return {
        gate: "schema-version",
        status: "warn",
        message: "Could not read schema version",
        version: null,
      };
    }

    const retval = (simResult as any).result?.retval;
    const version = retval && retval.switch().name !== "scvVoid"
      ? Number(retval.u32())
      : null;

    return {
      gate: "schema-version",
      status: version !== null ? "pass" : "warn",
      message: version !== null
        ? `On-chain schema version: ${version}`
        : "Schema version not readable",
      detail: { version },
      version,
    };
  } catch (err: unknown) {
    return {
      gate: "schema-version",
      status: "warn",
      message: `Schema version check error: ${(err as Error).message}`,
      version: null,
    };
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runPreUpgradeCheck(options: {
  wasmPath?: string;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  sourceAccount: string;
  dryRun: boolean;
}): Promise<PreUpgradeReport> {
  const report: PreUpgradeReport = {
    timestamp: new Date().toISOString(),
    passed: false,
    checks: [],
    wasmHash: null,
    schemaVersion: null,
  };

  console.log("\n  FlowPay Pre-Upgrade Check");
  console.log("  " + "─".repeat(50));

  // WASM file check (local, no network)
  const wasmCheck = checkWasmFile(options.wasmPath);
  report.checks.push(wasmCheck);
  report.wasmHash = wasmCheck.hash;
  printCheck(wasmCheck);

  // Contract ID format check (local, no network)
  const idCheck = checkContractId(options.contractId);
  report.checks.push(idCheck);
  printCheck(idCheck);

  if (options.dryRun) {
    console.log("\n  [DRY-RUN] Skipping network checks.\n");
    report.passed = report.checks.every(
      (c) => c.status === "pass" || c.status === "skip" || c.status === "warn"
    );
    return report;
  }

  const server = new Server(options.rpcUrl);

  // RPC reachability
  const rpcCheck = await checkRpcReachable(server);
  report.checks.push(rpcCheck);
  printCheck(rpcCheck);

  if (rpcCheck.status === "fail") {
    report.passed = false;
    return report;
  }

  // Source account funded
  const accountCheck = await checkSourceAccountFunded(server, options.sourceAccount);
  report.checks.push(accountCheck);
  printCheck(accountCheck);

  // Schema version
  const schemaCheck = await checkSchemaVersion(
    server,
    options.contractId,
    options.networkPassphrase,
    options.sourceAccount
  );
  report.checks.push(schemaCheck);
  report.schemaVersion = schemaCheck.version;
  printCheck(schemaCheck);

  report.passed = report.checks.every(
    (c) => c.status === "pass" || c.status === "skip" || c.status === "warn"
  );

  const icon = report.passed ? "✓" : "✗";
  console.log(`\n  ${icon} Pre-upgrade check ${report.passed ? "PASSED" : "FAILED"}\n`);

  return report;
}

function printCheck(gate: GateResult): void {
  const icons: Record<string, string> = { pass: "✓", fail: "✗", skip: "–", warn: "⚠" };
  console.log(`  [${icons[gate.status]}] ${gate.gate.padEnd(18)} ${gate.message}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(flag);

  const report = await runPreUpgradeCheck({
    wasmPath: get("--wasm"),
    contractId:
      get("--contract") ??
      process.env.CONTRACT_ID ??
      process.env.VITE_CONTRACT_ID ??
      "",
    rpcUrl:
      get("--rpc-url") ??
      process.env.RPC_URL ??
      process.env.VITE_RPC_URL ??
      "https://soroban-testnet.stellar.org",
    networkPassphrase:
      get("--network") ??
      process.env.NETWORK_PASSPHRASE ??
      process.env.VITE_NETWORK_PASSPHRASE ??
      Networks.TESTNET,
    sourceAccount:
      get("--source") ??
      process.env.SOROBAN_SOURCE_ACCOUNT ??
      "",
    dryRun: has("--dry-run"),
  });

  process.exit(report.passed ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
