#!/usr/bin/env tsx
/**
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
 *   BATCH_SIZE            Optional. Subscribers per page for legacy paging
 *                         (default: on-chain max via get_max_batch_size,
 *                         falling back to 50 if the RPC read fails). Always
 *                         clamped to the live on-chain max (see
 *                         get_max_batch_size) and to the hard ceiling of 200,
 *                         so a misconfigured value can never trigger the
 *                         contract's BatchTooLarge panic.
 *   INTERVAL_SECONDS      Optional. Loop interval (default: 3600).
 *   REPORT_DIR            Optional. Directory for dry-run reports and live-cycle pointer
 *                         (default: <script_dir>/data/benchmarks).
 *   KEEPER_USE_LEGACY_PAGING  Optional. Set to "true" to use legacy sequential
 *                         offset-based paging instead of grace-urgency-ordered
 *                         optimized batches (default: false, i.e. optimized).
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

import fs from "fs";
import path from "path";
import { assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { MultiEndpointServer } from "./rpc-client.js";
import { buildOptimizedBatches } from "./batch-optimizer";
import { Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { buildOptimizedBatches } from "./batch-optimizer.js";
import {
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

// ── Configuration ────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID || "";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET) as string;
const DRY_RUN = process.env.DRY_RUN === "true";
const KEEPER_PUBLIC_KEY = process.env.KEEPER_PUBLIC_KEY || "";
const KEEPER_SECRET = process.env.KEEPER_SECRET || "";

/**
 * BATCH_SIZE resolution — kept in sync with the on-chain `get_max_batch_size`
 * value (and with batch-optimizer.ts's MAX_BATCH_SIZE handling) so the legacy
 * paging path can never request a page larger than the contract will accept.
 *
 * `ENV_BATCH_SIZE` is the raw operator-supplied override, if any.
 * `BATCH_SIZE` starts as the env override (or the fallback default) and is
 * narrowed down to the live on-chain max once `resolveBatchSize()` runs at
 * startup. It is intentionally `let`, not `const`, so `main()` can tighten it
 * before any charge cycle begins.
 */
const ENV_BATCH_SIZE = process.env.BATCH_SIZE ? Number(process.env.BATCH_SIZE) : undefined;
const DEFAULT_BATCH_SIZE = 50; // Mirrors the contract's own MAX_BATCH_SIZE default.
const BATCH_SIZE_CEILING = 200; // Mirrors the contract's MAX_BATCH_SIZE_CEILING.
let BATCH_SIZE =
  ENV_BATCH_SIZE && ENV_BATCH_SIZE > 0
    ? Math.min(BATCH_SIZE_CEILING, Math.max(1, ENV_BATCH_SIZE))
    : DEFAULT_BATCH_SIZE;

const INTERVAL_SECONDS = Math.max(Number(process.env.INTERVAL_SECONDS) || 3600, 1);
const REPORT_DIR = process.env.REPORT_DIR ?? path.join(__dirname, "data", "benchmarks");
const USE_LEGACY_PAGING = process.env.KEEPER_USE_LEGACY_PAGING === "true";

const server = new MultiEndpointServer();

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
  BATCH_SIZE            Optional. Subscribers per page for legacy paging
                        (default: on-chain max via get_max_batch_size,
                        falling back to 50). Always clamped to the live
                        on-chain max and to the 200 hard ceiling.
  INTERVAL_SECONDS      Optional. Seconds between cycles (default: 3600).
  REPORT_DIR            Optional. Directory where dry-run reports and the live-cycle
                        pointer file are written (default: <script_dir>/data/benchmarks).
  KEEPER_USE_LEGACY_PAGING  Optional. Set to "true" to use legacy sequential
                        offset-based paging instead of grace-urgency-ordered
                        optimized batches (default: false).

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

// ── File I/O Helpers ─────────────────────────────────────────────────────────

/**
 * Write JSON to filePath, creating parent directories as needed.
 * Wraps all I/O in try/catch — a write failure logs a warning but never crashes
 * the keeper.
 */
