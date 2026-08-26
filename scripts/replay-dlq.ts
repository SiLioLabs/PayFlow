#!/usr/bin/env tsx
/**
 * replay-dlq.ts — Retry dead-letter queue entries for FlowPay keeper
 *
 * Reads dlq/failed-batches.jsonl (written by keeper.ts) line by line and
 * resubmits each failed batch_charge. Successfully replayed entries are moved
 * to dlq/replayed-batches.jsonl; permanently-failed entries are moved to
 * dlq/dead-batches.jsonl so the file shrinks on each run.
 *
 * Usage
 * ─────
 *   CONTRACT_ID=C... KEEPER_SECRET=S... tsx replay-dlq.ts [--dry-run]
 *
 * Options
 * ───────
 *   --dry-run     Print what would be retried without submitting any transactions.
 *   --help, -h    Show this help.
 *
 * Environment variables
 * ─────────────────────
 *   CONTRACT_ID          Required. Deployed FlowPay contract ID.
 *   KEEPER_SECRET        Required. Stellar secret key (S…).
 *   RPC_URL              Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE   Stellar network passphrase (default: testnet).
 *   KEEPER_MAX_RETRIES   Retry attempts per entry (default: 3).
 *   KEEPER_RETRY_BASE_MS Base delay in ms (default: 1000).
 *   DLQ_FILE             Path to the input JSONL file (default: dlq/failed-batches.jsonl).
 *   LOG_LEVEL            debug | info | warn | error (default: info).
 *
 * Exit codes
 * ──────────
 *   0 — all entries replayed (or DLQ empty, or --dry-run)
 *   1 — one or more entries could not be replayed (moved to dead-batches.jsonl)
 */

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
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const KEEPER_SECRET = process.env.KEEPER_SECRET ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ??
  Networks.TESTNET) as string;
const KEEPER_MAX_RETRIES = parseInt(process.env.KEEPER_MAX_RETRIES ?? "3", 10);
const KEEPER_RETRY_BASE_MS = parseInt(
  process.env.KEEPER_RETRY_BASE_MS ?? "1000",
  10,
);
const DLQ_FILE = resolve(process.env.DLQ_FILE ?? "dlq/failed-batches.jsonl");
const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info") as
  "debug" | "info" | "warn" | "error";

const DLQ_DIR = dirname(DLQ_FILE);
const REPLAYED_FILE = resolve(DLQ_DIR, "replayed-batches.jsonl");
const DEAD_FILE = resolve(DLQ_DIR, "dead-batches.jsonl");

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
  const entry = { ts: new Date().toISOString(), level, msg, ...(meta ?? {}) };
  (level === "error" || level === "warn"
    ? process.stderr
    : process.stdout
  ).write(JSON.stringify(entry) + "\n");
}

// ── Types (mirror DlqEntry from keeper.ts) ────────────────────────────────────

interface DlqEntry {
  timestamp: string;
  offset: number;
  limit: number;
  error: string;
  tx_xdr: string | null;
  attempts: number;
}

// ── Permanent-failure detection ───────────────────────────────────────────────

const PERMANENT_ERROR_PATTERNS: readonly string[] = [
  "NoSubscriptionFound",
  "SubscriptionInactive",
  "ContractPaused",
  "ContractPausedError",
  "Unauthorized",
];

function isPermanentError(msg: string): boolean {
  return PERMANENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

// ── Retry helper ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseMs: number,
  context: string,
): Promise<T> {
  let lastError: Error = new Error("unknown");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isPermanentError(lastError.message)) throw lastError;
      if (attempt < maxAttempts) {
        const delay = baseMs * Math.pow(2, attempt - 1);
        log("warn", `${context} attempt ${attempt}/${maxAttempts} failed`, {
          error: lastError.message,
          retry_in_ms: delay,
        });
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ── RPC helpers ───────────────────────────────────────────────────────────────

function parseChargeResults(retval: xdr.ScVal): {
  charged: number;
  skipped: number;
} {
  let charged = 0;
  let skipped = 0;
  for (const item of retval.vec() ?? []) {
    try {
      const name = item.switch().name;
      if (name === "scvVec") {
        item.vec()?.[0]?.sym()?.toString() === "Charged"
          ? charged++
          : skipped++;
      } else if (name === "scvMap") {
        item.map()?.[0]?.key()?.sym()?.toString() === "Charged"
          ? charged++
          : skipped++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { charged, skipped };
}

async function replayEntry(
  server: Server,
  contract: Contract,
  keypair: Keypair,
  entry: DlqEntry,
): Promise<{ charged: number; skipped: number }> {
  const account = await server.getAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "batch_charge",
        nativeToScVal(entry.offset, { type: "u32" }),
        nativeToScVal(entry.limit, { type: "u32" }),
      ),
    )
    .setTimeout(60)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult)
    throw new Error(`Simulation failed: ${simResult.error}`);

  const assembled = assembleTransaction(tx, simResult).build();
  assembled.sign(keypair);

  const sendResult = await server.sendTransaction(assembled);
  if (sendResult.status === "ERROR")
    throw new Error(`Transaction rejected: ${JSON.stringify(sendResult)}`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(2_000);
    const status = await server.getTransaction(sendResult.hash);
    if (status.status === "SUCCESS") {
      const retval = (status as { returnValue?: xdr.ScVal }).returnValue;
      if (!retval) return { charged: 0, skipped: 0 };
      return parseChargeResults(retval);
    }
    if (status.status === "FAILED")
      throw new Error(`Transaction failed on-chain: ${sendResult.hash}`);
  }
  throw new Error(`Transaction ${sendResult.hash} not confirmed within 30 s`);
}

// ── DLQ file helpers ──────────────────────────────────────────────────────────

function parseDlqFile(filePath: string): DlqEntry[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as DlqEntry;
      } catch {
        log("warn", `Skipping malformed DLQ line ${i + 1}`, { line });
        return null;
      }
    })
    .filter((e): e is DlqEntry => e !== null);
}

