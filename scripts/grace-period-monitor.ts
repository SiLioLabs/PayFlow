/**
 * grace-period-monitor.ts — Grace Period Window Monitor & Webhook Alerting for FlowPay.
 *
 * Finds active subscriptions currently within their grace window
 * (interval elapsed but grace period not yet expired). Computes time remaining
 * and triggers a webhook alert if remaining time is below GRACE_ALERT_THRESHOLD_PCT (default 25%).
 *
 * Usage:
 *   npx tsx scripts/grace-period-monitor.ts
 *
 * Environment Variables:
 *   RPC_URL                    — Soroban RPC endpoint
 *   CONTRACT_ID / VITE_CONTRACT_ID — Deployed FlowPay contract ID
 *   WEBHOOK_URL / ALERT_WEBHOOK_URL — Target webhook URL for alerting
 *   GRACE_ALERT_THRESHOLD_PCT  — Alert threshold percentage (default: 25)
 *   KEEPER_HEARTBEAT_PATH      — Path to keeper heartbeat file (default: data/keeper-heartbeat.json)
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL =
  process.env.RPC_URL ||
  process.env.VITE_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ||
  process.env.VITE_NETWORK_PASSPHRASE ||
  Networks.TESTNET;
const CONTRACT_ID =
  process.env.CONTRACT_ID || process.env.VITE_CONTRACT_ID || "";
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL || "";
const THRESHOLD_PCT = Number(process.env.GRACE_ALERT_THRESHOLD_PCT ?? "25");
const HEARTBEAT_PATH =
  process.env.KEEPER_HEARTBEAT_PATH ||
  join(process.cwd(), "data", "keeper-heartbeat.json");

const isJsonOutput = process.argv.includes("--json");
const outFileIdx = process.argv.indexOf("--out-file");
const outFile = outFileIdx !== -1 ? process.argv[outFileIdx + 1] : undefined;

function logSummary(msg: string) {
  if (isJsonOutput && !outFile) {
    console.error(msg);
  } else {
    logSummary(msg);
  }
}

interface GraceAlert {
  subscriber: string;
  merchant: string;
  amount: string;
  graceWindowExpiryTimestamp: number;
  graceWindowExpiryIso: string;
  timeRemainingSeconds: number;
  percentageRemaining: number;
  keeperLastRunTimestamp: number | null;
  keeperLastRunIso: string | null;
}

interface HeartbeatInfo {
  lastRunTimestamp: number | null;
  lastRunIso: string | null;
  isStaleOrMissing: boolean;
}

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

async function getKeeperHeartbeat(): Promise<HeartbeatInfo> {
  if (!existsSync(HEARTBEAT_PATH)) {
    return { lastRunTimestamp: null, lastRunIso: null, isStaleOrMissing: true };
  }

  try {
    const raw = readFileSync(HEARTBEAT_PATH, "utf-8");
    const data = JSON.parse(raw);
    const lastRun = Number(data.last_run_timestamp ?? data.lastRunTimestamp);
    if (isNaN(lastRun) || lastRun <= 0) {
      return {
        lastRunTimestamp: null,
        lastRunIso: null,
        isStaleOrMissing: true,
      };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    // Heartbeat considered stale if keeper hasn't run in > 15 minutes (900s)
    const isStale = nowSec - lastRun > 900;
    return {
      lastRunTimestamp: lastRun,
      lastRunIso: new Date(lastRun * 1000).toISOString(),
      isStaleOrMissing: isStale,
    };
  } catch {
    return { lastRunTimestamp: null, lastRunIso: null, isStaleOrMissing: true };
  }
}

async function getDummyAccount(server: Server) {
  const dummy = "GCZDMZCNQ5ZRR7IJK2G2H7C5OZS6M5J2G2H7C5OZS6M5J2G2H7C5OZS6";
  try {
    return await server.getAccount(dummy);
  } catch {
    const { Account } = await import("@stellar/stellar-sdk");
    return new Account(dummy, "0");
  }
}

async function fetchContractGracePeriod(server: Server): Promise<number> {
  if (!CONTRACT_ID) return 0;
  const contract = new Contract(CONTRACT_ID);
  const account = await getDummyAccount(server);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_grace_period"))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result && result.error) return 0;

  const retval = (result as { result?: { retval?: xdr.ScVal } }).result?.retval;
  if (!retval || retval.switch().name === "scvVoid") return 0;
  return Number(retval.u64().toString());
}

interface SubscriptionData {
  subscriber: string;
  merchant: string;
  amount: string;
  interval: number;
  lastCharged: number;
  active: boolean;
  paused: boolean;
}

async function fetchActiveSubscriptions(
  server: Server,
): Promise<SubscriptionData[]> {
  if (!CONTRACT_ID) return [];
  const response = await server.getEvents({
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    limit: 1000,
  });

  const activeMap = new Map<string, SubscriptionData>();

  for (const event of response.events) {
    const topic = event.topic;
    if (!topic || topic.length < 2) continue;
    const eventType = topic[0]?.toString();
    const userAddress = topic[1]?.toString();
    if (!userAddress) continue;

    if (eventType === "subscribed") {
      const val = (event as any).value?._value;
      if (!val) continue;
      const merchant = val.merchant?.toString() ?? "";
      const amount = val.amount?.toString() ?? "0";
      const interval = Number(val.interval ?? 86400);

      activeMap.set(userAddress, {
        subscriber: userAddress,
        merchant,
        amount,
        interval,
        lastCharged: Math.floor(Date.now() / 1000),
        active: true,
        paused: false,
      });
    } else if (eventType === "cancelled") {
      activeMap.delete(userAddress);
    } else if (eventType === "paused") {
      const existing = activeMap.get(userAddress);
      if (existing) existing.paused = true;
    } else if (eventType === "resumed") {
      const existing = activeMap.get(userAddress);
      if (existing) existing.paused = false;
    }
  }

  return Array.from(activeMap.values());
}

async function sendWebhookAlert(
  alerts: GraceAlert[],
  heartbeatInfo: HeartbeatInfo,
): Promise<void> {
  const payload = {
    event: "grace_period_window_alert",
    timestamp: new Date().toISOString(),
    alertCount: alerts.length,
    thresholdPercentage: THRESHOLD_PCT,
    keeperStatus: heartbeatInfo.isStaleOrMissing
      ? "CRITICAL_HEARTBEAT_MISSING_OR_STALE"
      : "OK",
    keeperLastRun: heartbeatInfo.lastRunIso,
    alerts,
  };

  console.log(`\n====================================================`);
  console.log(
    `🚨 ALERT TRIGGERED: ${alerts.length} subscription(s) near grace window expiry!`,
  );
  console.log(JSON.stringify(payload, null, 2));
  console.log(`====================================================\n`);

  if (!WEBHOOK_URL) {
    console.log(
      `[INFO] No WEBHOOK_URL configured. Alert output logged to stdout.`,
    );
  logSummary(`\n====================================================`);
  logSummary(`🚨 ALERT TRIGGERED: ${alerts.length} subscription(s) near grace window expiry!`);
  logSummary(JSON.stringify(payload, null, 2));
  logSummary(`====================================================\n`);

  if (!WEBHOOK_URL) {
    logSummary(`[INFO] No WEBHOOK_URL configured. Alert output logged to stdout.`);
    return;
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    logSummary(`Webhook POST response status: ${res.status}`);
  } catch (err) {
    console.error(
      `Failed to send webhook alert:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function main() {
  console.log(`====================================================`);
  console.log(`FlowPay Grace Period Window Monitor`);
  console.log(`RPC Endpoint: ${RPC_URL}`);
  console.log(
    `Contract ID: ${CONTRACT_ID || "(Not configured - scanning mode)"}`,
  );
  console.log(`Alert Threshold: < ${THRESHOLD_PCT}% remaining`);
  console.log(`====================================================\n`);
  logSummary(`====================================================`);
  logSummary(`FlowPay Grace Period Window Monitor`);
  logSummary(`RPC Endpoint: ${RPC_URL}`);
  logSummary(`Contract ID: ${CONTRACT_ID || "(Not configured - scanning mode)"}`);
  logSummary(`Alert Threshold: < ${THRESHOLD_PCT}% remaining`);
  logSummary(`====================================================\n`);

  const server = new Server(RPC_URL);
  const heartbeatInfo = await getKeeperHeartbeat();

  if (heartbeatInfo.isStaleOrMissing) {
    console.warn(
      `⚠️ WARNING: Keeper heartbeat is missing or stale! Last run: ${heartbeatInfo.lastRunIso ?? "Never"}`,
    );
  }

  const gracePeriodSeconds = await fetchContractGracePeriod(server);
  if (gracePeriodSeconds === 0) {
    console.log(
      `Contract grace period is 0 (disabled). No grace window checks required.`,
    );
    logSummary(`Contract grace period is 0 (disabled). No grace window checks required.`);
    process.exit(0);
  }

  const subscriptions = await fetchActiveSubscriptions(server);
  console.log(
    `Found ${subscriptions.length} active subscription(s) to check...`,
  );
  logSummary(`Found ${subscriptions.length} active subscription(s) to check...`);

  const nowSec = Math.floor(Date.now() / 1000);
  const triggeredAlerts: GraceAlert[] = [];

  const scores: { subscriber: string; urgencyScore: number; timeRemainingSeconds: number }[] = [];

  for (const sub of subscriptions) {
    if (!sub.active || sub.paused) {
      continue; // Skip inactive or paused subscriptions
    }

    const intervalEnd = sub.lastCharged + sub.interval;
    const graceWindowExpiry = intervalEnd + gracePeriodSeconds;

    // Check if subscription is inside grace window:
    // now > intervalEnd AND now < graceWindowExpiry
    if (nowSec > intervalEnd && nowSec < graceWindowExpiry) {
      const timeRemainingSeconds = graceWindowExpiry - nowSec;
      const pctRemaining = Number(
        ((timeRemainingSeconds / gracePeriodSeconds) * 100).toFixed(2),
      );

      console.log(
        `  [IN GRACE WINDOW] Subscriber: ${sub.subscriber} | Time Left: ${timeRemainingSeconds}s (${pctRemaining}%)`,
      );
      const pctRemaining = Number(((timeRemainingSeconds / gracePeriodSeconds) * 100).toFixed(2));
      const urgencyScore = 1.0 - (timeRemainingSeconds / gracePeriodSeconds);
      
      scores.push({
        subscriber: sub.subscriber,
        urgencyScore: Number(urgencyScore.toFixed(4)),
        timeRemainingSeconds
      });

      logSummary(`  [IN GRACE WINDOW] Subscriber: ${sub.subscriber} | Time Left: ${timeRemainingSeconds}s (${pctRemaining}%)`);

      if (pctRemaining < THRESHOLD_PCT) {
        triggeredAlerts.push({
          subscriber: sub.subscriber,
          merchant: sub.merchant,
          amount: sub.amount,
          graceWindowExpiryTimestamp: graceWindowExpiry,
          graceWindowExpiryIso: new Date(
            graceWindowExpiry * 1000,
          ).toISOString(),
          timeRemainingSeconds,
          percentageRemaining: pctRemaining,
          keeperLastRunTimestamp: heartbeatInfo.lastRunTimestamp,
          keeperLastRunIso: heartbeatInfo.lastRunIso,
        });
      }
    }
  }

  if (triggeredAlerts.length > 0 || heartbeatInfo.isStaleOrMissing) {
    await sendWebhookAlert(triggeredAlerts, heartbeatInfo);
  } else {
    console.log(
      `All active subscriptions within healthy grace period bounds. No alerts triggered.`,
    );
    logSummary(`All active subscriptions within healthy grace period bounds. No alerts triggered.`);
  }

  const outputPayload = {
    timestamp: new Date().toISOString(),
    scores
  };
  const jsonStr = JSON.stringify(outputPayload, null, 2);
  
  if (outFile) {
    writeFileSync(outFile, jsonStr, "utf-8");
    logSummary(`[INFO] Urgency scores written to ${outFile}`);
  } else if (isJsonOutput) {
    console.log(jsonStr);
  }
}

main().catch((err) => {
  console.error(
    "Grace period monitor failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});

