#!/usr/bin/env tsx
/**
 * topup-allowance.ts — Top up a subscriber's token allowance for the FlowPay contract.
 *
 * Calls the SAC token's `approve(from, spender, amount, live_until_ledger)` function
 * to set (or increase) the allowance that the FlowPay contract is permitted to spend
 * on behalf of the user.
 *
 * ## Why BigInt matters
 *
 * Soroban token amounts are u128 integers. JS `Number` loses precision above
 * 2^53 − 1 ≈ 9 × 10^15, which is far below u128 max. If a large top-up amount
 * were passed through `Number()` or the naive `nativeToScVal(amount)` path it
 * would be silently truncated — sending the wrong amount irreversibly.
 *
 * This script uses `encodeU128()` from `./lib/scval-helpers` which splits the
 * BigInt into hi/lo u64 halves via the SDK's `UInt128Parts`, never touching
 * `Number()` for the amount.
 *
 * ## Status validation
 *
 * Any `sendTransaction` or `getTransaction` result whose status is NOT
 * `"SUCCESS"` (Committed) causes the script to abort with a non-zero exit
 * code. The complete deny-list of aborting statuses is:
 *   FAILED, NOT_FOUND, ERROR, PENDING, DUPLICATE, TRY_AGAIN_LATER
 *
 * ## Usage
 *
 * ```bash
 * CONTRACT_ID=C...  \
 * TOKEN_ADDRESS=C...  \
 * USER_ADDRESS=G...  \
 * USER_SECRET=S...  \
 * AMOUNT=5000000000  \
 * npx tsx scripts/topup-allowance.ts
 *
 * # Dry-run (simulate only, no transaction sent):
 * CONTRACT_ID=C... TOKEN_ADDRESS=C... USER_ADDRESS=G... AMOUNT=5000000000 \
 * npx tsx scripts/topup-allowance.ts --simulate
 * ```
 *
 * ## Environment variables
 *
 * | Variable           | Required | Description                                              |
 * |--------------------|----------|----------------------------------------------------------|
 * | CONTRACT_ID        | yes      | Deployed FlowPay contract address (spender)              |
 * | TOKEN_ADDRESS      | yes      | SAC token contract address                               |
 * | USER_ADDRESS       | yes      | Subscriber G-address (allowance owner)                   |
 * | USER_SECRET        | no*      | Subscriber secret key (required unless --simulate)       |
 * | AMOUNT             | yes      | Allowance amount in stroops (decimal BigInt string)       |
 * | EXPIRY_LEDGERS     | no       | Ledgers of validity from now (default: 17280 ≈ 24 h)     |
 * | RPC_URL            | no       | Soroban RPC endpoint (default: testnet)                  |
 * | NETWORK_PASSPHRASE | no       | Network passphrase (default: testnet)                    |
 * | LOG_LEVEL          | no       | debug \| info \| warn \| error (default: info)           |
 */

