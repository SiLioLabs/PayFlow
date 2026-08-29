#!/usr/bin/env tsx
/**
 * batch-optimizer.ts — Build optimally-sized `batch_charge` batches for FlowPay.
 *
 * Identifies ready-to-charge subscribers (via `is_charge_due` / local simulation),
 * prioritizes users nearest grace-period expiry, then those furthest past due,
 * and chunks them into `MAX_BATCH_SIZE` groups for the keeper.
 *
 * Usage:
 *   CONTRACT_ID=C... npx tsx scripts/batch-optimizer.ts
 *   CONTRACT_ID=C... npx tsx scripts/batch-optimizer.ts --max-batches 3 --json
 *
 * Environment:
 *   CONTRACT_ID          Required. Deployed FlowPay contract ID
 *   RPC_URL              Optional. Soroban RPC (default: testnet)
 *   NETWORK_PASSPHRASE   Optional. Network passphrase
 *   MAX_BATCH_SIZE       Optional. Override on-chain max (default: query contract / 50)
 *   MAX_CYCLE_USERS      Optional. Max ready users to schedule this cycle (rest deferred)
 *   PAGE_SIZE            Optional. Subscriber page size when listing (default: 50, max 50)
 *
 * Output (JSON):
 *   [{ "batch": 1, "users": ["G..."], "estimated_success_count": N }, ...]
 */

import {
  Contract,
  Networks,
  TransactionBuilder,
  Account,
  BASE_FEE,
  Address,
  nativeToScVal,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Config ───────────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.RPC_URL ?? process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? process.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const ENV_MAX_BATCH = process.env.MAX_BATCH_SIZE
  ? Number.parseInt(process.env.MAX_BATCH_SIZE, 10)
  : undefined;
const MAX_CYCLE_USERS = process.env.MAX_CYCLE_USERS
  ? Number.parseInt(process.env.MAX_CYCLE_USERS, 10)
  : Number.POSITIVE_INFINITY;
const PAGE_SIZE = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.PAGE_SIZE ?? "50", 10) || 50)
);

const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const DEFAULT_MAX_BATCH = 50;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReadySubscriber {
  address: string;
  next_charge_at: number;
  overdue_seconds: number;
  grace_remaining_seconds: number | null;
  approaching_grace_expiry: boolean;
}

export interface OptimizedBatch {
  batch: number;
  users: string[];
  estimated_success_count: number;
}

export interface OptimizerResult {
  batches: OptimizedBatch[];
  ready_count: number;
  deferred_count: number;
  deferred_users: string[];
  max_batch_size: number;
  grace_period: number;
}

interface SubscriptionFields {
  active: boolean;
  paused: boolean;
  last_charged: number;
  interval: number;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function showHelp(): never {
  console.log(`
Usage: tsx scripts/batch-optimizer.ts [options]

Options:
  --max-batches <n>   Limit how many batches to emit this cycle (remainder deferred)
  --json              Print full OptimizerResult JSON (default: batches array only)
  --help, -h          Show this help

Environment:
  CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE, MAX_BATCH_SIZE, MAX_CYCLE_USERS, PAGE_SIZE
`);
  process.exit(0);
}

// ── Contract helpers ─────────────────────────────────────────────────────────

const server = new Server(RPC_URL);

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function simulate(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result) {
    throw new Error(`${method}: ${String((result as { error?: unknown }).error ?? "simulation failed")}`);
  }
  const success = result as { result?: { retval?: xdr.ScVal } };
  return success.result?.retval ?? null;
}

async function getU32(method: string): Promise<number> {
  const val = await simulate(method);
  if (!val) return 0;
  return Number(scValToNative(val));
}

async function getU64(method: string): Promise<number> {
  const val = await simulate(method);
  if (!val) return 0;
  return Number(scValToNative(val));
}

async function getSubscriberPage(offset: number, limit: number): Promise<string[]> {
  const retval = await simulate(
    "get_subscriber_page",
    nativeToScVal(offset, { type: "u64" }),
    nativeToScVal(limit, { type: "u32" })
  );
  if (!retval) return [];
  const native = scValToNative(retval) as unknown;
  if (!Array.isArray(native)) return [];
  return native.map((a) => String(a));
}

async function isChargeDue(user: string): Promise<boolean> {
  const retval = await simulate("is_charge_due", addressVal(user));
  if (!retval) return false;
  return Boolean(scValToNative(retval));
}

async function getSubscription(user: string): Promise<SubscriptionFields | null> {
  const retval = await simulate("get_subscription", addressVal(user));
  if (!retval || retval.switch().name === "scvVoid") return null;
  const native = scValToNative(retval) as Record<string, unknown> | null;
  if (!native || typeof native !== "object") return null;
  return {
    active: Boolean(native.active),
    paused: Boolean(native.paused),
    last_charged: Number(native.last_charged ?? 0),
    interval: Number(native.interval ?? 0),
  };
}

/**
 * Simulate get_next_charge_batch by paging the subscriber index and filtering
 * with is_charge_due (contract has no dedicated get_next_charge_batch entrypoint).
 */
