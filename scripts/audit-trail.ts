/**
 * audit-trail.ts — Compliance-grade billing audit trail for the PayFlow protocol.
 *
 * Produces a complete, structured billing audit trail for a given ledger range
 * by fetching contract events via the Soroban RPC. Each entry includes event
 * type, subscriber, merchant, amounts (gross/fee/net), transaction hash, and
 * ledger. The full output is signed with a SHA-256 hash for tamper evidence.
 *
 * Usage:
 *   npx ts-node scripts/audit-trail.ts \
 *     --from <ledger>  --to <ledger> \
 *     [--subscriber <address>]        # filter to a single subscriber
 *     [--merchant   <address>]        # filter to a single merchant
 *     [--format markdown|csv|json]    # default: json
 *     [--out <file>]                  # write output to file instead of stdout
 *
 * Environment variables:
 *   CONTRACT_ID  — Deployed FlowPay contract ID (required)
 *   RPC_URL      — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
 *
 * Exit codes:
 *   0 — audit trail produced successfully
 *   1 — invalid arguments or RPC failure
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Server } from "@stellar/stellar-sdk/rpc";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONTRACT_ID =
  process.env.CONTRACT_ID ?? process.env.VITE_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.RPC_URL ??
  process.env.VITE_RPC_URL ??
  "https://soroban-testnet.stellar.org";

/** Events fetched per RPC call. */
const EVENTS_PER_REQUEST = 1000;
/** Ledger batch size for incremental fetching. */
const BATCH_SIZE = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

type OutputFormat = "json" | "csv" | "markdown";

interface CliArgs {
  fromLedger: number;
  toLedger: number;
  subscriber: string | null;
  merchant: string | null;
  format: OutputFormat;
  outFile: string | null;
}

/**
 * A single structured audit entry for one billing event.
 */
interface AuditEntry {
  /** Normalised event type (e.g. "charged", "subscribed", "cancelled"). */
  event_type: string;
  /** ISO-8601 timestamp derived from ledger close time. */
  timestamp: string;
  /** Subscriber address. */
  subscriber: string;
  /** Merchant address. */
  merchant: string;
  /** Gross amount in XLM stroops (string to avoid precision loss). */
  amount_stroops: string;
  /** Protocol fee in stroops. */
  fee_stroops: string;
  /** Net amount (amount - fee) in stroops. */
  net_stroops: string;
  /** Transaction hash. */
  tx_hash: string;
  /** Ledger sequence number where the event occurred. */
  ledger: number;
}

interface AuditSummary {
  total_events: number;
  total_charges: number;
  total_volume_stroops: string;
  total_fees_stroops: string;
  unique_subscribers: number;
  unique_merchants: number;
  from_ledger: number;
  to_ledger: number;
  generated_at: string;
  sha256_hash: string;
}

interface AuditReport {
  entries: AuditEntry[];
  summary: AuditSummary;
}

// ── Fee tracking: track fee_set events so we can reconstruct fee_bps per event ─

/** Simple fee config snapshot for a point in time. */
interface FeeSnapshot {
  ledger: number;
  bps: number;
}

// ── Argument Parsing ──────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function parseArgs(): CliArgs {
  const fromArg = getArg("--from");
  const toArg = getArg("--to");

  if (fromArg === undefined || toArg === undefined) {
    console.error("ERROR: Both --from and --to ledger numbers are required.");
    process.exit(1);
  }

  const fromLedger = parseInt(fromArg, 10);
  const toLedger = parseInt(toArg, 10);

  if (!Number.isInteger(fromLedger) || !Number.isInteger(toLedger)) {
    console.error("ERROR: --from and --to must be integers.");
    process.exit(1);
  }
  if (fromLedger < 0 || toLedger < 0) {
    console.error("ERROR: Ledger values must be non-negative.");
    process.exit(1);
  }
  if (toLedger < fromLedger) {
    console.error("ERROR: --to must be >= --from.");
    process.exit(1);
  }

  const formatArg = getArg("--format") as OutputFormat | undefined;
  const validFormats: OutputFormat[] = ["json", "csv", "markdown"];
  const format: OutputFormat =
    formatArg !== undefined
      ? validFormats.includes(formatArg)
        ? formatArg
        : (console.error(
            `ERROR: --format must be one of: ${validFormats.join(", ")}`,
          ),
          process.exit(1))
      : "json";

  return {
    fromLedger,
    toLedger,
    subscriber: getArg("--subscriber") ?? null,
    merchant: getArg("--merchant") ?? null,
    format,
    outFile: getArg("--out") ?? null,
  };
}