import {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import { MultiEndpointServer } from "./rpc-client.js";
import { logger } from "./logger.js";
import {
  encodeU128,
  encodeAddress,
  encodeU32,
  assertU128Range,
  U128_MAX,
  JS_MAX_SAFE,
} from "./lib/scval-helpers.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Result returned by `topupAllowance` — consumable by tests and CLI. */
export interface TopupResult {
  /** Whether the operation succeeded (tx Committed, or simulate succeeded). */
  success: boolean;
  /** Transaction hash (undefined in simulate mode). */
  hash?: string;
  /** Final on-chain status string, or "SIMULATED". */
  status: string;
  /** The encoded amount (BigInt string, always present). */
  amount: string;
  /** Human-readable error message if success=false. */
  error?: string;
}

/** Options for `topupAllowance`. */
export interface TopupOptions {
  /** Deployed FlowPay contract address (spender of the allowance). */
  contractId: string;
  /** SAC token contract address that holds `approve()`. */
  tokenAddress: string;
  /** Subscriber G-address (allowance owner). */
  userAddress: string;
  /**
   * Allowance amount in stroops, as a BigInt. Never pass a JS Number for
   * values exceeding `Number.MAX_SAFE_INTEGER`.
   */
  amount: bigint;
  /**
   * Subscriber Stellar secret key. Required unless `simulate=true`.
   */
  userSecret?: string;
  /** Ledgers from the current ledger to set as `live_until_ledger` (default: 17280). */
  expiryLedgers?: number;
  /** Soroban RPC URL. */
  rpcUrl?: string;
  /** Stellar network passphrase. */
  networkPassphrase?: string;
  /** If true, only simulate the transaction — do not send it. */
  simulate?: boolean;
}

// ── Status deny-list ─────────────────────────────────────────────────────────

/**
 * Transaction statuses that must abort the script.
 *
 * Any status not in this list and not "SUCCESS" is also treated as abortable.
 * The complete on-chain status vocabulary for `getTransaction` is:
 *   SUCCESS | FAILED | NOT_FOUND
 * For `sendTransaction`:
 *   PENDING | DUPLICATE | TRY_AGAIN_LATER | ERROR
 *
 * Keeping this explicit list makes the intent clear for reviewers.
 */
export const ABORT_STATUSES = new Set([
  "FAILED",
  "NOT_FOUND",
  "ERROR",
  "PENDING",
  "DUPLICATE",
  "TRY_AGAIN_LATER",
]);

/**
 * Returns true when a status string represents a successful Committed transaction.
 * Anything other than "SUCCESS" is considered non-committed.
 */
export function isSuccessStatus(status: string): boolean {
  return status === "SUCCESS";
}

/**
 * Validates that a status string does not appear on the deny-list.
 * Returns an error message if abortable, or null if acceptable.
 */
export function validateStatus(status: string): string | null {
  if (isSuccessStatus(status)) return null;
  if (ABORT_STATUSES.has(status)) {
    return `Transaction status "${status}" is not Committed — aborting`;
  }
  // Unknown statuses are also non-committed and must abort.
  return `Unknown transaction status "${status}" — aborting`;
}

// ── Amount validation ─────────────────────────────────────────────────────────

/**
 * Parses an amount string to a BigInt with strict validation.
 *
 * Guards:
 *  - Must be a non-empty decimal integer string (no decimals, no scientific notation).
 *  - Must parse to a value within [0, U128_MAX].
 *
 * @param raw - The raw string from CLI or env.
 * @returns The parsed BigInt.
 * @throws Error with a descriptive message on any format or range violation.
 */
export function parseAmount(raw: string): bigint {
  const trimmed = raw.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `AMOUNT must be a non-negative decimal integer string (no dots, no "e" notation). ` +
        `Got: "${trimmed}". ` +
        `Hint: for 100 XLM pass "1000000000" (in stroops).`
    );
  }

  const amount = BigInt(trimmed);

  // Warn loudly when amount exceeds JS safe integer range — this is exactly
  // the precision-loss footgun this script exists to prevent.
  if (amount > JS_MAX_SAFE) {
    logger.warn(
      `Amount ${amount} exceeds Number.MAX_SAFE_INTEGER (${JS_MAX_SAFE}). ` +
        `Encoding via BigInt-safe path (encodeU128). ` +
        `Do NOT pass this through Number() or nativeToScVal without type hint.`
    );
  }

  assertU128Range(amount);
  return amount;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Tops up the token allowance that the FlowPay contract is approved to spend
 * on behalf of `userAddress`.
 *
 * Calls `token.approve(from=userAddress, spender=contractId, amount, live_until_ledger)`.
 *
 * All amounts are encoded through `encodeU128()` — the only safe path for
 * u128 values that may exceed `Number.MAX_SAFE_INTEGER`.
 *
 * @returns `TopupResult` with success/hash/status/amount.
 */
