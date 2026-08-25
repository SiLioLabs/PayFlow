#!/usr/bin/env tsx
/**
 * keeper.ts — Autonomous keeper bot for FlowPay recurring billing
 *
 * Continuously invokes `batch_charge()` on the deployed FlowPay contract,
 * paging through all active subscriptions on a configurable interval.
 *
 * Architecture
 * ────────────
 * Each charge cycle iterates subscriber pages (offset 0, PAGE_SIZE, 2×PAGE_SIZE …)
 * until a page returns fewer results than PAGE_SIZE, signalling the end of the
 * subscriber index. Failed pages are retried up to MAX_RETRIES times with
 * exponential back-off before being skipped and logged.
 *
 * Usage
 * ─────
 *   CONTRACT_ID=C... KEEPER_SECRET=S... tsx keeper.ts
 *
 * Environment variables
 * ─────────────────────
 *   CONTRACT_ID          Required. Deployed FlowPay contract ID.
 *   KEEPER_SECRET        Required. Stellar secret key (S...) funding keeper txns.
 *   RPC_URL              Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE   Stellar network passphrase (default: testnet).
 *   CHARGE_INTERVAL_MS   Milliseconds between full charge cycles (default: 3600000 = 1 h).
 *   PAGE_SIZE            Subscriptions per batch_charge call (default: 100, max: 100).
 *   MAX_RETRIES          Per-page retry attempts before skipping (default: 3).
 *   LOG_LEVEL            debug | info | warn | error (default: info).
 *
 * Exit codes
 * ──────────
 *   0 — graceful shutdown (SIGINT / SIGTERM)
 *   1 — fatal configuration error
 */

 * keeper.ts — PayFlow Keeper Bot
 *
 * Processes recurring payments by calling batch_charge() on a regular interval.
 * Uses buildOptimizedBatches() so only ready subscribers are charged, ordered by
 * grace urgency and overdue age.
 * Supports dry-run mode via DRY_RUN=true env var for simulation without state changes.
 *
 * Usage:
 *   CONTRACT_ID=... KEEPER_PUBLIC_KEY=... tsx keeper.ts
 *   CONTRACT_ID=... KEEPER_PUBLIC_KEY=... KEEPER_SECRET=... tsx keeper.ts
 *   CONTRACT_ID=... DRY_RUN=true KEEPER_PUBLIC_KEY=... tsx keeper.ts --once
 *
 * Environment Variables:
 *   CONTRACT_ID           Required. Deployed FlowPay contract ID.
 *   KEEPER_PUBLIC_KEY     Required. Source account public key (must be funded on network).
 *   KEEPER_SECRET         Required in live mode. Secret key to sign transactions.
 *   DRY_RUN               Set to "true" to run in dry-run simulation mode.
 *   RPC_URL               Optional. Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE    Optional. Network passphrase (default: Testnet).
 *   BATCH_SIZE            Optional. Subscribers per page (default: 50, max: 50).
 *   INTERVAL_SECONDS      Optional. Loop interval (default: 3600).
 *
 * Flags:
 *   --once      Run a single cycle and exit.
 *   --help, -h  Show this help message.
 *
 * Caveats:
 *   - Dry-run simulation results may differ from actual charges due to
 *     allowance changes, contract pause state, or timing between simulation
 *     and submission.
 *   - Unlike real batch_charge, get_batch_charge_estimate does not check
 *     contract pause state or token allowances — it only checks subscription
 *     state, interval, and grace period.
 */

import { Server } from "@stellar/stellar-sdk/rpc";
import { buildOptimizedBatches } from "./batch-optimizer";
import {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const KEEPER_SECRET = process.env.KEEPER_SECRET ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ??
  Networks.TESTNET) as string;
const CHARGE_INTERVAL_MS = parseInt(
  process.env.CHARGE_INTERVAL_MS ?? "3600000",
  10,
);
const PAGE_SIZE = Math.min(parseInt(process.env.PAGE_SIZE ?? "100", 10), 100);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES ?? "3", 10);
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info") as
  "debug" | "info" | "warn" | "error";

// ── Startup validation ────────────────────────────────────────────────────────

if (!CONTRACT_ID) {
  console.error("FATAL: CONTRACT_ID environment variable is required.");
  process.exit(1);
}
if (!KEEPER_SECRET) {
  console.error("FATAL: KEEPER_SECRET environment variable is required.");
  process.exit(1);
}

