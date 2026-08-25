#!/usr/bin/env tsx
/**
 * pre-upgrade-check.ts — Contract pre-upgrade validation for FlowPay.
 *
 * Validates schema compatibility, admin key availability, active subscription
 * count, fee configuration, and optionally dry-runs `migrate` before a WASM
 * upgrade. Exits 1 when any blocking check fails.
 *
 * Usage:
 *   CONTRACT_ID=C... npx tsx scripts/pre-upgrade-check.ts
 *   CONTRACT_ID=C... npx tsx scripts/pre-upgrade-check.ts --wasm ./target/wasm32-unknown-unknown/release/flowpay.wasm
 *   CONTRACT_ID=C... npx tsx scripts/pre-upgrade-check.ts --skip-key-check --upgrade-config ./upgrade-config.json
 *
 * Environment:
 *   CONTRACT_ID            Required. Deployed contract ID
 *   RPC_URL                Optional. Soroban RPC endpoint
 *   NETWORK_PASSPHRASE     Optional. Network passphrase
 *   ADMIN_SECRET_KEY       Optional. Admin secret used for signing test / migrate dry-run
 *   UPGRADE_CONFIG_PATH    Optional. JSON with { "expected_schema_version": N }
 *
 * Upgrade config JSON (optional):
 *   {
 *     "expected_schema_version": 2,
 *     "min_schema_version": 0
 *   }
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  Contract,
  Networks,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Keypair,
  xdr,
  scValToNative,
  hash,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = "pass" | "fail" | "warn" | "skip";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  blocking: boolean;
}

interface ReadinessReport {
  ready: boolean;
  generated_at: string;
  contract_id: string;
  checks: CheckResult[];
  blocking_issues: string[];
}
import { MultiEndpointServer } from "./rpc-client.js";
import { logger } from "./logger";

interface UpgradeConfig {
  expected_schema_version?: number;
  min_schema_version?: number;
}

// ── Config / CLI ─────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;

// Dummy source account used solely for simulation (no auth needed)
const CONTRACT_ID = process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.RPC_URL ?? process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY ?? "";
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const SKIP_KEY_CHECK = process.argv.includes("--skip-key-check");
const WASM_PATH = getArg("--wasm");
const UPGRADE_CONFIG_PATH =
  getArg("--upgrade-config") ?? process.env.UPGRADE_CONFIG_PATH ?? "";
const CONFIRM = process.argv.includes("--confirm");

function showHelp(): never {
  console.log(`
Usage: tsx scripts/pre-upgrade-check.ts [options]

Options:
  --wasm <path>              Path to the new WASM binary to validate
  --upgrade-config <path>    JSON config with expected_schema_version
  --skip-key-check           Skip admin key signing test (e.g. hardware wallet)
  --confirm                  Print ready-to-proceed message when all checks pass
  --help, -h                 Show this help

Environment:
  CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE, ADMIN_SECRET_KEY, UPGRADE_CONFIG_PATH
`);
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const server = new Server(RPC_URL);

async function simulateReadOnly(
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal> {
async function simulate(
  method: string,
  args: xdr.ScVal[] = [],
  sourceSecret?: string
): Promise<{ retval: xdr.ScVal | null; error?: string }> {
  const contract = new Contract(CONTRACT_ID);
  let source: Account;
  if (sourceSecret) {
    const kp = Keypair.fromSecret(sourceSecret);
    try {
      source = await server.getAccount(kp.publicKey());
    } catch {
      source = new Account(kp.publicKey(), "0");
    }
  } else {
    source = new Account(SIM_SOURCE, "0");
  }

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) {
    return {
      retval: null,
      error: String((result as { error?: unknown }).error ?? "simulation failed"),
    };
  }
  const success = result as { result?: { retval?: xdr.ScVal } };
  return { retval: success.result?.retval ?? null };
}

function loadUpgradeConfig(path: string): UpgradeConfig {
  if (!path) return {};
  if (!existsSync(path)) {
    throw new Error(`Upgrade config not found: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as UpgradeConfig;
  return raw;
}

function validateWasmFile(path: string): CheckResult {
  const name = "wasm_binary";
  if (!existsSync(path)) {
    return {
      name,
      status: "fail",
      detail: `WASM file not found at ${path}`,
      blocking: true,
    };
  }
  const st = statSync(path);
  if (!st.isFile() || st.size < 8) {
    return {
      name,
      status: "fail",
      detail: `WASM path is not a valid file (size=${st.size})`,
      blocking: true,
    };
  }
  const buf = readFileSync(path);
  // WASM magic number: \0asm
  if (buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) {
    return {
      name,
      status: "fail",
      detail: "File does not start with WASM magic bytes (\\0asm)",
      blocking: true,
    };
  }
  const digest = hash(buf).toString("hex");
  return {
    name,
    status: "pass",
    detail: `Valid WASM binary (${st.size} bytes, sha256=${digest.slice(0, 16)}…)`,
    blocking: false,
  };
}

function printReport(report: ReadinessReport): void {
  console.log("=== FlowPay Pre-Upgrade Readiness Report ===");
  console.log(`Contract : ${report.contract_id}`);
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Ready    : ${report.ready ? "YES" : "NO"}`);
  console.log("");
  console.log("Checks:");
  for (const check of report.checks) {
    const mark =
      check.status === "pass"
        ? "✔"
        : check.status === "fail"
          ? "✖"
          : check.status === "warn"
            ? "⚠"
            : "–";
    console.log(`  ${mark} [${check.status.toUpperCase()}] ${check.name}: ${check.detail}`);
  }
  if (report.blocking_issues.length > 0) {
    console.log("");
    console.log("Blocking issues:");
    for (const issue of report.blocking_issues) {
      console.log(`  - ${issue}`);
    }
  }
  console.log("");
  console.log(JSON.stringify(report, null, 2));
}

// ── Main validation ──────────────────────────────────────────────────────────

async function runChecks(): Promise<ReadinessReport> {
  const checks: CheckResult[] = [];

  // 1. Schema version (current on-chain)
  let schemaVersion = 0;
  try {
    const { retval, error } = await simulate("get_schema_version");
    if (error || !retval) {
      checks.push({
        name: "schema_version",
        status: "fail",
        detail: error ?? "no return value from get_schema_version",
        blocking: true,
      });
    } else {
      schemaVersion = Number(scValToNative(retval));
      checks.push({
        name: "schema_version",
        status: "pass",
        detail: `On-chain schema version is ${schemaVersion}`,
        blocking: false,
      });
    }
  } catch (err) {
    checks.push({
      name: "schema_version",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      blocking: true,
    });
  }

  // 2. Expected schema from upgrade config / new WASM metadata
  let upgradeConfig: UpgradeConfig = {};
  try {
    upgradeConfig = loadUpgradeConfig(UPGRADE_CONFIG_PATH);
    if (UPGRADE_CONFIG_PATH) {
      const expected = upgradeConfig.expected_schema_version;
      if (expected === undefined) {
        checks.push({
          name: "expected_schema_version",
          status: "fail",
          detail: "upgrade config missing expected_schema_version",
          blocking: true,
        });
      } else if (schemaVersion > expected) {
        checks.push({
          name: "expected_schema_version",
          status: "fail",
          detail: `On-chain schema ${schemaVersion} is ahead of expected ${expected}`,
          blocking: true,
        });
      } else {
        checks.push({
          name: "expected_schema_version",
          status: "pass",
          detail: `Expected schema ${expected} is compatible with on-chain ${schemaVersion}`,
          blocking: false,
        });
      }
      if (
        upgradeConfig.min_schema_version !== undefined &&
        schemaVersion < upgradeConfig.min_schema_version
      ) {
        checks.push({
          name: "min_schema_version",
          status: "fail",
          detail: `On-chain schema ${schemaVersion} is below minimum ${upgradeConfig.min_schema_version}`,
          blocking: true,
        });
      }
    } else {
      checks.push({
        name: "expected_schema_version",
        status: "warn",
        detail:
          "No --upgrade-config provided; skipped new WASM expected schema comparison (defaults to CURRENT_VERSION=2)",
        blocking: false,
      });
      // Implicit expected version = contract CURRENT_VERSION (2)
      if (schemaVersion > 2) {
        checks.push({
          name: "implicit_schema_compat",
          status: "fail",
          detail: `On-chain schema ${schemaVersion} exceeds known CURRENT_VERSION 2`,
          blocking: true,
        });
      }
    }
  } catch (err) {
    checks.push({
      name: "expected_schema_version",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      blocking: true,
    });
  }

  // 3. WASM binary (optional)
  if (WASM_PATH) {
    checks.push(validateWasmFile(resolve(WASM_PATH)));
  } else {
    checks.push({
      name: "wasm_binary",
      status: "skip",
      detail: "No --wasm path provided",
      blocking: false,
    });
  }

  // 4. Admin address + signing key availability
  let adminAddress: string | null = null;
  try {
    const { retval, error } = await simulate("get_admin");
    if (error) {
      checks.push({
        name: "admin_address",
        status: "fail",
        detail: error,
        blocking: true,
      });
    } else if (!retval || retval.switch().name === "scvVoid") {
      checks.push({
        name: "admin_address",
        status: "fail",
        detail: "Contract has no admin set",
        blocking: true,
      });
    } else {
      adminAddress = String(scValToNative(retval));
      checks.push({
        name: "admin_address",
        status: "pass",
        detail: `Admin is ${adminAddress}`,
        blocking: false,
      });
    }
  } catch (err) {
    checks.push({
      name: "admin_address",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      blocking: true,
    });
  }

  if (SKIP_KEY_CHECK) {
    checks.push({
      name: "admin_signing_key",
      status: "skip",
      detail: "Skipped via --skip-key-check",
      blocking: false,
    });
  } else if (!ADMIN_SECRET) {
    checks.push({
      name: "admin_signing_key",
      status: "fail",
      detail:
        "ADMIN_SECRET_KEY not set; provide it or pass --skip-key-check for hardware wallets",
      blocking: true,
    });
  } else {
    try {
      const kp = Keypair.fromSecret(ADMIN_SECRET);
      const message = Buffer.from(`payflow-pre-upgrade-check:${Date.now()}`);
      const sig = kp.sign(message);
      if (!Keypair.fromPublicKey(kp.publicKey()).verify(message, sig)) {
        throw new Error("signature verification failed");
      }
      if (adminAddress && kp.publicKey() !== adminAddress) {
        checks.push({
          name: "admin_signing_key",
          status: "fail",
          detail: `Key ${kp.publicKey()} does not match on-chain admin ${adminAddress}`,
          blocking: true,
        });
      } else {
        checks.push({
          name: "admin_signing_key",
          status: "pass",
          detail: `Admin key ${kp.publicKey()} signed a dummy message successfully`,
          blocking: false,
        });
      }
    } catch (err) {
      checks.push({
        name: "admin_signing_key",
        status: "fail",
        detail: err instanceof Error ? err.message : String(err),
        blocking: true,
      });
    }
  }

  // 5. Active subscription count
  try {
    const { retval, error } = await simulate("get_active_count");
    if (error || !retval) {
      checks.push({
        name: "active_subscription_count",
        status: "fail",
        detail: error ?? "no return value",
        blocking: true,
      });
    } else {
      const count = Number(scValToNative(retval));
      checks.push({
        name: "active_subscription_count",
        status: count > 0 ? "warn" : "pass",
        detail:
          count > 0
            ? `${count} active subscription(s) will be affected by storage migration`
            : "No active subscriptions",
        blocking: false,
      });
    }
  } catch (err) {
    checks.push({
      name: "active_subscription_count",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      blocking: true,
    });
  }

  // 6. Fee configuration
  try {
    const { retval, error } = await simulate("get_fee");
    if (error) {
      checks.push({
        name: "fee_configuration",
        status: "fail",
        detail: error,
        blocking: true,
      });
    } else if (!retval || retval.switch().name === "scvVoid") {
      checks.push({
        name: "fee_configuration",
        status: "pass",
        detail: "No protocol fee configured (collector unset)",
        blocking: false,
      });
    } else {
      const fee = scValToNative(retval) as unknown;
      let detail: string;
      if (Array.isArray(fee) && fee.length >= 2) {
        detail = `collector=${fee[0]} bps=${fee[1]}`;
      } else {
        detail = `fee=${JSON.stringify(fee)}`;
      }
      checks.push({
        name: "fee_configuration",
        status: "pass",
        detail,
        blocking: false,
      });
    }
  } catch (err) {
    checks.push({
      name: "fee_configuration",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      blocking: true,
    });
  }

  // 7. Dry-run migrate (simulate only)
  try {
    const emptyUsers = xdr.ScVal.scvVec([]);
    const { error } = await simulate(
      "migrate",
      [emptyUsers],
      SKIP_KEY_CHECK ? undefined : ADMIN_SECRET || undefined
async function main(): Promise<void> {
  if (!CONTRACT_ID) {
    logger.error("Error: CONTRACT_ID environment variable is required.");
    process.exit(1);
  }

  logger.info("=== FlowPay Pre-Upgrade Check ===");
  logger.info(`Contract : ${CONTRACT_ID}`);
  logger.info(`RPC URL  : ${RPC_URL}`);
  logger.info(`Network  : ${NETWORK_PASSPHRASE}`);
  logger.info("");

  // 1. Admin address
  const adminVal = await simulateReadOnly("get_admin");
  const admin = scValToString(adminVal);
  logger.info(`Admin address      : ${admin}`);

  // 2. Active subscription count
  const countVal = await simulateReadOnly("get_active_count");
  const activeCount = scValToString(countVal);
  logger.info(`Active subscriptions: ${activeCount}`);

  if (Number(activeCount) > 0) {
    console.warn(
      `  ⚠  ${activeCount} active subscription(s) will be affected by a storage migration.`,
    logger.warn(
      `  ⚠  ${activeCount} active subscription(s) will be affected by a storage migration.`
    );
    if (error) {
      // Auth failures on empty migrate with dummy source are expected without admin key.
      if (SKIP_KEY_CHECK || !ADMIN_SECRET) {
        checks.push({
          name: "dry_run_migrate",
          status: "warn",
          detail: `migrate simulation reported: ${error} (run with ADMIN_SECRET_KEY for a full dry-run)`,
          blocking: false,
        });
      } else {
        checks.push({
          name: "dry_run_migrate",
          status: "fail",
          detail: `migrate dry-run failed: ${error}`,
          blocking: true,
        });
      }
    } else {
      checks.push({
        name: "dry_run_migrate",
        status: "pass",
        detail: "migrate simulation succeeded (no commit)",
        blocking: false,
      });
    }
  } catch (err) {
    checks.push({
      name: "dry_run_migrate",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      blocking: true,
    });
  }

  const blocking_issues = checks
    .filter((c) => c.status === "fail" && c.blocking)
    .map((c) => `${c.name}: ${c.detail}`);

  return {
    ready: blocking_issues.length === 0,
    generated_at: new Date().toISOString(),
    contract_id: CONTRACT_ID,
    checks,
    blocking_issues,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
  }

  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    process.exit(1);
  }

  console.log(`RPC URL  : ${RPC_URL}`);
  console.log(`Network  : ${NETWORK_PASSPHRASE}`);
  console.log("");

  const report = await runChecks();
  printReport(report);

  if (!report.ready) {
    console.error("Pre-upgrade check FAILED — resolve blocking issues before upgrading.");
    process.exit(1);
  }

  if (CONFIRM) {
    console.log("✔  --confirm flag present. All checks passed — safe to proceed with upgrade.");
  } else {
    console.log("All checks passed. Re-run with --confirm when you are ready to upgrade.");
  }
  // 3. Schema version
  const versionVal = await simulateReadOnly("get_schema_version");
  const schemaVersion = scValToString(versionVal);
  logger.info(`Schema version     : ${schemaVersion}`);
  if (Number(schemaVersion) < 2) {
    console.warn(
      "  ⚠  Schema is below current version 2 — run migrate() after upgrading.",
    );
    logger.warn("  ⚠  Schema is below current version 2 — run migrate() after upgrading.");
  }

  logger.info("");

  // 4. Confirmation gate
  if (!CONFIRM) {
    console.log(
      "Checks complete. Re-run with --confirm to proceed with the upgrade.",
    );
    logger.info("Checks complete. Re-run with --confirm to proceed with the upgrade.");
    process.exit(0);
  }

  logger.info("✔  --confirm flag present. Safe to proceed with upgrade.");
}

main().catch((err) => {
  console.error(
    "Pre-upgrade check failed:",
    err instanceof Error ? err.message : err,
  );
  logger.error("Pre-upgrade check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
