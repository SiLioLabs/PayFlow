#!/usr/bin/env tsx
/**
 * check-allowances.ts — Audit subscriber token allowances against FlowPay
 * subscription amounts.
 *
 * Accepts a list of G-addresses (from args or --file) and checks whether each
 * subscriber's allowance for their subscription token covers the next charge
 * amount.  Checks run concurrently under a configurable cap; transient RPC
 * errors are retried with exponential backoff.
 *
 * Usage:
 *   tsx check-allowances.ts [options] [addresses...]
 *
 * Options:
 *   --file <path>   Read subscriber addresses from a file (one per line)
 *   --json          Output machine-readable JSON to stdout; human summary to stderr
 *   --help, -h      Show this help
 *
 * Environment variables:
 *   CONTRACT_ID         Required. Deployed FlowPay contract ID.
 *   RPC_URL             Soroban RPC endpoint (default: https://soroban-testnet.stellar.org).
 *   NETWORK_PASSPHRASE  Network passphrase (default: Test SDF Network ; September 2015).
 *   CONCURRENCY         Max simultaneous RPC calls (default: 5).
 *   MAX_RETRIES         Retry attempts per transient error (default: 3).
 *   RETRY_BASE_MS       Base backoff delay in ms (default: 300).
 *
 * Exit codes:
 *   0 — all subscribers healthy (or errors / no subscription only)
 *   1 — one or more subscribers are at risk of a failed charge
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  Account,
} from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";
import { logger } from "./logger.js";
import {
  withRetry,
  runConcurrent,
  isTransientError,
  DefinitiveError,
  type AuditResult,
  type AllowanceCheckReport,
} from "./allowance-utils.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONTRACT_ID =
  process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ??
  Networks.TESTNET) as string;
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY ?? "5", 10));
const MAX_RETRIES = Math.max(0, parseInt(process.env.MAX_RETRIES ?? "3", 10));
const RETRY_BASE_MS = Math.max(
  0,
  parseInt(process.env.RETRY_BASE_MS ?? "300", 10),
);

if (!CONTRACT_ID) {
  logger.error(
    "Error: CONTRACT_ID environment variable is required.\n" +
      "Usage: CONTRACT_ID=<id> tsx check-allowances.ts [--json] [--file subs.txt] [addr ...]",
  );
  process.exit(1);
}

/** Stable dummy source account for read-only simulations. */
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const server = new MultiEndpointServer();
const FlowPayAddress = Address.fromString(CONTRACT_ID);

// ── Helpers ───────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: string): string {
  return (Number(stroops) / 10_000_000).toFixed(7);
}

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function parseAddressListFromFile(path: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(path, "utf-8");
    return content
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    logger.error(`Error reading file ${path}: ${err}`);
    process.exit(1);
  }
}

function showHelp(): never {
  logger.info(`
Usage: tsx check-allowances.ts [options] [addresses...]

Options:
  --file <path>   Read subscriber addresses from a file (one per line, # comments allowed)
  --json          Output machine-readable JSON to stdout (human summary always on stderr)
  --help, -h      Show this help message

Environment:
  CONTRACT_ID           Required. Deployed FlowPay contract ID
  RPC_URL               Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE    Network passphrase (default: Test SDF Network ; September 2015)
  CONCURRENCY           Max simultaneous RPC calls (default: 5)
  MAX_RETRIES           Retry attempts per transient error (default: 3)
  RETRY_BASE_MS         Base backoff delay in ms (default: 300)

Exit codes:
  0  All subscribers healthy (or only errors/no-subscription results)
  1  One or more subscribers at risk of a failed charge

Examples:
  CONTRACT_ID=CD123... tsx check-allowances.ts GXYZ... GABC...
  CONTRACT_ID=CD123... tsx check-allowances.ts --file subscribers.txt
  CONTRACT_ID=CD123... tsx check-allowances.ts --json --file subscribers.txt > audit.json
  `);
  process.exit(0);
}

// ── Contract Reads ────────────────────────────────────────────────────────────

interface Subscription {
  amount: bigint;
  token: string;
  active: boolean;
  paused: boolean;
}

/**
 * Fetches the FlowPay subscription record for `user`.
 * Retries on transient RPC failures; returns null when the user has no
 * subscription or on any error after exhausting retries.
 */