// ── RPC Fetching ──────────────────────────────────────────────────────────────

interface RawEvent {
  topic: unknown[];
  value: unknown;
  ledger: number;
  ledgerCloseTime?: number;
  txHash?: string;
  id?: string;
}

/**
 * Fetch all contract events for a ledger range via paginated RPC calls.
 * Streams events rather than buffering the full result set to handle large ranges.
 */
async function* fetchEventStream(
  server: Server,
  fromLedger: number,
  toLedger: number,
): AsyncGenerator<RawEvent> {
  for (
    let batchStart = fromLedger;
    batchStart <= toLedger;
    batchStart += BATCH_SIZE
  ) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, toLedger);

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, unknown> = {
        filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
        limit: EVENTS_PER_REQUEST,
      };
      if (cursor) {
        params.cursor = cursor;
      } else {
        params.startLedger = batchStart;
      }

      const response = await server.getEvents(
        params as Parameters<typeof server.getEvents>[0],
      );

      for (const raw of response.events) {
        const eventLedger: number = (raw as unknown as RawEvent).ledger ?? 0;
        if (eventLedger > batchEnd) {
          hasMore = false;
          break;
        }
        yield raw as unknown as RawEvent;
      }

      if (response.events.length < EVENTS_PER_REQUEST) {
        hasMore = false;
      } else if (hasMore) {
        cursor = (response as unknown as Record<string, string>).cursor;
        if (!cursor) hasMore = false;
      }
    }
  }
}

// ── Event Parsing ─────────────────────────────────────────────────────────────

/**
 * Extract the first topic string from a raw event topic array.
 */
function topicString(topic: unknown): string {
  if (topic === null || topic === undefined) return "";
  if (typeof topic === "string") return topic;
  if (typeof (topic as { toString?: () => string }).toString === "function") {
    return (topic as { toString: () => string }).toString();
  }
  return String(topic);
}

/**
 * Determine the fee_bps that was active at a given ledger by scanning the
 * fee snapshots array (sorted ascending by ledger).
 */
function feeBpsAtLedger(snapshots: FeeSnapshot[], ledger: number): number {
  let bps = 0;
  for (const snap of snapshots) {
    if (snap.ledger <= ledger) {
      bps = snap.bps;
    } else {
      break;
    }
  }
  return bps;
}

/**
 * Parse a raw RPC event into an AuditEntry, applying the fee_bps from the
 * snapshot history so that each entry accurately reflects the fee in effect
 * at the time of the event.
 *
 * Returns null for non-billing events (e.g. paused, resumed) that are
 * not included in the audit trail.
 */
