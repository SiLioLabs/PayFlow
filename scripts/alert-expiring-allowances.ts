#!/usr/bin/env tsx
/**
 * alert-expiring-allowances.ts
 *
 * Scans active subscriptions and alerts on any whose token allowance will
 * expire within the next LEDGERS_PER_DAY ledgers (~24 h).
 *
 * Rate-limit and retry defaults are imported from allowance-utils.ts so that
 * tuning a single constant propagates everywhere — previously each script
 * re-declared the same three values independently.
 *
 * Usage:
 *   CONTRACT_ID=C... WEBHOOK_URL=https://... tsx scripts/alert-expiring-allowances.ts \
 *     [--db <path>] [--dry-run]
 *
 * Environment:
 *   CONTRACT_ID   Required. Deployed FlowPay contract address.
 *   RPC_URL       Optional. Soroban RPC endpoint (default: testnet).
 *   WEBHOOK_URL   Optional. If set, POST a JSON alert payload to this URL.
 */

import { DatabaseSync } from "node:sqlite";
import { Server } from "@stellar/stellar-sdk/rpc";
 * alert-expiring-allowances.ts — Proactive alerting for soon-to-expire token
 * allowances.
 *
 * Checks each subscriber's token allowance expiry ledger.  Subscribers whose
 * allowance will expire within ALERT_WINDOW_LEDGERS (default 17280 ≈ 24 h at
 * ~5 s/ledger) are included in the report.  Checks run concurrently under a
 * configurable cap; transient RPC errors are retried with exponential backoff.
 *
 * Usage:
 *   tsx alert-expiring-allowances.ts [--file subscribers.txt] [--dry-run] [addr ...]
 *
 * Environment variables:
 *   CONTRACT_ID           Required. Deployed FlowPay contract ID.
 *   RPC_URL               Soroban RPC endpoint (default: testnet).
 *   NETWORK_PASSPHRASE    Network passphrase (default: testnet).
 *   ALERT_WINDOW_LEDGERS  Ledgers ahead to consider "expiring soon" (default: 17280).
 *   WEBHOOK_URL           POST the JSON report here if set.
 *   CONCURRENCY           Max simultaneous RPC calls (default: 5).
 *   MAX_RETRIES           Retry attempts per transient error (default: 3).
 *   RETRY_BASE_MS         Base backoff delay in ms (default: 300).
 *
 * Exit codes:
 *   0 — no expiring allowances found (or dry-run with none found)
 *   1 — one or more allowances expiring within the alert window
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
} from "@stellar/stellar-sdk";
import {
  LEDGERS_PER_DAY,
  DEFAULT_REQUESTS_PER_SECOND,
  DEFAULT_BURST,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  RateLimiter,
  withRetry,
  formatTokenAmount,
  isAllowanceAtRisk,
} from "./allowance-utils.js";
import { fetchWithTimeout } from "./utils/fetchWithTimeout.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env.CONTRACT_ID ?? "";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";

// Rate-limit and retry settings — imported from allowance-utils.ts.
// Previously these three values were re-declared inline in this file.
const REQUESTS_PER_SECOND = DEFAULT_REQUESTS_PER_SECOND;
const BURST = DEFAULT_BURST;
const WINDOW_MS = DEFAULT_WINDOW_MS;
const MAX_RETRIES = DEFAULT_MAX_RETRIES;
const RETRY_DELAY_MS = DEFAULT_RETRY_DELAY_MS;

/**
 * How far ahead (in ledgers) to look for expiring allowances.
 * Named constant mirrors spending_limit.rs:LEDGERS_PER_DAY and
 * is used instead of the previous bare 17280 magic number.
 */
const EXPIRY_LOOKAHEAD_LEDGERS = LEDGERS_PER_DAY; // ~24 h

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubscriptionRow {
  user_address: string;
  token_id: string;
  amount: string;
}

