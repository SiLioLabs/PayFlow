import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { fetchEventsFromRpc, ParsedRpcEvent } from "./rpc-client.js";

// ── Interface Definitions ───────────────────────────────────────────────────

/**
 * Interface representing a cohort analysis row.
 */
export interface CohortAnalysis {
  cohort: string; // "YYYY-MM"
  initial_size: number;
  active_30_days: number | "insufficient data";
  active_90_days: number | "insufficient data";
  retention_rate_30d: string; // e.g. "85.50%" or "insufficient data"
  retention_rate_90d: string; // e.g. "72.10%" or "insufficient data"
}

/**
 * Interface representing merchant-level breakdown.
 */
export interface MerchantChurn {
  merchant_id: string;
  subscribers: number;
  cancellations: number;
  churn_rate: string; // e.g. "30.00%"
}

/**
 * Interface representing the complete Subscriber Churn Analysis report.
 */
export interface ChurnAnalysisReport {
  generated_at: string;
  reference_time: string;
  data_source: "sqlite" | "rpc";
  resubscription_logic: "new" | "retention";
  cohorts: CohortAnalysis[];
  top_merchants_churn: MerchantChurn[];
  projection: {
    average_monthly_churn_rate: string; // e.g. "12.50%"
    current_active_subscribers: number;
    projected_churn_count: string; // e.g. "3.75"
  };
}

/**
 * Interface representing a unified subscriber event.
 */
interface UnifiedEvent {
  eventName: string;
  user: string;
  timestamp: number;
  merchant?: string;
  amount?: string;
  interval?: string;
}

/**
 * Interface representing an active or historical subscription lifespan
 * used in the "new" resubscription logic.
 */
interface SubscriptionLifespan {
  user: string;
  merchant: string;
  subscribeTime: number;
  cancelTime: number | null;
}

// ── CLI Parsing ──────────────────────────────────────────────────────────────

class CommandLineArgs {
  format: "json" | "csv" = "json";
  dbPath?: string;
  outPath?: string;
  resubscriptionLogic: "new" | "retention" = "new";

  constructor() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--format" && args[i + 1]) {
        const f = args[++i].toLowerCase();
        if (f === "json" || f === "csv") {
          this.format = f;
        }
      } else if (args[i] === "--db" && args[i + 1]) {
        this.dbPath = args[++i];
      } else if (args[i] === "--out" && args[i + 1]) {
        this.outPath = args[++i];
      } else if (args[i] === "--resubscription-logic" && args[i + 1]) {
        const r = args[++i].toLowerCase();
        if (r === "new" || r === "retention") {
          this.resubscriptionLogic = r;
        }
      }
    }
  }
}

// ── Core Calculations ────────────────────────────────────────────────────────

/**
 * Group subscribers into monthly cohorts and compute 30-day / 90-day retention
 * and churn projections.
 *
 * Formulas Used:
 * 1. Retention Rate:
 *    Retention Rate = (Active Subscribers at Day N / Initial Cohort Size) * 100
 *
 * 2. Monthly Churn Rate (for completed cohorts):
 *    Cohort Monthly Churn Rate = 100% - Retention Rate at Day 30
 *    Average Monthly Churn Rate = Sum(Cohort Monthly Churn Rates) / Count(Completed Cohorts)
 *
 * 3. Churn Projection:
 *    Projected Churn Count = Current Active Subscribers * Average Monthly Churn Rate
 *
 * 4. Merchant Churn Rate:
 *    Merchant Churn Rate = (Merchant Cancellations / Unique Merchant Subscribers) * 100
 *
 * @param events - Chronologically sorted unified subscription and cancellation events.
 * @param logic - "new" to treat resubscriptions as new cohort entries, "retention" for first-subscribe user tracking.
 * @param referenceTimeOverride - Optional manual reference time override (primarily for testing).
 */