export async function topupAllowance(
  options: TopupOptions
): Promise<TopupResult> {
  const {
    contractId,
    tokenAddress,
    userAddress,
    amount,
    userSecret,
    expiryLedgers = 17280,
    rpcUrl,
    networkPassphrase = Networks.TESTNET,
    simulate = false,
  } = options;

  const server = new MultiEndpointServer(rpcUrl);
  const tokenContract = new Contract(tokenAddress);

  // ── Fetch current ledger for live_until_ledger calculation ────────────────
  let currentLedger: number;
  try {
    const ledgerInfo = await server.getLatestLedger();
    currentLedger = ledgerInfo.sequence;
  } catch (err) {
    const msg = `Failed to fetch latest ledger: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    return { success: false, status: "ERROR", amount: amount.toString(), error: msg };
  }

  const liveUntilLedger = currentLedger + expiryLedgers;

  logger.info("Preparing approve() transaction", {
    tokenAddress,
    userAddress,
    spender: contractId,
    amount: amount.toString(),
    currentLedger,
    liveUntilLedger,
    simulate,
  });

  // ── Build transaction ──────────────────────────────────────────────────────
  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(userAddress);
  } catch (err) {
    const msg = `Failed to fetch account for ${userAddress}: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    return { success: false, status: "ERROR", amount: amount.toString(), error: msg };
  }

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      tokenContract.call(
        "approve",
        encodeAddress(userAddress),    // from: Address
        encodeAddress(contractId),     // spender: Address
        encodeU128(amount),            // amount: u128 — BigInt-safe
        encodeU32(liveUntilLedger)     // live_until_ledger: u32
      )
    )
    .setTimeout(60)
    .build();

  // ── Simulate ───────────────────────────────────────────────────────────────
  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err) {
    const msg = `Simulation/prepare failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    return { success: false, status: "ERROR", amount: amount.toString(), error: msg };
  }

  if (simulate) {
    logger.info("Simulate mode — transaction prepared successfully, not sent.", {
      amount: amount.toString(),
      liveUntilLedger,
    });
    return {
      success: true,
      status: "SIMULATED",
      amount: amount.toString(),
    };
  }

  // ── Sign and send ──────────────────────────────────────────────────────────
  if (!userSecret) {
    const msg = "USER_SECRET is required to submit a transaction (use --simulate for dry-run)";
    logger.error(msg);
    return { success: false, status: "ERROR", amount: amount.toString(), error: msg };
  }

  const keypair = Keypair.fromSecret(userSecret);
  // prepareTransaction returns a Transaction — sign it before submission.
  (preparedTx as any).sign(keypair);

  let sendResult: Api.SendTransactionResponse;
  try {
    sendResult = await server.sendTransaction(preparedTx as any);
  } catch (err) {
    const msg = `sendTransaction threw: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    return { success: false, status: "ERROR", amount: amount.toString(), error: msg };
  }

  // Validate send status — any non-pending result that isn't going to
  // become SUCCESS should abort immediately.
  if (sendResult.status !== "PENDING") {
    const errMsg = validateStatus(sendResult.status) ?? `Unexpected send status: ${sendResult.status}`;
    logger.error(errMsg, { hash: sendResult.hash, status: sendResult.status });
    return {
      success: false,
      hash: sendResult.hash,
      status: sendResult.status,
      amount: amount.toString(),
      error: errMsg,
    };
  }

  logger.info("Transaction submitted, waiting for confirmation…", {
    hash: sendResult.hash,
  });

  // ── Poll for final status ──────────────────────────────────────────────────
  const hash = sendResult.hash;
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    await sleep(2_000);

    let txResponse: Api.GetTransactionResponse;
    try {
      txResponse = await server.getTransaction(hash);
    } catch (err) {
      logger.warn(`getTransaction error (will retry): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (txResponse.status === "NOT_FOUND") {
      // Still propagating — keep polling.
      continue;
    }

    // Validate the final status using the deny-list.
    const statusError = validateStatus(txResponse.status);
    if (statusError) {
      logger.error(statusError, { hash, status: txResponse.status });
      return {
        success: false,
        hash,
        status: txResponse.status,
        amount: amount.toString(),
        error: statusError,
      };
    }

    // Status is "SUCCESS".
    logger.info("Allowance top-up confirmed.", {
      hash,
      status: txResponse.status,
      amount: amount.toString(),
      liveUntilLedger,
    });

    return {
      success: true,
      hash,
      status: txResponse.status,
      amount: amount.toString(),
    };
  }

  const timeoutMsg = `Timed out waiting for transaction ${hash}`;
  logger.error(timeoutMsg);
  return {
    success: false,
    hash,
    status: "TIMEOUT",
    amount: amount.toString(),
    error: timeoutMsg,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function showHelp(): never {
  logger.info(`
Usage: npx tsx scripts/topup-allowance.ts [--simulate] [--help]

Environment variables:
  CONTRACT_ID         Required. Deployed FlowPay contract address (spender).
  TOKEN_ADDRESS       Required. SAC token contract address.
  USER_ADDRESS        Required. Subscriber G-address (allowance owner).
  USER_SECRET         Required (unless --simulate). Subscriber secret key.
  AMOUNT              Required. Allowance amount in stroops (integer string).
  EXPIRY_LEDGERS      Optional. Ledgers until allowance expires (default: 17280 ≈ 24 h).
  RPC_URL             Optional. Soroban RPC endpoint (default: testnet).
  NETWORK_PASSPHRASE  Optional. Network passphrase (default: testnet).
  LOG_LEVEL           Optional. debug | info | warn | error (default: info).

Flags:
  --simulate, -s   Simulate only (prepare + validate, do not send).
  --help, -h       Show this help.

Examples:
  # Top up 5,000 XLM (50,000,000,000 stroops) with 7-day expiry
  CONTRACT_ID=C... TOKEN_ADDRESS=C... USER_ADDRESS=G... USER_SECRET=S... \\
    AMOUNT=50000000000 EXPIRY_LEDGERS=120960 \\
    npx tsx scripts/topup-allowance.ts

  # Dry-run (simulate only, no transaction sent)
  CONTRACT_ID=C... TOKEN_ADDRESS=C... USER_ADDRESS=G... AMOUNT=50000000000 \\
    npx tsx scripts/topup-allowance.ts --simulate
`);
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let simulate = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") showHelp();
    if (arg === "--simulate" || arg === "-s") simulate = true;
  }

  // ── Read and validate env ──────────────────────────────────────────────────
  const contractId = process.env.CONTRACT_ID?.trim() ?? "";
  const tokenAddress = process.env.TOKEN_ADDRESS?.trim() ?? "";
  const userAddress = process.env.USER_ADDRESS?.trim() ?? "";
  const userSecret = process.env.USER_SECRET?.trim();
  const amountRaw = process.env.AMOUNT?.trim() ?? "";
  const expiryLedgersRaw = process.env.EXPIRY_LEDGERS?.trim();
  const rpcUrl = process.env.RPC_URL?.trim();
  const networkPassphrase = (
    process.env.NETWORK_PASSPHRASE?.trim() ?? Networks.TESTNET
  ) as string;

  const missing: string[] = [];
  if (!contractId) missing.push("CONTRACT_ID");
  if (!tokenAddress) missing.push("TOKEN_ADDRESS");
  if (!userAddress) missing.push("USER_ADDRESS");
  if (!amountRaw) missing.push("AMOUNT");
  if (!simulate && !userSecret) missing.push("USER_SECRET (required unless --simulate)");

  if (missing.length > 0) {
    logger.error(`Missing required environment variable(s): ${missing.join(", ")}`);
    logger.error("Run with --help for usage.");
    process.exit(1);
  }

  // Parse amount — strict decimal integer validation.
  let amount: bigint;
  try {
    amount = parseAmount(amountRaw);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Parse optional EXPIRY_LEDGERS.
  let expiryLedgers = 17280;
  if (expiryLedgersRaw !== undefined) {
    const parsed = parseInt(expiryLedgersRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      logger.error(
        `EXPIRY_LEDGERS must be a positive integer, got "${expiryLedgersRaw}"`
      );
      process.exit(1);
    }
    expiryLedgers = parsed;
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  const result = await topupAllowance({
    contractId,
    tokenAddress,
    userAddress,
    amount,
    userSecret,
    expiryLedgers,
    rpcUrl,
    networkPassphrase,
    simulate,
  });

  if (!result.success) {
    logger.error("topup-allowance failed.", {
      status: result.status,
      error: result.error,
    });
    process.exit(1);
  }

  logger.info(
    simulate
      ? "Simulation successful — allowance top-up would succeed."
      : "Allowance top-up committed successfully.",
    {
      hash: result.hash,
      status: result.status,
      amount: result.amount,
    }
  );
}

// Guard: only run as a CLI entry point, not when imported by tests.
// `import.meta.url` will match `process.argv[1]` only when executed directly.
const isMain = process.argv[1]?.includes("topup-allowance");
if (isMain) {
  main().catch((err: unknown) => {
    logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