interface ExpiryAlert {
  user_address: string;
  token_id: string;
  subscription_amount: string;
  current_allowance: string;
  ledgers_until_expiry: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

// ── Stellar helpers ───────────────────────────────────────────────────────────

const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

/**
 * Fetches the token allowance that `owner` has granted to the FlowPay contract.
 * Uses the shared RateLimiter and withRetry from allowance-utils.ts.
 */
async function getAllowance(
  server: Server,
  owner: string,
  tokenId: string,
  limiter: RateLimiter
): Promise<bigint> {
  await limiter.throttle();
  return withRetry(async () => {
    try {
      const tokenContract = new Contract(tokenId);
      const flowPayAddress = Address.fromString(CONTRACT_ID);
      const sourceAccount = new Account(SIM_SOURCE, "0");

      const tx = new TransactionBuilder(sourceAccount, {
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  Account,
} from "@stellar/stellar-sdk";
import { MultiEndpointServer } from "./rpc-client.js";
import {
  withRetry,
  runConcurrent,
  type ExpiryEntry,
  type ExpiryAlertReport,
} from "./allowance-utils.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONTRACT_ID =
  process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE = (process.env.NETWORK_PASSPHRASE ??
  Networks.TESTNET) as string;
const ALERT_WINDOW_LEDGERS = parseInt(
  process.env.ALERT_WINDOW_LEDGERS ?? "17280",
  10,
);
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY ?? "5", 10));
const MAX_RETRIES = Math.max(0, parseInt(process.env.MAX_RETRIES ?? "3", 10));
const RETRY_BASE_MS = Math.max(
  0,
  parseInt(process.env.RETRY_BASE_MS ?? "300", 10),
);

if (!CONTRACT_ID) {
  console.error("Error: CONTRACT_ID environment variable is required.");
  console.error(
    "Usage: CONTRACT_ID=<id> tsx alert-expiring-allowances.ts [--file subs.txt] [--dry-run] [addr ...]",
  );
  process.exit(1);
}

/** Stable dummy source account for read-only simulations. */
const SIM_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const server = new MultiEndpointServer();
const FlowPayAddress = Address.fromString(CONTRACT_ID);

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw subscription fields returned by the contract's get_subscription. */
interface Subscription {
  merchant: string;
  amount: bigint;
  token: string;
  active: boolean;
  paused: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function readAddressesFromFile(filePath: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(filePath, "utf-8");
    return content
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    console.error(`Error reading file "${filePath}": ${err}`);
    process.exit(1);
  }
}

function showHelp(): never {
  console.log(`
Usage: tsx alert-expiring-allowances.ts [options] [addresses...]

Options:
  --file <path>   Read subscriber addresses from a file (one per line, # comments allowed)
  --dry-run       Print the report without sending the webhook
  --help, -h      Show this help

Environment variables:
  CONTRACT_ID           Required. Deployed FlowPay contract ID
  RPC_URL               Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
  NETWORK_PASSPHRASE    Network passphrase (default: Test SDF Network ; September 2015)
  ALERT_WINDOW_LEDGERS  Ledgers ahead to flag as expiring (default: 17280 ≈ 24 h)
  WEBHOOK_URL           If set, POST the JSON report to this URL
  CONCURRENCY           Max simultaneous RPC calls (default: 5)
  MAX_RETRIES           Retry attempts per transient error (default: 3)
  RETRY_BASE_MS         Base backoff delay in ms (default: 300)

Exit codes:
  0  No allowances expiring within the alert window
  1  One or more allowances expiring soon

Examples:
  CONTRACT_ID=CD123... tsx alert-expiring-allowances.ts GXYZ... GABC...
  CONTRACT_ID=CD123... tsx alert-expiring-allowances.ts --file subscribers.txt
  CONTRACT_ID=CD123... WEBHOOK_URL=https://hooks.example.com/payflow \\
    tsx alert-expiring-allowances.ts --file subscribers.txt
  CONTRACT_ID=CD123... tsx alert-expiring-allowances.ts --dry-run --file subscribers.txt
  `);
  process.exit(0);
}

// ── Contract Reads ────────────────────────────────────────────────────────────

/**
 * Fetches the subscription record for `user` from the FlowPay contract.
 * Retries on transient RPC failures. Returns null on no subscription or after
 * exhausting retries.
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
          case "merchant":
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

      if (
        fields.amount === undefined ||
        fields.token === undefined ||
        fields.merchant === undefined
      ) {
        return null;
      }

      return {
        merchant: fields.merchant as string,
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
        console.error(
          `[alert-expiring] getSubscription retry ${attempt} for ${user}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    },
  ).catch((err) => {
    console.error(
      `[alert-expiring] getSubscription failed after retries for ${user}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  });
}

/**
 * Returns the current allowance amount that the FlowPay contract is approved
 * to spend on behalf of `owner` for token `tokenId`.
 * Retries on transient RPC failures.
 */
export async function getAllowanceAmount(
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
            nativeToScVal(flowPayAddress, { type: "address" })
          )
            nativeToScVal(FlowPayAddress, { type: "address" }),
          ),
        )
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) return 0n;

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
      if (!retval || retval.switch().name === "scvVoid") return 0n;

