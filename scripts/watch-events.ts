#!/usr/bin/env tsx
/**
 * watch-events.ts — Real-time contract event monitor for FlowPay
 *
 * Polls getEvents on a 3-second interval and pretty-prints new events to stdout
 * with color-coded event types and human-readable amounts (stroops → XLM).
 */

import { Server } from "@stellar/stellar-sdk/rpc";

// ── Configuration ────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID || "";
const POLL_INTERVAL_MS = 3000;

if (!CONTRACT_ID) {
  console.error("Error: CONTRACT_ID environment variable is required");
  console.error("Usage: CONTRACT_ID=your_contract_id RPC_URL=https://... tsx watch-events.ts");
  process.exit(1);
}

// ── Color Codes ─────────────────────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  
  // Event type colors
  green: "\x1b[32m",    // charged, subscribed
  red: "\x1b[31m",      // cancelled
  yellow: "\x1b[33m",   // pay_per_use, paused
  blue: "\x1b[34m",     // resumed
  cyan: "\x1b[36m",     // admin events
  magenta: "\x1b[35m",  // merchant events
  gray: "\x1b[90m",     // metadata
};

// ── Event Type Color Mapping ─────────────────────────────────────────────────────

const eventColors: Record<string, string> = {
  charged: colors.green,
  subscribed: colors.green,
  cancelled: colors.red,
  pay_per_use: colors.yellow,
  paused: colors.yellow,
  resumed: colors.blue,
  admin_transferred: colors.cyan,
  contract_paused: colors.cyan,
  contract_unpaused: colors.cyan,
  merchant_added: colors.magenta,
  merchant_removed: colors.magenta,
  merchant_frozen: colors.magenta,
  merchant_unfrozen: colors.magenta,
  daily_limit_set: colors.gray,
  daily_limit_removed: colors.gray,
  sub_amount_updated: colors.gray,
  sub_interval_updated: colors.gray,
};

// ── Helpers ───────────────────────────────────────────────────────────────────────

/**
 * Convert stroops to XLM (1 XLM = 10,000,000 stroops)
 */
function stroopsToXlm(stroops: string | number | bigint): string {
  const value = typeof stroops === "bigint" ? Number(stroops) : Number(stroops);
  const xlm = value / 10_000_000;
  return xlm.toFixed(7);
}

/**
 * Format Unix timestamp to readable string
 */
function formatTimestamp(timestamp: number | string): string {
  const ts = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;
  const date = new Date(ts * 1000);
  return date.toISOString();
}

/**
 * Shorten address for display (first 8 chars ... last 4 chars)
 */