export async function getNextChargeBatchSimulation(
  nowSeconds: number,
  gracePeriod: number
): Promise<ReadySubscriber[]> {
  const count = await getU64("get_subscriber_count");
  const ready: ReadySubscriber[] = [];

  for (let offset = 0; offset < count; offset += PAGE_SIZE) {
    const page = await getSubscriberPage(offset, PAGE_SIZE);
    if (page.length === 0) break;

    for (const address of page) {
      let due = false;
      try {
        due = await isChargeDue(address);
      } catch (err) {
        console.warn(
          `Skipping ${address}: is_charge_due failed (${err instanceof Error ? err.message : err})`
        );
        continue;
      }
      if (!due) continue;

      const sub = await getSubscription(address);
      if (!sub || !sub.active || sub.paused || sub.interval <= 0) continue;

      const nextChargeAt = sub.last_charged + sub.interval;
      const overdue = Math.max(0, nowSeconds - nextChargeAt);
      let graceRemaining: number | null = null;
      let approaching = false;
      if (gracePeriod > 0) {
        const graceEnd = nextChargeAt + gracePeriod;
        graceRemaining = Math.max(0, graceEnd - nowSeconds);
        // Treat the final 25% of the grace window as urgent.
        approaching = graceRemaining <= gracePeriod * 0.25;
      }

      ready.push({
        address,
        next_charge_at: nextChargeAt,
        overdue_seconds: overdue,
        grace_remaining_seconds: graceRemaining,
        approaching_grace_expiry: approaching,
      });
    }
  }

  return ready;
}

/**
 * Sort ready subscribers: grace-expiry urgency first, then most overdue first.
 */
export function prioritizeReady(ready: ReadySubscriber[]): ReadySubscriber[] {
  return [...ready].sort((a, b) => {
    if (a.approaching_grace_expiry !== b.approaching_grace_expiry) {
      return a.approaching_grace_expiry ? -1 : 1;
    }
    if (a.approaching_grace_expiry && b.approaching_grace_expiry) {
      const ar = a.grace_remaining_seconds ?? Number.POSITIVE_INFINITY;
      const br = b.grace_remaining_seconds ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
    }
    if (a.overdue_seconds !== b.overdue_seconds) {
      return b.overdue_seconds - a.overdue_seconds;
    }
    return a.address.localeCompare(b.address);
  });
}

export function chunkBatches(
  ordered: ReadySubscriber[],
  maxBatchSize: number,
  maxCycleUsers: number
): { batches: OptimizedBatch[]; deferred: ReadySubscriber[] } {
  const size = Math.max(1, maxBatchSize);
  const scheduled = ordered.slice(0, maxCycleUsers);
  const deferred = ordered.slice(maxCycleUsers);
  const batches: OptimizedBatch[] = [];

  for (let i = 0; i < scheduled.length; i += size) {
    const slice = scheduled.slice(i, i + size);
    batches.push({
      batch: batches.length + 1,
      users: slice.map((s) => s.address),
      estimated_success_count: slice.length,
    });
  }

  return { batches, deferred };
}

export async function buildOptimizedBatches(options?: {
  maxBatches?: number;
  nowSeconds?: number;
}): Promise<OptimizerResult> {
  if (!CONTRACT_ID) {
    throw new Error("CONTRACT_ID environment variable is required");
  }

  let maxBatchSize = ENV_MAX_BATCH && ENV_MAX_BATCH > 0 ? ENV_MAX_BATCH : DEFAULT_MAX_BATCH;
  try {
    const onChain = await getU32("get_max_batch_size");
    if (!ENV_MAX_BATCH && onChain > 0) maxBatchSize = onChain;
  } catch {
    // Fall back to env / default when RPC read fails.
  }
  maxBatchSize = Math.min(200, Math.max(1, maxBatchSize));

  let gracePeriod = 0;
  try {
    gracePeriod = await getU64("get_grace_period");
  } catch {
    gracePeriod = 0;
  }

  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ready = await getNextChargeBatchSimulation(nowSeconds, gracePeriod);
  const ordered = prioritizeReady(ready);

  let maxCycle = MAX_CYCLE_USERS;
  if (options?.maxBatches !== undefined && options.maxBatches >= 0) {
    maxCycle = Math.min(maxCycle, options.maxBatches * maxBatchSize);
  }

  const { batches, deferred } = chunkBatches(ordered, maxBatchSize, maxCycle);

  if (deferred.length > 0) {
    console.warn(
      `Deferred ${deferred.length} ready subscriber(s) to the next cycle (cycle cap ${maxCycle}).`
    );
  }

  if (batches.length === 0) {
    console.log("No ready-to-charge subscribers found; returning empty batch list.");
  }

  return {
    batches,
    ready_count: ready.length,
    deferred_count: deferred.length,
    deferred_users: deferred.map((d) => d.address),
    max_batch_size: maxBatchSize,
    grace_period: gracePeriod,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
  }

  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    showHelp();
  }

  const maxBatchesArg = getArg("--max-batches");
  const maxBatches = maxBatchesArg ? Number.parseInt(maxBatchesArg, 10) : undefined;
  if (maxBatchesArg && (!maxBatches || maxBatches < 0 || Number.isNaN(maxBatches))) {
    console.error("--max-batches must be a non-negative integer");
    process.exit(1);
  }

  const fullJson = process.argv.includes("--json");
  const result = await buildOptimizedBatches({ maxBatches });

  if (fullJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify(result.batches, null, 2));
  }
}

const isDirectRun =
  process.argv[1]?.endsWith("batch-optimizer.ts") ||
  process.argv[1]?.endsWith("batch-optimizer.js");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
