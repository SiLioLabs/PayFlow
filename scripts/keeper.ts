/**
 * scripts/keeper.ts — PayFlow keeper service entry point.
 *
 * The keeper calls `batch_charge(users)` on the FlowPay Soroban contract
 * on a fixed schedule.  It uses:
 *   - Adaptive fees (issue #1477): simulates the tx, applies a multiplier,
 *     and enforces a ceiling.
 *   - Secure secret loading (issue #1476): supports KEEPER_SECRET_FILE,
 *     KEEPER_SECRET, and legacy SECRET_KEY; warns on mainnet env-var use.
 *   - Prometheus metrics (issue #1479): records every outcome.
 *
 * Usage (TypeScript/ts-node):
 *   KEEPER_SECRET_FILE=/run/secrets/keeper_secret \
 *   CONTRACT_ID=C... \
 *   ts-node scripts/keeper.ts
 *
 * Or compile first:
 *   npx tsc --project scripts/tsconfig.json
 *   node scripts/dist/keeper.js
 */

import {
  Contract,
  TransactionBuilder,
  Keypair,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  BATCH_SIZE,
  POLL_INTERVAL_MS,
  loadSecret,
  loadFeeBumpSecret,
  FEE_BUMP_SOURCE,
} from "./config";
import {
  rpcServer,
  EnvSigner,
  simulateAssembleSignAndSend,
} from "./rpc-client";
import type { ISigner } from "./config";
import {
  chargesTotalCounter,
  batchDurationHistogram,
  dlqSizeGauge,
  lastRunGauge,
  heartbeatCounter,
  startMetricsServer,
} from "./metrics-server";

// ── Types ──────────────────────────────────────────────────────────────────────

type ChargeResult =
  | "Charged"
  | "Skipped"
  | "NoSubscription"
  | "Inactive"
  | "Paused"
  | "GracePeriodElapsed"
  | "Failed";

interface KeeperOptions {
  /** ISigner implementation. Defaults to EnvSigner loaded from secret. */
  signer?: ISigner;
  /**
   * Function that returns the list of subscriber addresses to attempt.
   * Override in tests or when using an off-chain index.
   */
  getSubscribers?: () => Promise<string[]>;
  /**
   * Whether to start the metrics HTTP server.  Set false in tests.
   */
  startMetrics?: boolean;
}

// ── Dead-letter queue ──────────────────────────────────────────────────────────

/** Batches that failed to send are stored here for future retry. */
const deadLetterQueue: Array<{ users: string[]; failedAt: Date; error: string }> =
  [];

function enqueueDLQ(users: string[], error: string): void {
  deadLetterQueue.push({ users, failedAt: new Date(), error });
  dlqSizeGauge.set(deadLetterQueue.length);
  console.error(
    `[PayFlow Keeper] DLQ enqueue — ${users.length} users. Error: ${error}`
  );
}

// ── Contract helpers ───────────────────────────────────────────────────────────

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/**
 * buildBatchChargeTx — builds an unsigned batch_charge transaction XDR.
 */
async function buildBatchChargeTx(
  sourcePublicKey: string,
  users: string[]
): Promise<string> {
  const account = await rpcServer.getAccount(sourcePublicKey);
  const contract = new Contract(CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "1000", // placeholder; replaced after simulation
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "batch_charge",
        nativeToScVal(users.map(addressVal)) as xdr.ScVal
      )
    )
    .setTimeout(60)
    .build();

  return tx.toXDR();
}

/**
 * parseChargeResults — decode the Vec<ChargeResult> from the simulation return value.
 * Returns a best-effort array; falls back to empty on parse failure.
 */
function parseChargeResults(retval: unknown): ChargeResult[] {
  try {
    const scVal = retval as any;
    const vecItems: any[] =
      typeof scVal?.vec === "function"
        ? scVal.vec()
        : (scVal?._value?.vec ?? []);

    if (!Array.isArray(vecItems)) return [];

    return vecItems.map((item: any): ChargeResult => {
      const name: string =
        item?.switch?.()?.name ??
        item?.name ??
        "";
      const valid: ChargeResult[] = [
        "Charged",
        "Skipped",
        "NoSubscription",
        "Inactive",
        "Paused",
        "GracePeriodElapsed",
      ];
      return (valid.includes(name as ChargeResult) ? name : "Failed") as ChargeResult;
    });
  } catch {
    return [];
  }
}

// ── Core keeper loop ───────────────────────────────────────────────────────────

/**
 * runBatch — processes one batch of subscriber addresses.
 * Builds the tx, simulates with adaptive fees, signs, and submits.
 */