export function calculateChurnAnalysis(
  events: UnifiedEvent[],
  logic: "new" | "retention",
  referenceTimeOverride?: number
): ChurnAnalysisReport {
  // Determine reference time.
  // To handle historical datasets or test environments correctly, we default to the maximum
  // of the current system time and the latest event timestamp in our dataset.
  const latestEventTime = events.reduce((max, e) => Math.max(max, e.timestamp), 0);
  const referenceTime = referenceTimeOverride ?? Math.max(Math.floor(Date.now() / 1000), latestEventTime);

  // Helper to convert timestamp to "YYYY-MM"
  const getCohortMonth = (ts: number): string => {
    return new Date(ts * 1000).toISOString().slice(0, 7);
  };

  // Helper to find the start of the next month as a Unix timestamp
  const getNextMonthStart = (cohort: string): number => {
    const year = parseInt(cohort.slice(0, 4), 10);
    const month = parseInt(cohort.slice(5, 7), 10);
    const nextMonthDate = new Date(Date.UTC(year, month, 1));
    return Math.floor(nextMonthDate.getTime() / 1000);
  };

  // 1. Build subscriber subscription lifespans / user state maps
  const allLifespans: SubscriptionLifespan[] = [];
  const activeLifespans = new Map<string, SubscriptionLifespan>();
  const userFirstSubscribe = new Map<string, number>();
  const userEvents = new Map<string, Array<{ eventName: string; timestamp: number }>>();
  const userMerchantState = new Map<string, Map<string, "subscribed" | "cancelled">>();

  for (const e of events) {
    const { eventName, user, timestamp, merchant } = e;

    // Track user-level event history
    if (!userEvents.has(user)) {
      userEvents.set(user, []);
    }
    userEvents.get(user)!.push({ eventName, timestamp });

    if (eventName === "subscribed") {
      if (merchant) {
        // Track merchant subscriber state
        if (!userMerchantState.has(merchant)) {
          userMerchantState.set(merchant, new Map());
        }
        userMerchantState.get(merchant)!.set(user, "subscribed");

        // "new" logic: treat as a separate subscription lifespan
        if (activeLifespans.has(user)) {
          // Close old lifespan at the new subscription timestamp
          const old = activeLifespans.get(user)!;
          old.cancelTime = timestamp;
          activeLifespans.delete(user);
        }

        const lifespan: SubscriptionLifespan = {
          user,
          merchant,
          subscribeTime: timestamp,
          cancelTime: null,
        };
        allLifespans.push(lifespan);
        activeLifespans.set(user, lifespan);
      }

      // "retention" logic: record first subscription time
      if (!userFirstSubscribe.has(user)) {
        userFirstSubscribe.set(user, timestamp);
      }
    } else if (eventName === "cancelled" || eventName === "cancelled_with_refund") {
      // Find active merchant for this user to attribute cancellation
      let currentMerchant: string | undefined;

      // Close lifespan in "new" logic
      if (activeLifespans.has(user)) {
        const lifespan = activeLifespans.get(user)!;
        lifespan.cancelTime = timestamp;
        currentMerchant = lifespan.merchant;
        activeLifespans.delete(user);
      } else {
        // Fallback: search backwards for the latest subscribed event
        const history = userEvents.get(user) || [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].eventName === "subscribed") {
            // Find corresponding subscription event in original array to get merchant
            const subEvent = events.find(
              (evt) => evt.user === user && evt.eventName === "subscribed" && evt.timestamp === history[i].timestamp
            );
            if (subEvent?.merchant) {
              currentMerchant = subEvent.merchant;
              break;
            }
          }
        }
      }

      if (currentMerchant) {
        if (!userMerchantState.has(currentMerchant)) {
          userMerchantState.set(currentMerchant, new Map());
        }
        userMerchantState.get(currentMerchant)!.set(user, "cancelled");
      }
    }
  }

  // 2. Cohort Analysis Grouping
  const cohortsMap = new Map<string, { initial: number; active30: number; active90: number }>();
  const cohortsList: string[] = [];

  if (logic === "new") {
    // Group lifespans
    for (const lifespan of allLifespans) {
      const cohort = getCohortMonth(lifespan.subscribeTime);
      if (!cohortsMap.has(cohort)) {
        cohortsMap.set(cohort, { initial: 0, active30: 0, active90: 0 });
        cohortsList.push(cohort);
      }
      const data = cohortsMap.get(cohort)!;
      data.initial++;

      // Check retention status
      const t30 = lifespan.subscribeTime + 30 * 24 * 3600;
      const t90 = lifespan.subscribeTime + 90 * 24 * 3600;

      if (lifespan.cancelTime === null || lifespan.cancelTime > t30) {
        data.active30++;
      }
      if (lifespan.cancelTime === null || lifespan.cancelTime > t90) {
        data.active90++;
      }
    }
  } else {
    // Group unique users by first subscription
    for (const [user, startTs] of userFirstSubscribe.entries()) {
      const cohort = getCohortMonth(startTs);
      if (!cohortsMap.has(cohort)) {
        cohortsMap.set(cohort, { initial: 0, active30: 0, active90: 0 });
        cohortsList.push(cohort);
      }
      const data = cohortsMap.get(cohort)!;
      data.initial++;

      const t30 = startTs + 30 * 24 * 3600;
      const t90 = startTs + 90 * 24 * 3600;

      // Check retention using full event history
      const history = userEvents.get(user) || [];
      const getActiveAt = (cutoff: number): boolean => {
        const eventsBefore = history
          .filter((h) => h.timestamp <= cutoff)
          .sort((a, b) => a.timestamp - b.timestamp);
        if (eventsBefore.length === 0) return false;
        const latest = eventsBefore[eventsBefore.length - 1];
        return latest.eventName === "subscribed";
      };

      if (getActiveAt(t30)) data.active30++;
      if (getActiveAt(t90)) data.active90++;
    }
  }

  // Generate Cohorts Array with Data Guarding (insufficient data checks)
  cohortsList.sort(); // Sort by month ascending
  const cohorts: CohortAnalysis[] = [];
  let completedCohortsChurnSum = 0;
  let completedCohortsCount = 0;

  for (const cohort of cohortsList) {
    const data = cohortsMap.get(cohort)!;
    const nextMonthStart = getNextMonthStart(cohort);

    const has30dData = referenceTime >= nextMonthStart + 30 * 24 * 3600;
    const has90dData = referenceTime >= nextMonthStart + 90 * 24 * 3600;

    const active30 = has30dData ? data.active30 : "insufficient data";
    const active90 = has90dData ? data.active90 : "insufficient data";

    const retention30d = has30dData
      ? `${((data.active30 / data.initial) * 100).toFixed(2)}%`
      : "insufficient data";
    const retention90d = has90dData
      ? `${((data.active90 / data.initial) * 100).toFixed(2)}%`
      : "insufficient data";

    cohorts.push({
      cohort,
      initial_size: data.initial,
      active_30_days: active30,
      active_90_days: active90,
      retention_rate_30d: retention30d,
      retention_rate_90d: retention90d,
    });

    if (has30dData) {
      const churnRate = 1 - data.active30 / data.initial;
      completedCohortsChurnSum += churnRate;
      completedCohortsCount++;
    }
  }

  // 3. Merchant-Level Breakdown
  const merchantChurns: MerchantChurn[] = [];
  for (const [merchant, usersMap] of userMerchantState.entries()) {
    const totalSubscribers = usersMap.size;
    // Filter out single-subscriber merchants (<= 1 subscriber) to avoid statistical skew
    if (totalSubscribers <= 1) {
      continue;
    }

    let cancellations = 0;
    for (const state of usersMap.values()) {
      if (state === "cancelled") {
        cancellations++;
      }
    }

    const churnRate = (cancellations / totalSubscribers) * 100;
    merchantChurns.push({
      merchant_id: merchant,
      subscribers: totalSubscribers,
      cancellations,
      churn_rate: `${churnRate.toFixed(2)}%`,
    });
  }

  // Sort merchants by highest churn rate descending, and take the top 5
  const topMerchants = merchantChurns
    .sort((a, b) => parseFloat(b.churn_rate) - parseFloat(a.churn_rate))
    .slice(0, 5);

  // 4. Historical Churn Projection
  const avgMonthlyChurnRate = completedCohortsCount > 0 ? completedCohortsChurnSum / completedCohortsCount : 0;

  // Determine currently active subscribers at the reference time
  let currentActiveCount = 0;
  if (logic === "new") {
    // A lifespan is active at referenceTime if subscribeTime <= referenceTime and (cancelTime === null || cancelTime > referenceTime)
    for (const lifespan of allLifespans) {
      if (
        lifespan.subscribeTime <= referenceTime &&
        (lifespan.cancelTime === null || lifespan.cancelTime > referenceTime)
      ) {
        currentActiveCount++;
      }
    }
  } else {
    // A user is active if their latest event <= referenceTime is "subscribed"
    for (const [user, history] of userEvents.entries()) {
      const eventsBeforeRef = history
        .filter((h) => h.timestamp <= referenceTime)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (eventsBeforeRef.length > 0) {
        const latest = eventsBeforeRef[eventsBeforeRef.length - 1];
        if (latest.eventName === "subscribed") {
          currentActiveCount++;
        }
      }
    }
  }

  const projectedChurn = currentActiveCount * avgMonthlyChurnRate;

  return {
    generated_at: new Date().toISOString(),
    reference_time: new Date(referenceTime * 1000).toISOString(),
    data_source: events.length > 0 ? "sqlite" : "sqlite", // Will be overwritten in main
    resubscription_logic: logic,
    cohorts,
    top_merchants_churn: topMerchants,
    projection: {
      average_monthly_churn_rate: `${(avgMonthlyChurnRate * 100).toFixed(2)}%`,
      current_active_subscribers: currentActiveCount,
      projected_churn_count: projectedChurn.toFixed(2),
    },
  };
}