function appendToFile(filePath: string, entry: DlqEntry): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      [
        "",
        "Usage: tsx replay-dlq.ts [--dry-run]",
        "",
        "  --dry-run   Print entries that would be retried without submitting txns.",
        "  --help      Show this help.",
        "",
        "Environment variables:",
        "  CONTRACT_ID, KEEPER_SECRET, RPC_URL, NETWORK_PASSPHRASE,",
        "  KEEPER_MAX_RETRIES, KEEPER_RETRY_BASE_MS, DLQ_FILE, LOG_LEVEL",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (!CONTRACT_ID) {
    console.error("FATAL: CONTRACT_ID is required.");
    process.exit(1);
  }
  if (!KEEPER_SECRET && !dryRun) {
    console.error("FATAL: KEEPER_SECRET is required.");
    process.exit(1);
  }

  let keypair: Keypair | null = null;
  if (!dryRun) {
    try {
      keypair = Keypair.fromSecret(KEEPER_SECRET);
    } catch {
      console.error("FATAL: KEEPER_SECRET is not a valid Stellar secret key.");
      process.exit(1);
    }
  }

  const entries = parseDlqFile(DLQ_FILE);

  if (entries.length === 0) {
    log("info", "DLQ is empty — nothing to replay.", { dlq_file: DLQ_FILE });
    process.exit(0);
  }

  log("info", `Found ${entries.length} DLQ entries.`, {
    dlq_file: DLQ_FILE,
    dry_run: dryRun,
  });

  if (dryRun) {
    for (const e of entries) {
      log("info", "[dry-run] Would replay", {
        offset: e.offset,
        limit: e.limit,
        original_error: e.error,
        original_ts: e.timestamp,
      });
    }
    process.exit(0);
  }

  const server = new Server(RPC_URL);
  const contract = new Contract(CONTRACT_ID);

  let replayed = 0;
  let permanent = 0;
  let stillFailed = 0;

  // Remaining entries that were not successfully replayed.
  const remaining: DlqEntry[] = [];

  for (const entry of entries) {
    const context = `DLQ entry offset=${entry.offset}`;

    // Skip entries whose original error was permanent — they won't succeed now.
    if (isPermanentError(entry.error)) {
      log("warn", "Skipping permanent-error entry", {
        offset: entry.offset,
        error: entry.error,
      });
      appendToFile(DEAD_FILE, {
        ...entry,
        error: `[permanent] ${entry.error}`,
        timestamp: new Date().toISOString(),
      });
      permanent++;
      continue;
    }

    try {
      const result = await retryWithBackoff(
        () => replayEntry(server, contract, keypair!, entry),
        KEEPER_MAX_RETRIES,
        KEEPER_RETRY_BASE_MS,
        context,
      );

      log("info", "Entry replayed successfully", {
        offset: entry.offset,
        limit: entry.limit,
        charged: result.charged,
        skipped: result.skipped,
      });
      appendToFile(REPLAYED_FILE, {
        ...entry,
        timestamp: new Date().toISOString(),
      });
      replayed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", "Entry failed after retries — moving to dead-batches", {
        offset: entry.offset,
        error: msg,
      });
      appendToFile(DEAD_FILE, {
        ...entry,
        error: msg,
        timestamp: new Date().toISOString(),
      });
      stillFailed++;
      remaining.push(entry);
    }
  }

  // Rewrite the DLQ to contain only entries that still need attention.
  mkdirSync(DLQ_DIR, { recursive: true });
  writeFileSync(
    DLQ_FILE,
    remaining.map((e) => JSON.stringify(e)).join("\n") +
      (remaining.length ? "\n" : ""),
    "utf-8",
  );

  log("info", "Replay complete", {
    replayed,
    permanent,
    still_failed: stillFailed,
  });

  process.exit(stillFailed > 0 ? 1 : 0);
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
  process.exit(1);
});