let keeperKeypair: Keypair;
try {
  keeperKeypair = Keypair.fromSecret(KEEPER_SECRET);
} catch {
  console.error("FATAL: KEEPER_SECRET is not a valid Stellar secret key.");
  process.exit(1);
}

// ── Logging ───────────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const activeLevel = LEVEL_ORDER[LOG_LEVEL] ?? 1;

function log(
  level: "debug" | "info" | "warn" | "error",
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if ((LEVEL_ORDER[level] ?? 0) < activeLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// ── RPC client ────────────────────────────────────────────────────────────────

const server = new Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

// ── Charge result types ───────────────────────────────────────────────────────

interface PageSummary {
  page: number;
  offset: number;
  charged: number;
  skipped: number;
  error: string | null;
}

interface CycleSummary {
  cycle: number;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  total_charged: number;
  total_skipped: number;
  pages_processed: number;
  pages_failed: number;
}

// ── Batch charge execution ────────────────────────────────────────────────────

/**
 * Parse the `Vec<ChargeResult>` returned by `batch_charge`.
 * ChargeResult is an enum: Charged | Skipped(reason) | NoSubscription.
 * We only need the counts here.
 */
function parseChargeResults(retval: xdr.ScVal): {
  charged: number;
  skipped: number;
} {
  let charged = 0;
  let skipped = 0;

  const vec = retval.vec();
  if (!vec) return { charged, skipped };

  for (const item of vec) {
    try {
      const name = item.switch().name;
      // scvVec wraps enum variants; check the inner sym name
      if (name === "scvVec") {
        const inner = item.vec();
        const variant = inner?.[0]?.sym()?.toString() ?? "";
        if (variant === "Charged") charged++;
        else skipped++;
      } else if (name === "scvMap") {
        // Some SDK versions wrap enum as a map
        const key = item.map()?.[0]?.key()?.sym()?.toString() ?? "";
        if (key === "Charged") charged++;
        else skipped++;
      } else {
        // Unrecognised shape — count as skipped
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { charged, skipped };
}

/**
 * Submit one `batch_charge(offset, limit)` transaction and return the result.
 * Throws on RPC / submission error so the caller can retry.
 */
async function batchChargePage(
  offset: number,
  limit: number,
): Promise<{ charged: number; skipped: number }> {
  const account = await server.getAccount(keeperKeypair.publicKey());

  Address,
  xdr,
} from "@stellar/stellar-sdk";

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID || "";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET) as string;
const DRY_RUN = process.env.DRY_RUN === "true";
const KEEPER_PUBLIC_KEY = process.env.KEEPER_PUBLIC_KEY || "";
const KEEPER_SECRET = process.env.KEEPER_SECRET || "";
const BATCH_SIZE = Math.min(Math.max(Number(process.env.BATCH_SIZE) || 50, 1), 50);
const INTERVAL_SECONDS = Math.max(Number(process.env.INTERVAL_SECONDS) || 3600, 1);

const server = new Server(RPC_URL);

// ── Validation ───────────────────────────────────────────────────────────────

function validateEnv(): void {
  const errors: string[] = [];
  if (!CONTRACT_ID) errors.push("CONTRACT_ID is required");
  if (!KEEPER_PUBLIC_KEY) errors.push("KEEPER_PUBLIC_KEY is required");
  if (!DRY_RUN && !KEEPER_SECRET) errors.push("KEEPER_SECRET is required in live mode (or set DRY_RUN=true)");

  if (errors.length > 0) {
    console.error("Error: Missing required environment variables:");
    for (const err of errors) console.error(`  - ${err}`);
    console.error("\nUsage: CONTRACT_ID=... KEEPER_PUBLIC_KEY=... tsx keeper.ts [--once]");
    console.error("   or: CONTRACT_ID=... DRY_RUN=true KEEPER_PUBLIC_KEY=... tsx keeper.ts --once\n");
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
PayFlow Keeper Bot

Usage:
  CONTRACT_ID=... KEEPER_PUBLIC_KEY=... tsx keeper.ts [options]
  CONTRACT_ID=... DRY_RUN=true KEEPER_PUBLIC_KEY=... tsx keeper.ts [options]

Options:
  --once      Run a single charge cycle and exit.
  --help, -h  Show this help message.

Environment Variables:
  CONTRACT_ID           Required. Deployed FlowPay contract ID.
  KEEPER_PUBLIC_KEY     Required. Source account public key (must be funded on the network).
  KEEPER_SECRET         Required for live mode. Secret key to sign transactions.
  DRY_RUN               Set to "true" for dry-run simulation mode (no transactions submitted).
  RPC_URL               Optional. Soroban RPC endpoint (default: testnet).
  NETWORK_PASSPHRASE    Optional. Network passphrase (default: Testnet).
  BATCH_SIZE            Optional. Subscribers per page (default: 50, max: 50).
  INTERVAL_SECONDS      Optional. Seconds between cycles (default: 3600).

Caveats:
  Dry-run results may differ from actual charges — allowance changes, contract
  pause state, or timing between simulation and submission can all cause
  discrepancies. The get_batch_charge_estimate function used in dry-run mode
  does not check token allowances or contract pause state.
  `);
  process.exit(0);
}

// ── SDK Helpers ──────────────────────────────────────────────────────────────

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

function stroopsToXlm(stroops: bigint | string): string {
  const value = typeof stroops === "bigint" ? Number(stroops) : Number(stroops);
  return (value / 10_000_000).toFixed(7);
}

function log(dryRun: boolean, message: string): void {
  const prefix = dryRun ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${prefix} ${message}`);
}

/**
 * Decode a Vec<ChargeResult> or Vec<ChargeSimResult> from an ScVal return value.
 * Each enum variant is encoded as a ScVal symbol.
 */
function decodeEnumVec(retval: xdr.ScVal): string[] {
  const vec =
    typeof (retval as any).vec === "function"
      ? ((retval as any).vec() as xdr.ScVal[])
      : ((retval as any)._value?.vec as xdr.ScVal[] | undefined);

  if (!Array.isArray(vec)) return [];

  return vec.map((item: any) => {
    if (item.switch?.()?.name === "scvSymbol") {
      return item.sym().toString();
    }
    return String(item);
  });
}

// ── Contract Reads ───────────────────────────────────────────────────────────

async function getSubscriberCount(): Promise<number> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(KEEPER_PUBLIC_KEY);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_subscriber_count"))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return 0;

  return Number(retval.u64());
}

async function getSubscriberPage(offset: number, limit: number): Promise<string[]> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(KEEPER_PUBLIC_KEY);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "get_subscriber_page",
        nativeToScVal(offset, { type: "u64" }),
        nativeToScVal(limit, { type: "u32" })
      )
    )
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return [];

  const vec =
    typeof (retval as any).vec === "function"
      ? ((retval as any).vec() as xdr.ScVal[])
      : ((retval as any)._value?.vec as xdr.ScVal[] | undefined);

  if (!Array.isArray(vec)) return [];

  return vec.map((item: xdr.ScVal) => Address.fromScVal(item).toString());
}