async function runBatch(
  users: string[],
  signer: ISigner,
  feeBumpKeypair?: Keypair
): Promise<void> {
  if (users.length === 0) return;

  const start = Date.now();
  console.log(`[PayFlow Keeper] Processing batch of ${users.length} users…`);

  try {
    const txXdr = await buildBatchChargeTx(signer.publicKey, users);
    const result = await simulateAssembleSignAndSend(txXdr, signer, feeBumpKeypair);

    const elapsed = (Date.now() - start) / 1000;
    batchDurationHistogram.observe(elapsed);

    // Best-effort: try to decode outcomes from the tx result
    const outcomes = parseChargeResults((result as any).returnValue);
    if (outcomes.length > 0) {
      for (const outcome of outcomes) {
        chargesTotalCounter.inc({ result: outcome });
      }
    } else {
      // Fallback: credit the whole batch as "Charged"
      chargesTotalCounter.inc({ result: "Charged" }, users.length);
    }

    console.log(
      `[PayFlow Keeper] Batch sent — hash=${result.hash} ` +
        `fee=${result.feePaid} stroops ` +
        `feeBumped=${result.feeBumped} ` +
        `duration=${elapsed.toFixed(2)}s`
    );
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    batchDurationHistogram.observe(elapsed);
    chargesTotalCounter.inc({ result: "Failed" }, users.length);
    enqueueDLQ(users, (err as Error).message);
  }
}

/**
 * runKeeper — executes a single keeper cycle:
 *   1. Fetch the subscriber list.
 *   2. Split into BATCH_SIZE chunks.
 *   3. Submit each chunk with adaptive fees.
 *   4. Update metrics.
 */
async function runKeeper(
  signer: ISigner,
  getSubscribers: () => Promise<string[]>,
  feeBumpKeypair?: Keypair
): Promise<void> {
  heartbeatCounter.inc();
  lastRunGauge.set(Math.floor(Date.now() / 1000));

  let subscribers: string[];
  try {
    subscribers = await getSubscribers();
  } catch (err) {
    console.error(`[PayFlow Keeper] Failed to fetch subscribers: ${(err as Error).message}`);
    return;
  }

  if (subscribers.length === 0) {
    console.log("[PayFlow Keeper] No subscribers to process.");
    return;
  }

  console.log(`[PayFlow Keeper] ${subscribers.length} subscribers to process.`);

  // Split into batches
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);
    await runBatch(batch, signer, feeBumpKeypair);
  }
}

// ── Default subscriber source ──────────────────────────────────────────────────

/**
 * defaultGetSubscribers — fetches subscribers from on-chain events.
 * In production you'd maintain a local DB index; this is the simplest fallback.
 */
async function defaultGetSubscribers(): Promise<string[]> {
  try {
    const response = await rpcServer.getEvents({
      startLedger: undefined,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 1000,
    });

    const active = new Set<string>();
    const cancelled = new Map<string, number>();
    const subscribed = new Map<string, number>();

    for (const rawEvent of response.events) {
      const event = rawEvent as {
        topic?: unknown[];
        ledgerCloseTime?: unknown;
      };
      if (!event.topic || event.topic.length < 2) continue;
      const eventType = event.topic[0]?.toString();
      const user = event.topic[1]?.toString();
      if (!user) continue;

      const ts: number =
        typeof event.ledgerCloseTime === "number"
          ? event.ledgerCloseTime
          : 0;

      if (eventType === "subscribed") {
        const existing = subscribed.get(user) ?? 0;
        if (ts >= existing) subscribed.set(user, ts);
        active.add(user);
      } else if (eventType === "cancelled") {
        const existing = cancelled.get(user) ?? 0;
        if (ts >= existing) cancelled.set(user, ts);
      }
    }

    // Remove users who cancelled after their last subscription
    for (const [user, cancelTs] of cancelled) {
      const subTs = subscribed.get(user) ?? 0;
      if (cancelTs >= subTs) active.delete(user);
    }

    return Array.from(active);
  } catch (err) {
    console.error(`[PayFlow Keeper] getEvents failed: ${(err as Error).message}`);
    return [];
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * createKeeper — builds the keeper with the given options and returns
 * a `start()` / `stop()` handle.  Separating creation from start makes
 * the keeper trivially testable.
 */
export function createKeeper(options: KeeperOptions = {}): {
  start: () => void;
  stop: () => void;
} {
  const secret = loadSecret();
  const signer: ISigner = options.signer ?? new EnvSigner(secret);

  let feeBumpKeypair: Keypair | undefined;
  const feeBumpSecret = loadFeeBumpSecret();
  if (feeBumpSecret && FEE_BUMP_SOURCE) {
    feeBumpKeypair = Keypair.fromSecret(feeBumpSecret);
  }

  const getSubscribers = options.getSubscribers ?? defaultGetSubscribers;

  if (options.startMetrics !== false) {
    startMetricsServer();
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  const start = (): void => {
    console.log("[PayFlow Keeper] Starting…");

    // Run immediately on start, then on interval
    void runKeeper(signer, getSubscribers, feeBumpKeypair);
    timer = setInterval(
      () => void runKeeper(signer, getSubscribers, feeBumpKeypair),
      POLL_INTERVAL_MS
    );
  };

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    console.log("[PayFlow Keeper] Stopped.");
  };

  return { start, stop };
}

// ── Bootstrap when run directly ───────────────────────────────────────────────

if (require.main === module) {
  const keeper = createKeeper();
  keeper.start();

  process.on("SIGINT", () => {
    keeper.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    keeper.stop();
    process.exit(0);
  });
}
