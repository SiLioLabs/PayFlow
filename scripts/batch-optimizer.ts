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
import { MultiEndpointServer } from "./rpc-client.js";
import { Server } from "@stellar/stellar-sdk/rpc";
import { fileURLToPath } from "node:url";

// ── Config ───────────────────────────────────────────────────────────────────

const CONTRACT_ID =
  process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ??
  process.env.VITE_NETWORK_PASSPHRASE ??
  Networks.TESTNET;
const ENV_MAX_BATCH = process.env.MAX_BATCH_SIZE
  ? Number.parseInt(process.env.MAX_BATCH_SIZE, 10)
  : undefined;
const MAX_CYCLE_USERS = process.env.MAX_CYCLE_USERS
  ? Number.parseInt(process.env.MAX_CYCLE_USERS, 10)
  : Number.POSITIVE_INFINITY;
const PAGE_SIZE = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.PAGE_SIZE ?? "50", 10) || 50),
);

const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

/**
 * Default number of subscribers per `batch_charge` call.
 * Mirrors the contract's `DEFAULT_BATCH_SIZE` (contract/src/caps.rs).
 */
export const DEFAULT_MAX_BATCH = 50;

/**
 * Hard ceiling for a batch size. Mirrors the contract's
 * `MAX_BATCH_SIZE_CEILING` (contract/src/caps.rs) — no configured batch limit
 * may exceed it.
 */
export const MAX_BATCH_SIZE_CEILING = 200;

/**
 * Fraction of the grace window that counts as "approaching expiry".
 * A subscription inside the final 25% of its grace window is charged first.
 */