async function getSubscriptionAmount(user: string): Promise<bigint | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(user).catch(() => null);
    if (!account) return null;

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("get_subscription", addressVal(user)))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return null;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval || retval.switch().name === "scvVoid") return null;

    for (const entry of retval.map() ?? []) {
      const key = entry.key().sym().toString();
      const val = entry.val();
      if (key === "amount") {
        return BigInt(val.i128().toString());
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether the contract is paused.
 * In dry-run mode, the estimate function doesn't check pause state,
 * so we surface it separately.
 */
async function isContractPaused(): Promise<boolean> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(KEEPER_PUBLIC_KEY);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("is_contract_paused"))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ("error" in result) return false;

    const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
    return retval?.b() ?? false;
  } catch {
    return false;
  }
}

// ── Batch Charge Simulation (Dry-Run) ────────────────────────────────────────

interface DryRunPageResult {
  checked: number;
  wouldCharge: number;
  totalVolume: bigint;
  skipCounts: Record<string, number>;
  errors: string[];
}

/**
 * Simulate a batch charge using get_batch_charge_estimate.
 * No transaction is submitted — no on-chain state changes.
 */
async function simulateBatchCharge(users: string[]): Promise<{
  results: string[];
  amounts: bigint[];
}> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(KEEPER_PUBLIC_KEY);

  const usersVec = xdr.ScVal.scvVec(users.map((u) => addressVal(u)));
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_batch_charge_estimate", usersVec))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) return { results: users.map(() => "Unknown"), amounts: [] };

  const variants = decodeEnumVec(retval);

  // Fetch amounts for users that would be charged (for volume estimation)
  const amounts: bigint[] = [];
  for (let i = 0; i < Math.min(variants.length, users.length); i++) {
    if (variants[i] === "Charged") {
      const amt = await getSubscriptionAmount(users[i]);
      amounts.push(amt ?? 0n);
    }
  }

  return { results: variants, amounts };
}