function parseAuditEntry(
  raw: RawEvent,
  feeSnapshots: FeeSnapshot[],
): AuditEntry | null {
  const eventType = topicString(raw.topic[0]);
  const subscriber = topicString(raw.topic[1]);

  // Parse the event value as JSON if it is a string, otherwise use as-is
  let data: Record<string, unknown> = {};
  try {
    if (typeof raw.value === "string") {
      data = JSON.parse(raw.value) as Record<string, unknown>;
    } else if (typeof raw.value === "object" && raw.value !== null) {
      data = raw.value as Record<string, unknown>;
    }
  } catch {
    // leave data as empty object
  }

  const timestamp = raw.ledgerCloseTime
    ? new Date(raw.ledgerCloseTime * 1000).toISOString()
    : new Date().toISOString();
  const txHash = raw.txHash ?? raw.id ?? "";
  const ledger = raw.ledger ?? 0;

  const merchant = String(data.merchant ?? "");

  if (eventType === "charged") {
    const gross = BigInt(String(data.gross ?? data.amount ?? "0"));
    // Use the fee field from the event data when present, otherwise
    // reconstruct from fee_bps active at this ledger
    let fee: bigint;
    if (data.fee !== undefined && String(data.fee) !== "0") {
      fee = BigInt(String(data.fee));
    } else {
      const bps = feeBpsAtLedger(feeSnapshots, ledger);
      fee = bps > 0 ? (gross * BigInt(bps)) / 10000n : 0n;
    }
    const net = gross - fee;

    return {
      event_type: "charged",
      timestamp,
      subscriber,
      merchant,
      amount_stroops: gross.toString(),
      fee_stroops: fee.toString(),
      net_stroops: net.toString(),
      tx_hash: txHash,
      ledger,
    };
  }

  if (eventType === "subscribed") {
    const amount = BigInt(String(data.amount ?? "0"));
    return {
      event_type: "subscribed",
      timestamp,
      subscriber,
      merchant,
      amount_stroops: amount.toString(),
      fee_stroops: "0",
      net_stroops: amount.toString(),
      tx_hash: txHash,
      ledger,
    };
  }

  if (eventType === "cancelled" || eventType === "cancelled_with_refund") {
    const refund = BigInt(String(data.refund_amount ?? "0"));
    return {
      event_type: eventType,
      timestamp,
      subscriber,
      merchant,
      amount_stroops: refund.toString(),
      fee_stroops: "0",
      net_stroops: refund.toString(),
      tx_hash: txHash,
      ledger,
    };
  }

  if (eventType === "pay_per_use") {
    const amount = BigInt(String(data.amount ?? "0"));
    const bps = feeBpsAtLedger(feeSnapshots, ledger);
    const fee = bps > 0 ? (amount * BigInt(bps)) / 10000n : 0n;
    return {
      event_type: "pay_per_use",
      timestamp,
      subscriber,
      merchant: String(data.merchant ?? ""),
      amount_stroops: amount.toString(),
      fee_stroops: fee.toString(),
      net_stroops: (amount - fee).toString(),
      tx_hash: txHash,
      ledger,
    };
  }

  // Not a billing event — exclude from audit trail
  return null;
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(
  entries: AuditEntry[],
  args: CliArgs,
  contentHash: string,
): AuditSummary {
  let totalVolume = 0n;
  let totalFees = 0n;
  let totalCharges = 0;
  const uniqueSubs = new Set<string>();
  const uniqueMerchants = new Set<string>();

  for (const e of entries) {
    if (e.event_type === "charged" || e.event_type === "pay_per_use") {
      totalVolume += BigInt(e.amount_stroops);
      totalFees += BigInt(e.fee_stroops);
      totalCharges++;
    }
    if (e.subscriber) uniqueSubs.add(e.subscriber);
    if (e.merchant) uniqueMerchants.add(e.merchant);
  }

  return {
    total_events: entries.length,
    total_charges: totalCharges,
    total_volume_stroops: totalVolume.toString(),
    total_fees_stroops: totalFees.toString(),
    unique_subscribers: uniqueSubs.size,
    unique_merchants: uniqueMerchants.size,
    from_ledger: args.fromLedger,
    to_ledger: args.toLedger,
    generated_at: new Date().toISOString(),
    sha256_hash: contentHash,
  };
}

// ── Output Formatting ─────────────────────────────────────────────────────────

function renderCsv(report: AuditReport): string {
  const entryHeaders: (keyof AuditEntry)[] = [
    "event_type",
    "timestamp",
    "subscriber",
    "merchant",
    "amount_stroops",
    "fee_stroops",
    "net_stroops",
    "tx_hash",
    "ledger",
  ];

  const escape = (v: unknown): string =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines: string[] = [
    "# PayFlow Audit Trail",
    `# Generated: ${report.summary.generated_at}`,
    `# Ledger range: ${report.summary.from_ledger}–${report.summary.to_ledger}`,
    `# SHA-256: ${report.summary.sha256_hash}`,
    "",
    entryHeaders.join(","),
    ...report.entries.map((e) =>
      entryHeaders.map((h) => escape(e[h])).join(","),
    ),
    "",
    "# Summary",
    "field,value",
    ...Object.entries(report.summary).map(([k, v]) => `"${k}","${v}"`),
  ];

  return lines.join("\n");
}

function renderMarkdown(report: AuditReport): string {
  const s = report.summary;

  const tableHeader =
    "| # | Event | Timestamp | Subscriber | Merchant | Amount (stroops) | Fee | Net | Tx Hash | Ledger |";
  const tableDivider =
    "|---|-------|-----------|------------|----------|-----------------|-----|-----|---------|--------|";

  const shortAddr = (a: string): string =>
    a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;

  const tableRows = report.entries
    .map(
      (e, i) =>
        `| ${i + 1} | ${e.event_type} | ${e.timestamp} | ${shortAddr(e.subscriber)} | ${shortAddr(e.merchant)} | ${e.amount_stroops} | ${e.fee_stroops} | ${e.net_stroops} | ${e.tx_hash.slice(0, 12)}… | ${e.ledger} |`,
    )
    .join("\n");

  return [
    "# PayFlow Billing Audit Trail",
    "",
    `**Generated:** ${s.generated_at}  `,
    `**Ledger range:** ${s.from_ledger} – ${s.to_ledger}  `,
    `**SHA-256 (content hash):** \`${s.sha256_hash}\``,
    "",
    "## Events",
    "",
    tableHeader,
    tableDivider,
    tableRows,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total events | ${s.total_events} |`,
    `| Total charges | ${s.total_charges} |`,
    `| Total volume (stroops) | ${s.total_volume_stroops} |`,
    `| Total fees (stroops) | ${s.total_fees_stroops} |`,
    `| Unique subscribers | ${s.unique_subscribers} |`,
    `| Unique merchants | ${s.unique_merchants} |`,
  ].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  if (!CONTRACT_ID) {
    console.error("ERROR: CONTRACT_ID environment variable is not set.");
    process.exit(1);
  }

  const server = new Server(RPC_URL);

  console.error(
    `Fetching audit trail: ledgers ${args.fromLedger} → ${args.toLedger}…`,
  );

  // First pass: collect fee_set / fee_committed events to reconstruct fee history
  const feeSnapshots: FeeSnapshot[] = [];
  // Second pass: collect billing entries
  const entries: AuditEntry[] = [];

  try {
    for await (const raw of fetchEventStream(
      server,
      args.fromLedger,
      args.toLedger,
    )) {
      const eventType = topicString(raw.topic[0]);

      // Track fee configuration changes so we can accurately reconstruct fees
      if (eventType === "fee_set" || eventType === "fee_committed") {
        let data: Record<string, unknown> = {};
        try {
          if (typeof raw.value === "string") {
            data = JSON.parse(raw.value) as Record<string, unknown>;
          } else if (typeof raw.value === "object" && raw.value !== null) {
            data = raw.value as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
        const bps = parseInt(String(data.bps ?? data[1] ?? "0"), 10);
        if (!isNaN(bps)) {
          feeSnapshots.push({ ledger: raw.ledger ?? 0, bps });
        }
        continue;
      }

      // Parse billing event
      const entry = parseAuditEntry(raw, feeSnapshots);
      if (!entry) continue;

      // Apply subscriber / merchant filters
      if (args.subscriber && entry.subscriber !== args.subscriber) continue;
      if (args.merchant && entry.merchant !== args.merchant) continue;

      entries.push(entry);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`ERROR during event fetch: ${msg}`);
    process.exit(1);
  }

  console.error(`Fetched ${entries.length} billing events.`);

  // Compute content hash over the entries JSON (without the hash field itself)
  // so the hash can be verified by re-running and comparing.
  const entriesJson = JSON.stringify(entries);
  const contentHash = createHash("sha256").update(entriesJson).digest("hex");

  const summary = buildSummary(entries, args, contentHash);
  const report: AuditReport = { entries, summary };

  let output: string;
  if (args.format === "csv") {
    output = renderCsv(report);
  } else if (args.format === "markdown") {
    output = renderMarkdown(report);
  } else {
    output = JSON.stringify(report, null, 2);
  }

  if (args.outFile) {
    try {
      writeFileSync(args.outFile, output);
      console.error(`Wrote audit trail to ${args.outFile}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`ERROR: Failed to write output file: ${msg}`);
      process.exit(1);
    }
  } else {
    process.stdout.write(output + "\n");
  }

  // Print a brief summary to stderr so it doesn't pollute piped output
  console.error("");
  console.error(`Summary:`);
  console.error(`  Events          : ${summary.total_events}`);
  console.error(`  Charges         : ${summary.total_charges}`);
  console.error(`  Volume (stroops): ${summary.total_volume_stroops}`);
  console.error(`  Fees   (stroops): ${summary.total_fees_stroops}`);
  console.error(`  Subscribers     : ${summary.unique_subscribers}`);
  console.error(`  Merchants       : ${summary.unique_merchants}`);
  console.error(`  SHA-256         : ${summary.sha256_hash}`);

  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FATAL: ${msg}`);
  process.exit(1);
});