function writeJsonFile(filePath: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    log(DRY_RUN, `WARNING: failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Read and JSON-parse a file. Returns null on any error (missing, invalid JSON, etc.). */
function readJsonFile<T = unknown>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Report types ─────────────────────────────────────────────────────────────

/** One subscriber's outcome within a cycle, included in both dry-run and live reports. */
interface CandidateRecord {
  user: string;
  result: string;
  /** Subscription amount in stroops. "0" when the result is not Charged. */
  amountStroops: string;
}

/**
 * Small pointer file overwritten after every successful live cycle.
 * Path: REPORT_DIR/keeper-latest-live.json
 */
interface LatestLiveRecord {
  timestamp: string;
  contractId: string;
  totalChecked: number;
  totalCharged: number;
  totalVolume: string;
  totalSkips: number;
}

/** Shape written to REPORT_DIR/keeper-dryrun-report-<timestamp>.json */
interface DryRunReport {
  timestamp: string;
  mode: "dry-run";
  contractId: string;
  rpcUrl: string;
  /** Which batch-formation path was used: optimized (grace-urgency) or legacy (sequential). */
  pagingMode: "optimized" | "legacy";
  estimatedOutcomes: {
    totalChecked: number;
    totalCharged: number;
    totalVolumeStroops: string;
    skipCounts: Record<string, number>;
  };
  /** Lapsed-vs-charged metrics by urgency bucket. */
  graceMetrics: {
    urgentCharged: number;
    urgentLapsed: number;
    normalCharged: number;
    normalLapsed: number;
  };
  candidates: CandidateRecord[];
  lastLiveCycle: LatestLiveRecord | null;
  comparison: {
    checkedDelta: number;
    chargedDelta: number;
    volumeDelta: string;
    lastLiveAgeMs: number;
    lastLiveAgeHuman: string;
  } | null;
  errors: string[];
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

/**
 * Read the contract's current `get_max_batch_size()` — the on-chain cap for
 * `batch_charge()` calls. Defaults to 50 on-chain but is admin-configurable
 * up to `MAX_BATCH_SIZE_CEILING` (200) via `set_max_batch_size`.
 *
 * Throws on any RPC/simulation failure so callers can fall back explicitly
 * rather than silently treating an unreadable value as "no limit".
 */
async function getMaxBatchSize(): Promise<number> {
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(KEEPER_PUBLIC_KEY);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_max_batch_size"))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) throw new Error(result.error);

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval) throw new Error("get_max_batch_size returned no value");

  return retval.u32();
}

/**
 * Resolve the effective legacy-paging BATCH_SIZE for this run.
 *
 * Starts from the operator-supplied BATCH_SIZE (or the 50-subscriber
 * fallback default) and clamps it down to the live on-chain max reported by
 * `get_max_batch_size()`, so BATCH_SIZE can never exceed what the contract
 * will actually accept — regardless of what config.ts allowed through (up to
 * the shared 200 ceiling). If the RPC read fails (network issue, contract not
 * yet deployed, etc.), falls back to the env override / default value
 * un-narrowed, still bounded by BATCH_SIZE_CEILING.
 */
async function resolveBatchSize(): Promise<number> {
  let effective =
    ENV_BATCH_SIZE && ENV_BATCH_SIZE > 0 ? ENV_BATCH_SIZE : DEFAULT_BATCH_SIZE;

  try {
    const onChainMax = await getMaxBatchSize();
    if (onChainMax > 0) {
      effective = Math.min(effective, onChainMax);
    }
  } catch (err) {
    log(
      DRY_RUN,
      `WARNING: could not read on-chain get_max_batch_size (${err instanceof Error ? err.message : err}); ` +
        `using ${effective} as the clamp`
    );
  }

  return Math.min(BATCH_SIZE_CEILING, Math.max(1, effective));
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
  candidates: CandidateRecord[];
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

  // Fetch amounts for users that would be charged (for volume estimation).
  // The variants array is index-aligned with the users array.
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
  candidates: CandidateRecord[];
  txHash?: string;
  errors: string[];
}

/**
 * Build, sign, and submit a real batch_charge transaction.
 * Returns the preview results from simulation (before submission).
 * The variants array returned by decodeEnumVec is index-aligned with the users
 * array passed to batch_charge — the contract guarantees one result per input.
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
    .addOperation(contract.call("batch_charge", usersVec))
    .setTimeout(30)
    .build();

  // Simulate to get fee estimation and preview results
  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) throw new Error(simResult.error);

  const retval = (simResult as { result?: { retval?: xdr.ScVal } }).result?.retval;
  const previewResults = retval ? decodeEnumVec(retval) : users.map(() => "Unknown");

  // Pre-fetch amounts for charging users (preview).
  // previewResults is index-aligned with users.
  const amounts: bigint[] = [];
  for (let i = 0; i < Math.min(previewResults.length, users.length); i++) {
    if (previewResults[i] === "Charged") {
      const amt = await getSubscriptionAmount(users[i]);
      amounts.push(amt ?? 0n);
    }
  }

  // Assemble transaction with simulation results
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
    candidates: [],
    errors: [],
  };

  if (users.length === 0) return result;

  const { results, amounts } = await simulateBatchCharge(users);

  // results is index-aligned with users (same order, one entry per input).
  let amountIdx = 0;
  for (let i = 0; i < results.length; i++) {
    const variant = results[i];
    const user = i < users.length ? users[i] : "unknown";

    if (variant === "Charged") {
      const amt = amountIdx < amounts.length ? amounts[amountIdx] : 0n;
      result.wouldCharge++;
      result.totalVolume += amt;
      result.candidates.push({ user, result: variant, amountStroops: amt.toString() });
      amountIdx++;
    } else {
      result.skipCounts[variant] = (result.skipCounts[variant] || 0) + 1;
      result.candidates.push({ user, result: variant, amountStroops: "0" });
    }
  }

  return result;
}

async function processPageLive(users: string[], pageOffset: number): Promise<LivePageResult> {
  const result: LivePageResult = {
    charged: 0,
    totalVolume: 0n,
    skipCounts: {},
    candidates: [],
    errors: [],
  };

  if (users.length === 0) return result;

  try {
    const { results, amounts, txHash } = await submitBatchCharge(users);
    result.txHash = txHash;

    // results is index-aligned with users.
    let amountIdx = 0;
    for (let i = 0; i < results.length; i++) {
      const variant = results[i];
      const user = i < users.length ? users[i] : "unknown";

      if (variant === "Charged") {
        const amt = amountIdx < amounts.length ? amounts[amountIdx] : 0n;
        result.charged++;
        result.totalVolume += amt;
        result.candidates.push({ user, result: variant, amountStroops: amt.toString() });
        amountIdx++;
      } else {
        result.skipCounts[variant] = (result.skipCounts[variant] || 0) + 1;
        result.candidates.push({ user, result: variant, amountStroops: "0" });
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
  candidates: CandidateRecord[];
  errors: string[];
  txHashes: string[];
  /** Grace-period lapse metrics: charged vs lapsed by ordering rationale. */
  graceMetrics: {
    urgentCharged: number;
    urgentLapsed: number;
    normalCharged: number;
    normalLapsed: number;
  };
}

async function runCycle(): Promise<CycleReport> {
  const isDryRun = DRY_RUN;
  const report: CycleReport = {
    totalChecked: 0,
    totalCharged: 0,
    totalVolume: 0n,
    totalSkips: {},
    candidates: [],
    errors: [],
    txHashes: [],
    graceMetrics: {
      urgentCharged: 0,
      urgentLapsed: 0,
      normalCharged: 0,
      normalLapsed: 0,
    },
  };

  const paused = await isContractPaused();
  if (paused) {
    log(isDryRun, "Contract is PAUSED — skipping charge cycle");
    return report;
  }

  if (USE_LEGACY_PAGING) {
    log(isDryRun, "Using LEGACY sequential paging (KEEPER_USE_LEGACY_PAGING=true)");
    await runCycleLegacy(report, isDryRun);
  } else {
    log(isDryRun, "Using OPTIMIZED grace-urgency ordering (default)");
    await runCycleOptimized(report, isDryRun);
  }

  const skipDetails = Object.entries(report.totalSkips)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");

  const summary = isDryRun
    ? `Cycle complete: checked=${report.totalChecked} wouldCharge=${report.totalCharged} totalVolume=${stroopsToXlm(report.totalVolume)} XLM`
    : `Cycle complete: charged=${report.totalCharged} totalVolume=${stroopsToXlm(report.totalVolume)} XLM${skipDetails ? ` | ${skipDetails}` : ""}`;

  log(isDryRun, summary);

  // Log lapsed-vs-charged grace metrics
  const gm = report.graceMetrics;
  const totalLapsed = gm.urgentLapsed + gm.normalLapsed;
  const totalUrgent = gm.urgentCharged + gm.urgentLapsed;
  if (totalLapsed > 0 || totalUrgent > 0) {
    log(
      isDryRun,
      `Grace metrics: urgentCharged=${gm.urgentCharged} urgentLapsed=${gm.urgentLapsed} normalCharged=${gm.normalCharged} normalLapsed=${gm.normalLapsed}`
    );
  }

  if (report.errors.length > 0) {
    for (const err of report.errors) log(isDryRun, `Error: ${err}`);
  }

  // ── Post-cycle reporting ───────────────────────────────────────────────────

  if (!isDryRun) {
    writeLatestLive(report);
  } else {
    writeDryRunReport(report, USE_LEGACY_PAGING);
  }

  return report;
}

// ── Cycle Executors ─────────────────────────────────────────────────────────

/**
 * Run a charge cycle using the optimized grace-urgency batch ordering.
 * Subscribers closest to grace-period expiry are charged first, reducing
 * grace lapses caused by unordered sequential paging.
 */
async function runCycleOptimized(report: CycleReport, isDryRun: boolean): Promise<void> {
  // Ensure optimizer sees the same contract/RPC configuration as this keeper.
  process.env.CONTRACT_ID = CONTRACT_ID;
  process.env.RPC_URL = RPC_URL;
  process.env.NETWORK_PASSPHRASE = NETWORK_PASSPHRASE;

  const optimized = await buildOptimizedBatches();
  report.totalChecked = optimized.ready_count + optimized.deferred_count;

  log(
    isDryRun,
    `Optimizer: grace_period=${optimized.grace_period}s max_batch_size=${optimized.max_batch_size} ready=${optimized.ready_count} deferred=${optimized.deferred_count} batches=${optimized.batches.length}`
  );

  // Debug-level: log per-subscriber ordering rationale
  if (optimized.batches.length > 0) {
    const allUsers = optimized.batches.flatMap((b) => b.users);
    log(
      isDryRun,
      `Ordering rationale: ${allUsers.length} user(s) in ${optimized.batches.length} batch(es) — grace-expiry-urgent users are in earlier batches`
    );
  }

  if (optimized.batches.length === 0) {
    log(
      isDryRun,
      `No ready subscribers (ready=${optimized.ready_count} deferred=${optimized.deferred_count})`
    );
    if (!isDryRun) {
      writeLatestLive(report);
    }
    return;
  }

  for (const batch of optimized.batches) {
    const users = batch.users;
    const offset = batch.batch;

    if (isDryRun) {
      const pageResult = await processPageDryRun(users, offset);
      report.totalCharged += pageResult.wouldCharge;
      report.totalVolume += pageResult.totalVolume;
      report.candidates.push(...pageResult.candidates);
      report.errors.push(...pageResult.errors);

      // Track grace metrics for optimized path
      for (const c of pageResult.candidates) {
        if (c.result === "Charged") {
          report.graceMetrics.normalCharged++;
        } else if (c.result === "GracePeriodElapsed") {
          report.graceMetrics.normalLapsed++;
        }
      }

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
      report.candidates.push(...pageResult.candidates);

      // Track grace metrics for optimized path
      for (const c of pageResult.candidates) {
        if (c.result === "Charged") {
          report.graceMetrics.normalCharged++;
        } else if (c.result === "GracePeriodElapsed") {
          report.graceMetrics.normalLapsed++;
        }
      }

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
}

/**
 * Run a charge cycle using legacy sequential offset-based paging.
 * Pages through the subscriber index in insertion order (no urgency sorting).
 * This is the pre-optimized path — kept as a fallback via
 * KEEPER_USE_LEGACY_PAGING=true for A/B comparison.
 */
async function runCycleLegacy(report: CycleReport, isDryRun: boolean): Promise<void> {
  const contract = new Contract(CONTRACT_ID);
  let totalSubscribers = 0;
  try {
    totalSubscribers = await getSubscriberCount();
  } catch (err) {
    log(isDryRun, `Failed to get subscriber count: ${err}`);
    report.errors.push(`getSubscriberCount failed: ${err}`);
    return;
  }

  report.totalChecked = totalSubscribers;

  if (totalSubscribers === 0) {
    log(isDryRun, "No subscribers found");
    if (!isDryRun) writeLatestLive(report);
    return;
  }

  log(isDryRun, `Legacy paging: ${totalSubscribers} subscriber(s), batch_size=${BATCH_SIZE}`);

  let offset = 0;
  while (offset < totalSubscribers) {
    const users = await getSubscriberPage(offset, BATCH_SIZE);
    if (users.length === 0) break;

    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;

    if (isDryRun) {
      const pageResult = await processPageDryRun(users, batchNum);
      report.totalCharged += pageResult.wouldCharge;
      report.totalVolume += pageResult.totalVolume;
      report.candidates.push(...pageResult.candidates);
      report.errors.push(...pageResult.errors);

      // Track grace metrics for legacy path (urgent bucket = none in legacy)
      for (const c of pageResult.candidates) {
        if (c.result === "Charged") {
          report.graceMetrics.normalCharged++;
        } else if (c.result === "GracePeriodElapsed") {
          report.graceMetrics.normalLapsed++;
        }
      }

      const skipDetails = Object.entries(pageResult.skipCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");

      log(
        true,
        `Page ${batchNum} (offset=${offset}): checked=${pageResult.checked} wouldCharge=${pageResult.wouldCharge} volume=${stroopsToXlm(pageResult.totalVolume)} XLM`
      );
      if (skipDetails) log(true, `  ${skipDetails}`);
    } else {
      const pageResult = await processPageLive(users, batchNum);
      report.totalCharged += pageResult.charged;
      report.totalVolume += pageResult.totalVolume;
      report.candidates.push(...pageResult.candidates);

      // Track grace metrics for legacy path
      for (const c of pageResult.candidates) {
        if (c.result === "Charged") {
          report.graceMetrics.normalCharged++;
        } else if (c.result === "GracePeriodElapsed") {
          report.graceMetrics.normalLapsed++;
        }
      }

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
        `Page ${batchNum} (offset=${offset}): charged=${pageResult.charged} volume=${stroopsToXlm(pageResult.totalVolume)} XLM${pageResult.txHash ? ` tx=${pageResult.txHash}` : ""}`
      );
      if (skipDetails) log(false, `  ${skipDetails}`);
    }

    offset += BATCH_SIZE;
  }
}

// ── Report Writers ────────────────────────────────────────────────────────────

/**
 * Overwrite REPORT_DIR/keeper-latest-live.json with a compact summary of the
 * just-completed live cycle. This is the "pointer" used by dry-run comparison.
 */
function writeLatestLive(report: CycleReport): void {
  const totalSkips = Object.values(report.totalSkips).reduce((a, b) => a + b, 0);
  const record: LatestLiveRecord = {
    timestamp: new Date().toISOString(),
    contractId: CONTRACT_ID,
    totalChecked: report.totalChecked,
    totalCharged: report.totalCharged,
    totalVolume: report.totalVolume.toString(),
    totalSkips,
  };
  const dest = path.join(REPORT_DIR, "keeper-latest-live.json");
  writeJsonFile(dest, record);
  log(false, `Live cycle pointer written to ${dest}`);
}

/**
 * Build and write a timestamped dry-run report to REPORT_DIR.
 * Reads keeper-latest-live.json if available and computes a comparison delta.
 */
function writeDryRunReport(report: CycleReport, useLegacyPaging: boolean): void {
  const timestamp = new Date().toISOString();
  const safeTs = timestamp.replace(/:/g, "-");

  // Tally skip counts broken down by ChargeResult variant name.
  const skipCounts: Record<string, number> = {};
  for (const c of report.candidates) {
    if (c.result !== "Charged") {
      skipCounts[c.result] = (skipCounts[c.result] || 0) + 1;
    }
  }

  // Try to load the last live cycle pointer.
  const pointerPath = path.join(REPORT_DIR, "keeper-latest-live.json");
  const lastLive = readJsonFile<LatestLiveRecord>(pointerPath);

  let comparison: DryRunReport["comparison"] = null;
  if (lastLive !== null) {
    const ageMs = Date.now() - new Date(lastLive.timestamp).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageHuman =
      ageHours < 24
        ? `${ageHours.toFixed(1)} hours`
        : `${(ageHours / 24).toFixed(1)} days`;

    comparison = {
      checkedDelta: report.totalChecked - lastLive.totalChecked,
      chargedDelta: report.totalCharged - lastLive.totalCharged,
      volumeDelta: (report.totalVolume - BigInt(lastLive.totalVolume)).toString(),
      lastLiveAgeMs: ageMs,
      lastLiveAgeHuman: ageHuman,
    };
  }

  const dryRunReport: DryRunReport = {
    timestamp,
    mode: "dry-run",
    contractId: CONTRACT_ID,
    rpcUrl: RPC_URL,
    pagingMode: useLegacyPaging ? "legacy" : "optimized",
    estimatedOutcomes: {
      totalChecked: report.totalChecked,
      totalCharged: report.totalCharged,
      totalVolumeStroops: report.totalVolume.toString(),
      skipCounts,
    },
    graceMetrics: { ...report.graceMetrics },
    candidates: report.candidates,
    lastLiveCycle: lastLive ?? null,
    comparison,
    errors: report.errors,
  };

  const filename = `keeper-dryrun-report-${safeTs}.json`;
  const dest = path.join(REPORT_DIR, filename);
  writeJsonFile(dest, dryRunReport);
  log(true, `Dry-run report written to ${dest}`);
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

  BATCH_SIZE = await resolveBatchSize();
  log(DRY_RUN, `Effective legacy page size (BATCH_SIZE): ${BATCH_SIZE}`);

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