export const GRACE_URGENCY_FRACTION = 0.25;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReadySubscriber {
  address: string;
  next_charge_at: number;
  overdue_seconds: number;
  grace_remaining_seconds: number | null;
  approaching_grace_expiry: boolean;
  urgency_score?: number;
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
  --urgency-file <f>  Path to urgency JSON from monitor (use "-" for stdin)
  --json              Print full OptimizerResult JSON (default: batches array only)
  --help, -h          Show this help

Environment:
  CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE, MAX_BATCH_SIZE, MAX_CYCLE_USERS, PAGE_SIZE
`);
  process.exit(0);
}

// ── Contract helpers ─────────────────────────────────────────────────────────

const server = new MultiEndpointServer();

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function simulate(
  method: string,
  ...args: xdr.ScVal[]
): Promise<xdr.ScVal | null> {
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
    throw new Error(
      `${method}: ${String((result as { error?: unknown }).error ?? "simulation failed")}`,
    );
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

async function getSubscriberPage(
  offset: number,
  limit: number,
): Promise<string[]> {
  const retval = await simulate(
    "get_subscriber_page",
    nativeToScVal(offset, { type: "u64" }),
    nativeToScVal(limit, { type: "u32" }),
  );
  if (!retval) return [];
  const native = scValToNative(retval) as unknown;
  if (!Array.isArray(native)) return [];
  return native.map((a) => String(a));
}

export async function isChargeDue(user: string): Promise<boolean> {
  const retval = await simulate("is_charge_due", addressVal(user));
  if (!retval) return false;
  return Boolean(scValToNative(retval));
}

async function getSubscription(
  user: string,
): Promise<SubscriptionFields | null> {
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
 * Clamp a batch size to the range the contract accepts: at least 1, and never
 * more than `MAX_BATCH_SIZE_CEILING`.
 */
export function clampMaxBatchSize(value: number): number {
  return Math.min(MAX_BATCH_SIZE_CEILING, Math.max(1, value));
}

/**
 * Resolve the effective batch size.
 *
 * An explicit `MAX_BATCH_SIZE` environment override always wins. Without one,
 * the on-chain `get_max_batch_size()` value is used, falling back to
 * `DEFAULT_MAX_BATCH` when it cannot be read. The result is always clamped to
 * the contract's ceiling.
 */
export function resolveMaxBatchSize(
  envMaxBatch: number | undefined,
  onChainMax: number | undefined,
): number {
  let size =
    envMaxBatch && envMaxBatch > 0 ? envMaxBatch : DEFAULT_MAX_BATCH;
  if (!envMaxBatch && onChainMax && onChainMax > 0) {
    size = onChainMax;
  }
  return clampMaxBatchSize(size);
}

/**
 * Grace-window state for a subscription that is due.
 *
 * `approaching_grace_expiry` is true when the remaining grace window is
 * inside the final `GRACE_URGENCY_FRACTION` (25%) of the window — those
 * subscribers are charged first so their grace period does not lapse.
 */
export function computeGraceState(
  nextChargeAt: number,
  nowSeconds: number,
  gracePeriod: number,
): { grace_remaining_seconds: number | null; approaching_grace_expiry: boolean } {
  if (gracePeriod <= 0) {
    return { grace_remaining_seconds: null, approaching_grace_expiry: false };
  }
  const graceEnd = nextChargeAt + gracePeriod;
  const graceRemaining = Math.max(0, graceEnd - nowSeconds);
  return {
    grace_remaining_seconds: graceRemaining,
    approaching_grace_expiry: graceRemaining <= gracePeriod * GRACE_URGENCY_FRACTION,
  };
}

/**
 * Whether a subscription may be charged at all.
 *
 * A missing subscription, an inactive (cancelled) one, a paused one, or one
 * with a non-positive interval is never chargeable.
 */
export function isChargeableSubscription(
  sub: SubscriptionFields | null,
): boolean {
  if (!sub) return false;
  return sub.active && !sub.paused && sub.interval > 0;
}

/**
 * Build the `ReadySubscriber` record for a due, chargeable subscription.
 *
 * Returns `null` for a subscription that must not be charged (see
 * {@link isChargeableSubscription}), which is the "not due" filter the
 * optimizer applies to every subscriber it reads.
 */
export function toReadySubscriber(
  address: string,
  sub: SubscriptionFields | null,
  nowSeconds: number,
  gracePeriod: number,
  urgencyScore = 0,
): ReadySubscriber | null {
  if (!isChargeableSubscription(sub)) return null;
  const s = sub as SubscriptionFields;

  const nextChargeAt = s.last_charged + s.interval;
  const overdue = Math.max(0, nowSeconds - nextChargeAt);
  const grace = computeGraceState(nextChargeAt, nowSeconds, gracePeriod);

  return {
    address,
    next_charge_at: nextChargeAt,
    overdue_seconds: overdue,
    grace_remaining_seconds: grace.grace_remaining_seconds,
    approaching_grace_expiry: grace.approaching_grace_expiry,
    urgency_score: urgencyScore,
  };
}

/**
 * Simulate get_next_charge_batch by paging the subscriber index and filtering
 * with is_charge_due (contract has no dedicated get_next_charge_batch entrypoint).
 */
export async function getNextChargeBatchSimulation(
  nowSeconds: number,
  gracePeriod: number,
  urgencyScores: Record<string, number> = {}
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
          `Skipping ${address}: is_charge_due failed (${err instanceof Error ? err.message : err})`,
        );
        continue;
      }
      if (!due) continue;

      const sub = await getSubscription(address);
      const candidate = toReadySubscriber(
        address,
        sub,
        nowSeconds,
        gracePeriod,
        urgencyScores[address] ?? 0,
      );
      if (!candidate) continue;

      ready.push(candidate);
    }
  }

  return ready;
}

/**
 * Sort ready subscribers: urgency score first, then grace-expiry urgency, then most overdue first.
 */
export function prioritizeReady(ready: ReadySubscriber[]): ReadySubscriber[] {
  return [...ready].sort((a, b) => {
    const scoreA = a.urgency_score ?? 0;
    const scoreB = b.urgency_score ?? 0;
    if (scoreA !== scoreB) {
      return scoreB - scoreA; // higher score first
    }
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
  maxCycleUsers: number,
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
  urgencyScores?: Record<string, number>;
}): Promise<OptimizerResult> {
  if (!CONTRACT_ID) {
    throw new Error("CONTRACT_ID environment variable is required");
  }

  let maxBatchSize = resolveMaxBatchSize(ENV_MAX_BATCH, undefined);
  try {
    const onChain = await getU32("get_max_batch_size");
    maxBatchSize = resolveMaxBatchSize(ENV_MAX_BATCH, onChain);
  } catch {
    // Fall back to env / default when RPC read fails.
  }

  let gracePeriod = 0;
  try {
    gracePeriod = await getU64("get_grace_period");
  } catch {
    gracePeriod = 0;
  }

  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ready = await getNextChargeBatchSimulation(nowSeconds, gracePeriod, options?.urgencyScores ?? {});
  const ordered = prioritizeReady(ready);

  let maxCycle = MAX_CYCLE_USERS;
  if (options?.maxBatches !== undefined && options.maxBatches >= 0) {
    maxCycle = Math.min(maxCycle, options.maxBatches * maxBatchSize);
  }

  const { batches, deferred } = chunkBatches(ordered, maxBatchSize, maxCycle);

  if (deferred.length > 0) {
    console.warn(
      `Deferred ${deferred.length} ready subscriber(s) to the next cycle (cycle cap ${maxCycle}).`,
    );
  }

  if (batches.length === 0) {
    console.log(
      "No ready-to-charge subscribers found; returning empty batch list.",
    );
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
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
  }

  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    showHelp();
  }

  const maxBatchesArg = getArg("--max-batches");
  const maxBatches = maxBatchesArg
    ? Number.parseInt(maxBatchesArg, 10)
    : undefined;
  if (
    maxBatchesArg &&
    (!maxBatches || maxBatches < 0 || Number.isNaN(maxBatches))
  ) {
    console.error("--max-batches must be a non-negative integer");
    process.exit(1);
  }

  let urgencyScores: Record<string, number> = {};
  const urgencyFileArg = getArg("--urgency-file");
  if (urgencyFileArg) {
    try {
      const dataStr = urgencyFileArg === "-" ? readFileSync(0, "utf-8") : readFileSync(urgencyFileArg, "utf-8");
      const data = JSON.parse(dataStr);
      if (data.scores) {
        for (const s of data.scores) {
           urgencyScores[s.subscriber] = s.urgencyScore;
        }
      }
    } catch (err) {
       console.error(`Failed to read urgency file: ${err instanceof Error ? err.message : err}`);
    }
  }

  const fullJson = process.argv.includes("--json");
  const result = await buildOptimizedBatches({ maxBatches, urgencyScores });

  if (fullJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify(result.batches, null, 2));
  }
}

// ESM entrypoint guard: only auto-run when executed directly, not when
// imported (e.g. by keeper.ts / replay-dlq.ts, which reuse buildOptimizedBatches).
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