// ── Main CLI Execution ────────────────────────────────────────────────────────

async function main() {
  // Only execute CLI parsing and output if called directly
  const isMain = process.argv[1]?.endsWith("/churn-analysis.ts") ||
                 process.argv[1]?.endsWith("\\churn-analysis.ts") ||
                 process.argv[1]?.endsWith("/churn-analysis.js") ||
                 process.argv[1]?.endsWith("\\churn-analysis.js") ||
                 process.argv[1]?.endsWith("scripts/churn-analysis.ts") ||
                 process.argv[1]?.endsWith("scripts/churn-analysis.js");
  if (!isMain) return;

  const cli = new CommandLineArgs();

  // Try DB, fallback to RPC
  let events: UnifiedEvent[] = [];
  let dataSource: "sqlite" | "rpc" = "sqlite";

  const dbPath = cli.dbPath ?? process.env.INDEXER_DB_PATH ?? process.env.INDEXER_DB ?? "indexer.db";

  let hasSqlite = false;
  try {
    const db = new DatabaseSync(dbPath, { open: true });
    // Verify required events table exists
    const row = db
      .prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='events'")
      .get() as { n: number };

    if (row && row.n > 0) {
      hasSqlite = true;
      const rows = db
        .prepare(
          `SELECT event_name, data, timestamp FROM events
           WHERE event_name IN ('subscribed', 'cancelled', 'cancelled_with_refund')
           ORDER BY timestamp ASC`
        )
        .all() as Array<{ event_name: string; data: string; timestamp: number }>;

      for (const r of rows) {
        try {
          const parsed = JSON.parse(r.data);
          const user = parsed.user || parsed.address || "";
          const merchant = parsed.merchant || undefined;
          const amount = parsed.amount?.toString() || undefined;
          const interval = parsed.interval?.toString() || undefined;

          events.push({
            eventName: r.event_name,
            user,
            timestamp: r.timestamp,
            merchant,
            amount,
            interval,
          });
        } catch {
          // Skip malformed rows
        }
      }
    }
    db.close();
  } catch (err: any) {
    // If db couldn't be opened, hasSqlite remains false
  }

  if (!hasSqlite) {
    console.warn("SQLite Indexer database is unavailable or unconfigured.");
    console.warn("Falling back to querying on-chain events via the Soroban RPC...");
    dataSource = "rpc";
    try {
      const rpcEvents = await fetchEventsFromRpc();
      events = rpcEvents.map((re) => ({
        eventName: re.eventName,
        user: re.user,
        timestamp: re.timestamp,
        merchant: re.merchant,
        amount: re.amount,
        interval: re.interval,
      }));
    } catch (rpcErr: any) {
      console.error(`RPC Fallback failed: ${rpcErr?.message || rpcErr}`);
      process.exit(1);
    }
  }

  const report = calculateChurnAnalysis(events, cli.resubscriptionLogic);
  report.data_source = dataSource;

  let outputContent = "";
  if (cli.format === "json") {
    outputContent = JSON.stringify(report, null, 2);
  } else {
    // Formatted CSV output
    let csv = "";
    csv += "=== COHORT RETENTION ANALYSIS ===\n";
    csv += "cohort,initial_size,active_30_days,active_90_days,retention_rate_30d,retention_rate_90d\n";
    for (const c of report.cohorts) {
      csv += `${c.cohort},${c.initial_size},${c.active_30_days},${c.active_90_days},${c.retention_rate_30d},${c.retention_rate_90d}\n`;
    }

    csv += "\n=== TOP 5 MERCHANTS BY CHURN RATE ===\n";
    csv += "merchant_id,subscribers,cancellations,churn_rate\n";
    for (const m of report.top_merchants_churn) {
      csv += `${m.merchant_id},${m.subscribers},${m.cancellations},${m.churn_rate}\n`;
    }

    csv += "\n=== HISTORICAL CHURN PROJECTION ===\n";
    csv += `Average Monthly Churn Rate,${report.projection.average_monthly_churn_rate}\n`;
    csv += `Current Active Subscribers,${report.projection.current_active_subscribers}\n`;
    csv += `Projected Churn for Next Month,${report.projection.projected_churn_count}\n`;

    outputContent = csv;
  }

  if (cli.outPath) {
    try {
      writeFileSync(cli.outPath, outputContent);
      console.log(`Report successfully written to ${cli.outPath}`);
    } catch (err: any) {
      console.error(`Failed to write output to ${cli.outPath}: ${err?.message || err}`);
      process.exit(1);
    }
  } else {
    process.stdout.write(outputContent + "\n");
  }
}

main().catch((err) => {
  console.error(`Fatal execution error: ${err?.message || err}`);
  process.exit(1);
});