// ── Live Batch Charge ────────────────────────────────────────────────────────

interface LivePageResult {
  charged: number;
  totalVolume: bigint;
  skipCounts: Record<string, number>;
  txHash?: string;
  errors: string[];
}

/**
 * Build, sign, and submit a real batch_charge transaction.
 * Returns the preview results from simulation (before submission).
 */
async function submitBatchCharge(users: string[]): Promise<{
  results: string[];
  amounts: bigint[];
  txHash: string;
}> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(KEEPER_PUBLIC_KEY);

  const usersVec = xdr.ScVal.scvVec(users.map((u) => addressVal(u)));
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "batch_charge",
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" }),
      ),
    )
    .setTimeout(60)
    .build();

  // Simulate to populate the Soroban footprint.
  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Assemble and sign.
  const assembled = assembleTransaction(tx, simResult).build();
  assembled.sign(keeperKeypair);

  // Submit and wait for confirmation.
  const sendResult = await server.sendTransaction(assembled);
  if (sendResult.status === "ERROR") {
    throw new Error(`Transaction rejected: ${JSON.stringify(sendResult)}`);
  }

  // Poll for final status.
  const hash = sendResult.hash;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const status = await server.getTransaction(hash);
    if (status.status === "SUCCESS") {
      const retval = (status as { returnValue?: xdr.ScVal }).returnValue;
      if (!retval) return { charged: 0, skipped: 0 };
      return parseChargeResults(retval);
    }
    if (status.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
    // status === "NOT_FOUND" means still pending — keep polling
  }

  throw new Error(`Transaction ${hash} not confirmed within 30 s`);
}

// ── Retry with exponential back-off ──────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt `batchChargePage` up to `MAX_RETRIES` times with exponential back-off.
 * Returns a PageSummary. On exhausted retries, `error` field is set.
 */
async function chargePageWithRetry(
  page: number,
  offset: number,
): Promise<PageSummary> {
  let lastError: string = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { charged, skipped } = await batchChargePage(offset, PAGE_SIZE);
      return { page, offset, charged, skipped, error: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      log("warn", `Page ${page} attempt ${attempt}/${MAX_RETRIES} failed`, {
        offset,
        error: lastError,
        retry_in_ms: backoff,
      });
      if (attempt < MAX_RETRIES) await sleep(backoff);
    }
  }

  return { page, offset, charged: 0, skipped: 0, error: lastError };
}

// ── Full charge cycle ─────────────────────────────────────────────────────────

let cycleCount = 0;