      return BigInt(retval.i128().toString());
    } catch {
      return 0n;
    }
  }, MAX_RETRIES, RETRY_DELAY_MS);
}

/**
 * Fetches the allowance expiry ledger for `owner` → FlowPay contract.
 * Returns the ledger sequence at which the allowance expires, or null if unknown.
 */
async function getAllowanceExpiry(
  server: Server,
  owner: string,
  tokenId: string,
  limiter: RateLimiter
): Promise<number | null> {
  await limiter.throttle();
  return withRetry(async () => {
    try {
      const tokenContract = new Contract(tokenId);
      const flowPayAddress = Address.fromString(CONTRACT_ID);
      const sourceAccount = new Account(SIM_SOURCE, "0");

      // SEP-41 tokens expose an expiration_ledger on the allowance entry.
      // We read it via get_allowance which returns { amount, expiration_ledger }.
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          tokenContract.call(
            "get_allowance",
            addressVal(owner),
            nativeToScVal(flowPayAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build();

      const result = await server.simulateTransaction(tx);
      if ("error" in result) return null;

      const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
      if (!retval || retval.switch().name === "scvVoid") return null;

      // Extract expiration_ledger from the map
      for (const entry of retval.map() ?? []) {
        if (entry.key().sym().toString() === "expiration_ledger") {
          return Number(entry.val().u32());
        }
      }
      return null;
    } catch {
      return null;
    }
  }, MAX_RETRIES, RETRY_DELAY_MS);
      const retval = (result as { result?: { retval?: xdr.ScVal } }).result
        ?.retval;
      if (!retval || retval.switch().name === "scvVoid") return 0n;

      return BigInt(retval.i128().toString());
    },
    {
      maxRetries: opts?.maxRetries ?? MAX_RETRIES,
      baseDelayMs: opts?.baseDelayMs ?? RETRY_BASE_MS,
      onRetry: (attempt, err) =>
        console.error(
          `[alert-expiring] getAllowanceAmount retry ${attempt} for ${owner}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    },
  ).catch((err) => {
    console.error(
      `[alert-expiring] getAllowanceAmount failed after retries for ${owner}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0n;
  });
}

/**
 * Builds the ledger key for the allowance entry stored in a SEP-41 / SAC token
 * contract.  The `liveUntilLedgerSeq` of this entry is the expiry ledger.
 */
function buildAllowanceLedgerKey(
  tokenId: string,
  owner: string,
  spender: string,
): xdr.LedgerKey {
  const mapKey = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("from"),
      val: addressVal(owner),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("spender"),
      val: nativeToScVal(Address.fromString(spender), { type: "address" }),
    }),
  ]);

  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(tokenId).toScAddress(),
      key: mapKey,
      durability: xdr.ContractDataDurability.temporary(),
    }),
  );
}

/**
 * Returns the `liveUntilLedgerSeq` for the allowance ledger entry, or 0 if
 * the entry doesn't exist.  Retries on transient RPC failures.
 */