export async function getSubscription(
  user: string,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): Promise<Subscription | null> {
  return withRetry(
    async () => {
      const contract = new Contract(CONTRACT_ID);
      const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call("get_subscription", addressVal(user)))
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) return null;

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result
        ?.retval;
      if (!retval || retval.switch().name === "scvVoid") return null;

      const fields: Record<string, unknown> = {};
      for (const entry of retval.map() ?? []) {
        const key = entry.key().sym().toString();
        const val = entry.val();
        switch (key) {
          case "amount":
            fields[key] = BigInt(val.i128().toString());
            break;
          case "token":
            fields[key] = Address.fromScVal(val).toString();
            break;
          case "active":
            fields[key] = val.b();
            break;
          case "paused":
            fields[key] = val.b();
            break;
        }
      }

      if (fields.amount === undefined || fields.token === undefined) {
        return null;
      }

      return {
        amount: fields.amount as bigint,
        token: fields.token as string,
        active: (fields.active as boolean | undefined) ?? false,
        paused: (fields.paused as boolean | undefined) ?? false,
      };
    },
    {
      maxRetries: opts?.maxRetries ?? MAX_RETRIES,
      baseDelayMs: opts?.baseDelayMs ?? RETRY_BASE_MS,
      onRetry: (attempt, err) =>
        logger.warn(`getSubscription retry ${attempt}`, {
          address: user,
          error: err instanceof Error ? err.message : String(err),
        }),
    },
  ).catch((err) => {
    logger.error("getSubscription failed after retries", {
      address: user,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
}

/**
 * Returns the current approved allowance (in stroops) that the FlowPay
 * contract may spend on behalf of `owner` for token `tokenId`.
 * Retries on transient RPC failures; returns 0n on error after exhausting retries.
 */
export async function getAllowance(
  owner: string,
  tokenId: string,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): Promise<bigint> {
  return withRetry(
    async () => {
      const tokenContract = new Contract(tokenId);
      const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          tokenContract.call(
            "allowance",
            addressVal(owner),
            nativeToScVal(FlowPayAddress, { type: "address" }),
          ),
        )
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) return 0n;

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result
        ?.retval;
      if (!retval || retval.switch().name === "scvVoid") return 0n;

      return BigInt(retval.i128().toString());
    },
    {
      maxRetries: opts?.maxRetries ?? MAX_RETRIES,
      baseDelayMs: opts?.baseDelayMs ?? RETRY_BASE_MS,
      onRetry: (attempt, err) =>
        logger.warn(`getAllowance retry ${attempt}`, {
          owner,
          error: err instanceof Error ? err.message : String(err),
        }),
    },
  ).catch((err) => {
    logger.error("getAllowance failed after retries", {
      owner,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0n;
  });
}

// ── Audit Logic ───────────────────────────────────────────────────────────────

/**
 * Audits a single subscriber address.
 *
 * Definitive outcomes (invalid address, no subscription) are NOT retried here —
 * only the underlying RPC calls inside getSubscription/getAllowance retry on
 * transient errors.
 */
export async function auditSubscriber(address: string): Promise<AuditResult> {
  // Validate G-address format — definitive result, never retry
  try {
    Address.fromString(address);
  } catch {
    return {
      address,
      subscription_amount: "0",
      allowance: "0",
      gap: "0",
      token: "",
      active: false,
      paused: false,
      at_risk: false,
      error: "invalid_address",
    };
  }

  let sub: Subscription | null;
  try {
    sub = await getSubscription(address);
  } catch (err: unknown) {
    return {
      address,
      subscription_amount: "0",
      allowance: "0",
      gap: "0",
      token: "",
      active: false,
      paused: false,
      at_risk: false,
      error: err instanceof DefinitiveError ? "rpc_error" : "unknown_error",
    };
  }

  if (!sub) {
    return {
      address,
      subscription_amount: "0",
      allowance: "0",
      gap: "0",
      token: "",
      active: false,
      paused: false,
      at_risk: false,
      error: "no_subscription",
    };
  }

  const allowance = await getAllowance(address, sub.token);
  const gap = sub.amount > allowance ? sub.amount - allowance : 0n;
  const atRisk = sub.active && !sub.paused && gap > 0n;

  return {
    address,
    subscription_amount: sub.amount.toString(),
    allowance: allowance.toString(),
    gap: gap.toString(),
    token: sub.token,
    active: sub.active,
    paused: sub.paused,
    at_risk: atRisk,
  };
}

// ── Output ────────────────────────────────────────────────────────────────────

export function buildReport(results: AuditResult[]): AllowanceCheckReport {
  const healthy = results.filter((r) => !r.at_risk && !r.error && r.active);
  const atRisk = results.filter((r) => r.at_risk);
  const errors = results.filter((r) => !!r.error);

  return {
    generated_at: new Date().toISOString(),
    contract: CONTRACT_ID,
    total_checked: results.length,
    healthy_count: healthy.length,
    at_risk_count: atRisk.length,
    error_count: errors.length,
    results,
  };
}

function printHumanSummary(report: AllowanceCheckReport): void {
  const { results } = report;
  const atRisk = results.filter((r) => r.at_risk);
  const noSub = results.filter((r) => r.error === "no_subscription");
  const healthy = results.filter((r) => !r.at_risk && !r.error && r.active);
  const errors = results.filter(
    (r) => r.error && r.error !== "no_subscription",
  );

  logger.info(`\nAudited ${results.length} subscriber(s)\n`);

  if (noSub.length > 0) {
    logger.info(`${noSub.length} with no subscription:`);
    for (const r of noSub) logger.info(`  ${r.address}`);
    logger.info("");
  }

  if (errors.length > 0) {
    logger.info(`${errors.length} with errors:`);
    for (const r of errors)
      logger.info(`  ${r.address}  [${r.error}]`);
    logger.info("");
  }

  if (atRisk.length > 0) {
    logger.info(`${atRisk.length} at risk of failed charge:`);
    const header =
      "  ADDRESS".padEnd(56) +
      "AMOUNT".padStart(12) +
      "ALLOWANCE".padStart(14) +
      "GAP".padStart(12) +
      "  TOKEN";
    logger.info(header);
    for (const r of atRisk) {
      logger.info(
        `  ${r.address.padEnd(56)}${stroopsToXlm(r.subscription_amount).padStart(12)}${stroopsToXlm(r.allowance).padStart(14)}${stroopsToXlm(r.gap).padStart(12)}  ${r.token}`,
      );
    }
    logger.info("");
  }

  if (healthy.length > 0) {
    logger.info(`${healthy.length} healthy:`);
    for (const r of healthy) {
      logger.info(
        `  ${r.address.padEnd(56)} ${stroopsToXlm(r.subscription_amount).padStart(12)} ${stroopsToXlm(r.allowance).padStart(12)}`,
      );
    }
    logger.info("");
  }

  logger.info(
    `Summary: healthy=${report.healthy_count}, atRisk=${report.at_risk_count}, ` +
      `errors=${report.error_count}, total=${report.total_checked}`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const addresses: string[] = [];
  let filePath: string | undefined;
  let jsonOutput = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--file") {
      filePath = argv[++i];
    } else if (arg.startsWith("-")) {
      logger.error(`Unknown option: ${arg}`);
      showHelp();
    } else {
      addresses.push(arg);
    }
  }

  if (addresses.length === 0 && !filePath) showHelp();

  const allAddresses = [...addresses];
  if (filePath) {
    allAddresses.push(...(await parseAddressListFromFile(filePath)));
  }

  if (allAddresses.length === 0) {
    logger.error("No valid addresses provided.");
    process.exit(1);
  }

  logger.info(
    `Auditing ${allAddresses.length} subscriber(s) — concurrency=${CONCURRENCY}, maxRetries=${MAX_RETRIES}`,
  );

  // Run all audits concurrently under the configured cap.
  const rawResults = await runConcurrent(
    allAddresses.map((addr) => () => auditSubscriber(addr)),
    CONCURRENCY,
  );

  // Wrap any unexpected batch-level errors as error entries.
  const results: AuditResult[] = rawResults.map((r, i) => {
    if (r instanceof Error) {
      logger.error(`Unexpected error for ${allAddresses[i]}`, {
        error: r.message,
      });
      return {
        address: allAddresses[i]!,
        subscription_amount: "0",
        allowance: "0",
        gap: "0",
        token: "",
        active: false,
        paused: false,
        at_risk: false,
        error: "unknown_error",
      };
    }
    return r;
  });

  const report = buildReport(results);

  if (jsonOutput) {
    // JSON report to stdout; human summary to stderr so they don't interleave
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
  // Human summary always emitted (logger writes to stderr for warn/error, stdout for info)
  printHumanSummary(report);

  process.exit(report.at_risk_count > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  logger.error(
    `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