async function runChargeCycle(): Promise<CycleSummary> {
  cycleCount++;
  const cycleStart = Date.now();
  const startedAt = new Date(cycleStart).toISOString();

  log("info", "Charge cycle starting", { cycle: cycleCount });

  let totalCharged = 0;
  let totalSkipped = 0;
  let pagesProcessed = 0;
  let pagesFailed = 0;

  let offset = 0;
  let page = 0;

  while (true) {
    const summary = await chargePageWithRetry(page, offset);
    pagesProcessed++;

    if (summary.error) {
      pagesFailed++;
      log("error", "Page failed after all retries — skipping", {
        cycle: cycleCount,
        page,
        offset,
        error: summary.error,
      });
    } else {
      totalCharged += summary.charged;
      totalSkipped += summary.skipped;
      log("debug", "Page processed", {
        cycle: cycleCount,
        page,
        offset,
        charged: summary.charged,
        skipped: summary.skipped,
      });
    }

    // End-of-list detection: if the page returned fewer results than PAGE_SIZE
    // (including 0) we have consumed all subscribers.
    const pageTotal = summary.charged + summary.skipped;
    if (pageTotal < PAGE_SIZE) {
      log("debug", "Last page reached", {
        cycle: cycleCount,
        page,
        page_total: pageTotal,
      });
      break;
    }

    offset += PAGE_SIZE;
    page++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - cycleStart;

  const cycleSummary: CycleSummary = {
    cycle: cycleCount,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    total_charged: totalCharged,
    total_skipped: totalSkipped,
    pages_processed: pagesProcessed,
    pages_failed: pagesFailed,
  };

  log(
    "info",
    "Charge cycle complete",
    cycleSummary as unknown as Record<string, unknown>,
  );
  return cycleSummary;
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("info", "FlowPay Keeper starting", {
    contract: CONTRACT_ID,
    keeper: keeperKeypair.publicKey(),
    rpc: RPC_URL,
    charge_interval_ms: CHARGE_INTERVAL_MS,
    page_size: PAGE_SIZE,
    max_retries: MAX_RETRIES,
  });

  let shutdown = false;
  const onSignal = (): void => {
    log(
      "info",
      "Shutdown signal received — finishing current cycle then exiting.",
    );
    shutdown = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  while (!shutdown) {
    try {
      await runChargeCycle();
    } catch (err) {
      // Unexpected error in the cycle loop itself — log and continue.
      log("error", "Unexpected error in charge cycle", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!shutdown) {
      log("info", `Sleeping ${CHARGE_INTERVAL_MS} ms until next cycle.`);
      await sleep(CHARGE_INTERVAL_MS);
    }
  }

  log("info", "Keeper stopped gracefully.");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "Fatal unhandled error",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
    .addOperation(contract.call("batch_charge", usersVec))
    .setTimeout(30)
    .build();

  // Simulate to get fee estimation and preview results
  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  const retval = (simResult as { result?: { retval?: xdr.ScVal } }).result?.retval;
  const previewResults = retval ? decodeEnumVec(retval) : users.map(() => "Unknown");

  // Pre-fetch amounts for charging users (preview)
  const amounts: bigint[] = [];
  for (let i = 0; i < Math.min(previewResults.length, users.length); i++) {
    if (previewResults[i] === "Charged") {
      const amt = await getSubscriptionAmount(users[i]);
      amounts.push(amt ?? 0n);
    }
  }

  // Assemble transaction with simulation results
  const { assembleTransaction } = await import("@stellar/stellar-sdk/rpc");
  const prepared = assembleTransaction(tx, simResult) as any;

  // Sign with keeper secret
  const keypair = Keypair.fromSecret(KEEPER_SECRET);
  prepared.sign(keypair);

  // Submit
  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    const errObj = sendResult.errorResult as unknown as { code?: { toString(): string } };
    const code = errObj?.code?.toString() ?? "unknown";
    throw new Error(`Transaction failed (${code})`);
  }

  const txHash = sendResult.hash;

  // Wait for confirmation
  const TIMEOUT_MS = 60_000;
  const POLL_MS = 1_000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const txResult = await server.getTransaction(txHash);
    if (txResult.status === "SUCCESS") break;
    if (txResult.status === "FAILED") {
      throw new Error(`Transaction ${txHash} failed on chain`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  return { results: previewResults, amounts, txHash };
}

// ── Page Processing ──────────────────────────────────────────────────────────

async function processPageDryRun(users: string[], pageOffset: number): Promise<DryRunPageResult> {
  const result: DryRunPageResult = {
    checked: users.length,
    wouldCharge: 0,
    totalVolume: 0n,
    skipCounts: {},
    errors: [],
  };

  if (users.length === 0) return result;

  const { results, amounts } = await simulateBatchCharge(users);

  let amountIdx = 0;
  for (let i = 0; i < results.length; i++) {
    const variant = results[i];
    if (variant === "Charged") {
      result.wouldCharge++;
      const amt = amountIdx < amounts.length ? amounts[amountIdx] : 0n;
      result.totalVolume += amt;
      amountIdx++;
    } else {
      result.skipCounts[variant] = (result.skipCounts[variant] || 0) + 1;
    }
  }

  return result;
}

async function processPageLive(users: string[], pageOffset: number): Promise<LivePageResult> {
  const result: LivePageResult = {
    charged: 0,
    totalVolume: 0n,
    skipCounts: {},
    errors: [],
  };

  if (users.length === 0) return result;

  try {
    const { results, amounts, txHash } = await submitBatchCharge(users);
    result.txHash = txHash;

    let amountIdx = 0;
    for (let i = 0; i < results.length; i++) {
      const variant = results[i];
      if (variant === "Charged") {
        result.charged++;
        const amt = amountIdx < amounts.length ? amounts[amountIdx] : 0n;
        result.totalVolume += amt;
        amountIdx++;
      } else {
        result.skipCounts[variant] = (result.skipCounts[variant] || 0) + 1;
      }
    }
  } catch (err) {
    result.errors.push(`Page ${pageOffset}: ${err}`);
  }

  return result;
}

// ── Cycle ────────────────────────────────────────────────────────────────────

interface CycleReport {
  totalChecked: number;
  totalCharged: number;
  totalVolume: bigint;
  totalSkips: Record<string, number>;
  errors: string[];
  txHashes: string[];
}

async function runCycle(): Promise<CycleReport> {
  const isDryRun = DRY_RUN;
  const report: CycleReport = {
    totalChecked: 0,
    totalCharged: 0,
    totalVolume: 0n,
    totalSkips: {},
    errors: [],
    txHashes: [],
  };

  const paused = await isContractPaused();
  if (paused) {
    log(isDryRun, "Contract is PAUSED — skipping charge cycle");
    return report;
  }

  // Ensure optimizer sees the same contract/RPC configuration as this keeper.
  process.env.CONTRACT_ID = CONTRACT_ID;
  process.env.RPC_URL = RPC_URL;
  process.env.NETWORK_PASSPHRASE = NETWORK_PASSPHRASE;

  const optimized = await buildOptimizedBatches();
  report.totalChecked = optimized.ready_count + optimized.deferred_count;

  if (optimized.batches.length === 0) {
    log(
      isDryRun,
      `No ready subscribers (ready=${optimized.ready_count} deferred=${optimized.deferred_count})`
    );
    return report;
  }

  log(
    isDryRun,
    `Optimizer selected ${optimized.ready_count} ready user(s) in ${optimized.batches.length} batch(es); deferred=${optimized.deferred_count}`
  );

  for (const batch of optimized.batches) {
    const users = batch.users;
    const offset = batch.batch;

    if (isDryRun) {
      const pageResult = await processPageDryRun(users, offset);
      report.totalCharged += pageResult.wouldCharge;
      report.totalVolume += pageResult.totalVolume;
      report.errors.push(...pageResult.errors);

      const skipDetails = Object.entries(pageResult.skipCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");

      log(
        true,
        `Batch ${offset}: checked=${pageResult.checked} wouldCharge=${pageResult.wouldCharge} volume=${stroopsToXlm(pageResult.totalVolume)} XLM`
      );
      if (skipDetails) log(true, `  ${skipDetails}`);
    } else {
      const pageResult = await processPageLive(users, offset);
      report.totalCharged += pageResult.charged;
      report.totalVolume += pageResult.totalVolume;

      for (const [k, v] of Object.entries(pageResult.skipCounts)) {
        report.totalSkips[k] = (report.totalSkips[k] || 0) + v;
      }
      report.errors.push(...pageResult.errors);
      if (pageResult.txHash) report.txHashes.push(pageResult.txHash);

      const skipDetails = Object.entries(pageResult.skipCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");

      log(
        false,
        `Batch ${offset}: charged=${pageResult.charged} volume=${stroopsToXlm(pageResult.totalVolume)} XLM${pageResult.txHash ? ` tx=${pageResult.txHash}` : ""}`
      );
      if (skipDetails) log(false, `  ${skipDetails}`);
    }
  }

  const skipDetails = Object.entries(report.totalSkips)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");

  const summary = isDryRun
    ? `Cycle complete: checked=${report.totalChecked} wouldCharge=${report.totalCharged} totalVolume=${stroopsToXlm(report.totalVolume)} XLM`
    : `Cycle complete: charged=${report.totalCharged} totalVolume=${stroopsToXlm(report.totalVolume)} XLM${skipDetails ? ` | ${skipDetails}` : ""}`;

  log(isDryRun, summary);

  if (report.errors.length > 0) {
    for (const err of report.errors) log(isDryRun, `Error: ${err}`);
  }

  return report;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") showHelp();
  }

  const once = argv.includes("--once");

  validateEnv();

  if (DRY_RUN) {
    log(true, "Keeper started in DRY-RUN mode — no transactions will be submitted");
  } else {
    log(false, "Keeper started in LIVE mode");
  }

  if (once) {
    const report = await runCycle();
    process.exit(report.errors.length > 0 && report.totalCharged === 0 ? 1 : 0);
  }

  // Loop mode
  while (true) {
    const report = await runCycle();
    const nextRun = new Date(Date.now() + INTERVAL_SECONDS * 1000);
    log(DRY_RUN, `Next cycle at ${nextRun.toISOString()} (in ${INTERVAL_SECONDS}s)`);

    if (report.errors.length > 0 && report.totalCharged === 0) {
      log(DRY_RUN, "All pages errored — will retry next cycle");
    }

    await new Promise((r) => setTimeout(r, INTERVAL_SECONDS * 1000));
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