function shortenAddress(address: string): string {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

/**
 * Get color for event type
 */
function getEventColor(eventType: string): string {
  return eventColors[eventType] || colors.reset;
}

/**
 * Parse event value field safely
 */
function parseEventValueField(value: any, field: string): string {
  if (!value) return "";
  const base = value._value?.[field] ?? value[field];
  if (base == null) return "";
  if (typeof base === "string") return base;
  if (typeof base === "number" || typeof base === "bigint") return base.toString();
  if (typeof base.toString === "function") return base.toString();
  return "";
}

/**
 * Parse event timestamp from various formats
 */
function parseEventTime(event: any): number {
  if (typeof event.ledgerCloseTime === "number") return event.ledgerCloseTime;
  if (typeof event.ledgerCloseTime === "string") return Number(event.ledgerCloseTime) || 0;
  if (typeof event.timestamp === "string") return Math.floor(Date.parse(event.timestamp) / 1000);
  return 0;
}

// ── Event Processing ─────────────────────────────────────────────────────────────

interface ParsedEvent {
  id: string;
  type: string;
  user: string;
  merchant?: string;
  amount?: string;
  timestamp: number;
  ledger: number;
  txHash: string;
}

/**
 * Parse a raw event from the RPC response
 */
function parseEvent(event: any): ParsedEvent | null {
  if (!event.topic || event.topic.length < 1) return null;
  
  const eventType = event.topic[0]?.toString();
  if (!eventType) return null;
  
  const user = event.topic[1]?.toString() || "";
  const timestamp = parseEventTime(event);
  const ledger = event.ledger ?? 0;
  const txHash = event.txHash ?? event.id ?? "";
  const id = `${ledger}:${txHash}:${eventType}:${user}`;
  
  let merchant: string | undefined;
  let amount: string | undefined;
  
  // Parse event-specific fields
  if (event.value) {
    merchant = parseEventValueField(event.value, "merchant");
    amount = parseEventValueField(event.value, "amount") || 
             parseEventValueField(event.value, "gross") ||
             parseEventValueField(event.value, "net");
  }
  
  return {
    id,
    type: eventType,
    user,
    merchant,
    amount,
    timestamp,
    ledger,
    txHash,
  };
}

/**
 * Pretty-print an event to stdout
 */
function printEvent(event: ParsedEvent): void {
  const color = getEventColor(event.type);
  const timestamp = formatTimestamp(event.timestamp);
  const user = shortenAddress(event.user);
  const merchant = event.merchant ? shortenAddress(event.merchant) : "N/A";
  const amount = event.amount ? `${stroopsToXlm(event.amount)} XLM` : "N/A";
  
  console.log(
    `${colors.dim}${timestamp}${colors.reset} ` +
    `${color}${colors.bright}${event.type}${colors.reset} ` +
    `${colors.dim}|${colors.reset} ` +
    `User: ${user} ` +
    `${colors.dim}|${colors.reset} ` +
    `Merchant: ${merchant} ` +
    `${colors.dim}|${colors.reset} ` +
    `Amount: ${amount} ` +
    `${colors.dim}|${colors.reset} ` +
    `Ledger: ${event.ledger}`
  );
}

// ── Main Polling Loop ───────────────────────────────────────────────────────────

const server = new Server(RPC_URL);
const seenEvents = new Set<string>();
let currentLedger = 0;

async function fetchAndPrintEvents(): Promise<void> {
  try {
    if (currentLedger === 0) {
      const latest = await server.getLatestLedger();
      currentLedger = latest.sequence;
    }

    const response = await server.getEvents({
      startLedger: currentLedger,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 100,
    });
    
    if (response.latestLedger) {
      currentLedger = response.latestLedger;
    }
    
    const newEvents: ParsedEvent[] = [];
    
    for (const event of response.events) {
      const parsed = parseEvent(event);
      if (!parsed) continue;
      
      if (!seenEvents.has(parsed.id)) {
        seenEvents.add(parsed.id);
        newEvents.push(parsed);
      }
    }
    
    // Sort by timestamp and print new events
    newEvents.sort((a, b) => a.timestamp - b.timestamp);
    for (const event of newEvents) {
      printEvent(event);
    }
    
    if (newEvents.length > 0) {
      console.log(colors.dim + `─ ${newEvents.length} new event(s) ─` + colors.reset);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
    console.error(colors.red + `Error fetching events: ${errorMsg}` + colors.reset);
  }
}

async function main(): Promise<void> {
  console.log(colors.bright + "FlowPay Event Watcher" + colors.reset);
  console.log(colors.dim + `RPC: ${RPC_URL}` + colors.reset);
  console.log(colors.dim + `Contract: ${CONTRACT_ID}` + colors.reset);
  console.log(colors.dim + `Polling every ${POLL_INTERVAL_MS}ms...` + colors.reset);
  console.log("");
  
  // Initial fetch
  await fetchAndPrintEvents();
  
  // Polling loop
  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    await fetchAndPrintEvents();
  }
}

// ── Error Handling ───────────────────────────────────────────────────────────────

process.on("uncaughtException", (error) => {
  console.error(colors.red + `Uncaught exception: ${error}` + colors.reset);
});

process.on("unhandledRejection", (reason) => {
  console.error(colors.red + `Unhandled rejection: ${reason}` + colors.reset);
});

// Start the watcher
main().catch((error) => {
  console.error(colors.red + `Fatal error: ${error}` + colors.reset);
  process.exit(1);
});