export async function getAllowanceExpiryLedger(
  tokenId: string,
  owner: string,
  spender: string,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): Promise<number> {
  return withRetry(
    async () => {
      const ledgerKey = buildAllowanceLedgerKey(tokenId, owner, spender);
      const response = await server.getLedgerEntries(ledgerKey);

      if (!response.entries || response.entries.length === 0) return 0;

      const entry = response.entries[0];
      const liveUntil = (entry as { liveUntilLedgerSeq?: number })
        .liveUntilLedgerSeq;
      return typeof liveUntil === "number" ? liveUntil : 0;
    },
    {
      maxRetries: opts?.maxRetries ?? MAX_RETRIES,
      baseDelayMs: opts?.baseDelayMs ?? RETRY_BASE_MS,
      onRetry: (attempt, err) =>
        console.error(
          `[alert-expiring] getAllowanceExpiryLedger retry ${attempt} for ${owner}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    },
  ).catch((err) => {
    console.error(
      `[alert-expiring] getAllowanceExpiryLedger failed after retries for ${owner}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  });
}

// ── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Checks a single subscriber and returns an ExpiryEntry if their allowance is
 * expiring within the alert window, or null otherwise.
 *
 * Skips: invalid addresses, no active subscription, no expiry set,
 * allowances with more than ALERT_WINDOW_LEDGERS remaining.
 */
export async function checkSubscriber(
  address: string,
  currentLedger: number,
): Promise<ExpiryEntry | null> {
  try {
    Address.fromString(address);
  } catch {
    console.error(`Skipping invalid address: ${address}`);
    return null;
  }

  const sub = await getSubscription(address);
  if (!sub) return null;
  if (!sub.active || sub.paused) return null;

  const [allowanceAmount, expiresAtLedger] = await Promise.all([
    getAllowanceAmount(address, sub.token),
    getAllowanceExpiryLedger(sub.token, address, CONTRACT_ID),
  ]);

  if (expiresAtLedger === 0) return null;

  const ledgersRemaining = Math.max(0, expiresAtLedger - currentLedger);
  if (ledgersRemaining > ALERT_WINDOW_LEDGERS) return null;

  return {
    address,
    merchant: sub.merchant,
    allowance_amount: allowanceAmount.toString(),
    expires_at_ledger: expiresAtLedger,
    ledgers_remaining: ledgersRemaining,
  };
}

// ── Webhook Delivery ──────────────────────────────────────────────────────────

/**
 * POSTs the report as JSON to WEBHOOK_URL.
 * Returns true on HTTP 2xx, false otherwise. Never throws.
 */
async function sendWebhook(
  url: string,
  report: ExpiryAlertReport,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    if (response.ok) {
      console.error(`Webhook delivered successfully (HTTP ${response.status}).`);
      return true;
    }
    console.error(
      `Webhook returned non-2xx response: HTTP ${response.status} ${response.statusText}`,
    );
    return false;
  } catch (err) {
    console.error(`Webhook delivery failed: ${err}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!CONTRACT_ID) {
    console.error("Error: CONTRACT_ID environment variable is required.");
    process.exit(1);
  }

  const dbPath = getArg("--db") ?? process.env.INDEXER_DB ?? "indexer.db";
  const dryRun = process.argv.includes("--dry-run");

  // Load active subscriptions from the indexer DB
  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (err) {
    console.error(`Failed to open database at ${dbPath}: ${err}`);
    process.exit(1);
  }

  const rows = db
    .prepare(
      `SELECT user_address, token_id, amount
       FROM subscriptions
       WHERE active = 1`
    )
    .all() as unknown as SubscriptionRow[];
  db.close();

  if (rows.length === 0) {
    console.log("No active subscriptions found.");
    return;
  }

  console.log(`Checking ${rows.length} active subscription(s)…`);

  const server = new Server(RPC_URL);
  const limiter = new RateLimiter({
    requestsPerSecond: REQUESTS_PER_SECOND,
    burst: BURST,
    windowMs: WINDOW_MS,
  });

  // Fetch latest ledger sequence for lookahead comparison
  const latest = await server.getLatestLedger();
  const currentLedger = latest.sequence;

  const alerts: ExpiryAlert[] = [];

  for (const row of rows) {
    const allowance = await getAllowance(server, row.user_address, row.token_id, limiter);
    const expiryLedger = await getAllowanceExpiry(server, row.user_address, row.token_id, limiter);

    const required = BigInt(row.amount);
    const atRisk = isAllowanceAtRisk(allowance, required);
    const ledgersUntilExpiry =
      expiryLedger !== null ? expiryLedger - currentLedger : Infinity;
    const expiringSoon =
      expiryLedger !== null && ledgersUntilExpiry <= EXPIRY_LOOKAHEAD_LEDGERS;

    if (atRisk || expiringSoon) {
      alerts.push({
        user_address: row.user_address,
        token_id: row.token_id,
        subscription_amount: formatTokenAmount(required),
        current_allowance: formatTokenAmount(allowance),
        ledgers_until_expiry: expiryLedger !== null ? ledgersUntilExpiry : -1,
      });
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    current_ledger: currentLedger,
    expiry_lookahead_ledgers: EXPIRY_LOOKAHEAD_LEDGERS,
    total_alerts: alerts.length,
    alerts,
  };

  console.log(JSON.stringify(payload, null, 2));

  if (alerts.length === 0) {
    console.log("No expiring allowances detected.");
    return;
  }

  if (!dryRun && WEBHOOK_URL) {
    try {
      const resp = await fetchWithTimeout(
        WEBHOOK_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        10_000
      );
      if (resp.ok) {
        console.log(`Alert webhook delivered (HTTP ${resp.status}).`);
      } else {
        console.error(`Alert webhook responded with HTTP ${resp.status}.`);
      }
    } catch (err) {
      console.error(`Alert webhook delivery failed: ${err}`);
    }
  } else if (dryRun) {
    console.log("[dry-run] Webhook delivery skipped.");
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  const argv = process.argv.slice(2);

  const cliAddresses: string[] = [];
  let filePath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp();
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--file") {
      filePath = argv[++i];
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      showHelp();
    } else {
      cliAddresses.push(arg);
    }
  }

  if (cliAddresses.length === 0 && !filePath) showHelp();

  const allAddresses = [...cliAddresses];
  if (filePath) {
    allAddresses.push(...(await readAddressesFromFile(filePath)));
  }

  if (allAddresses.length === 0) {
    console.error("No addresses provided.");
    process.exit(1);
  }

  // Fetch the current ledger sequence once — used for all comparisons.
  let currentLedger: number;
  try {
    const ledgerInfo = await server.getLatestLedger();
    currentLedger = ledgerInfo.sequence;
  } catch (err) {
    console.error(`Failed to fetch latest ledger: ${err}`);
    process.exit(1);
  }

  console.error(
    `Checking ${allAddresses.length} subscriber(s) — concurrency=${CONCURRENCY}, maxRetries=${MAX_RETRIES}, window=${ALERT_WINDOW_LEDGERS} ledgers`,
  );

  // Run all checks concurrently under the configured cap.
  const rawResults = await runConcurrent(
    allAddresses.map(
      (addr) => () => checkSubscriber(addr, currentLedger),
    ),
    CONCURRENCY,
  );

  // Collect non-null entries; log batch-level errors but don't abort.
  const expiring: ExpiryEntry[] = [];
  for (let i = 0; i < rawResults.length; i++) {
    const r = rawResults[i];
    if (r instanceof Error) {
      console.error(
        `Unexpected error for ${allAddresses[i]}: ${r.message}`,
      );
    } else if (r !== null) {
      expiring.push(r);
    }
  }

  // Sort by urgency (fewest ledgers remaining first).
  expiring.sort((a, b) => a.ledgers_remaining - b.ledgers_remaining);

  const report: ExpiryAlertReport = {
    generated_at: new Date().toISOString(),
    contract: CONTRACT_ID,
    current_ledger: currentLedger,
    alert_window_ledgers: ALERT_WINDOW_LEDGERS,
    expiring_count: expiring.length,
    expiring,
  };

  // Always print the JSON report to stdout.
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (expiring.length === 0) {
    console.error(
      `No allowances expiring within the next ${ALERT_WINDOW_LEDGERS} ledgers.`,
    );
    process.exit(0);
  }

  console.error(
    `${expiring.length} allowance(s) expiring within ${ALERT_WINDOW_LEDGERS} ledgers.`,
  );

  if (WEBHOOK_URL && !dryRun) {
    await sendWebhook(WEBHOOK_URL, report);
  } else if (dryRun) {
    console.error("Dry-run mode: webhook not sent.");
  } else if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL not set: skipping webhook delivery.");
  }

  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(
    `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
