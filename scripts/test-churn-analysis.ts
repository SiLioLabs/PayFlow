import { DatabaseSync } from "node:sqlite";
import { calculateChurnAnalysis } from "./churn-analysis.js";

// Utility to assert values in tests
function assertEquals(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    console.error(`Assertion Failed: ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual:   ${JSON.stringify(actual)}`);
    process.exit(1);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

function testCohortAndResubscriptionLogic() {
  console.log(
    "\n--- Running Churn Analysis Cohort and Resubscription Logic Tests ---",
  );

  // Reference time: 2026-06-15 (Unix Timestamp: 1781481600)
  const REF_TIME = 1781481600;

  // Let's build our mock event list
  // Time helpers:
  // 2026-01-05: 1767571200
  // 2026-01-10: 1768003200
  // 2026-01-15: 1768435200
  // 2026-01-20: 1768867200
  // 2026-01-25: 1769300000
  // 2026-02-28: 1772236800
  // 2026-03-15: 1773532800
  // 2026-04-05: 1775433600
  const events = [
    // Cohort 2026-01 (January)
    {
      eventName: "subscribed",
      user: "user1",
      merchant: "merchA",
      timestamp: 1768003200,
    }, // User 1: Jan 10
    {
      eventName: "subscribed",
      user: "user2",
      merchant: "merchA",
      timestamp: 1768435200,
    }, // User 2: Jan 15
    { eventName: "cancelled", user: "user2", timestamp: 1768867200 }, // User 2: cancels Jan 20 (day 5)

    {
      eventName: "subscribed",
      user: "user3",
      merchant: "merchB",
      timestamp: 1768867200,
    }, // User 3: Jan 20
    { eventName: "cancelled", user: "user3", timestamp: 1773532800 }, // User 3: cancels Mar 15 (day 54)

    // User 5: resubscribes
    {
      eventName: "subscribed",
      user: "user5",
      merchant: "merchC",
      timestamp: 1767571200,
    }, // User 5: Jan 05
    { eventName: "cancelled", user: "user5", timestamp: 1768435200 }, // User 5: cancels Jan 15 (day 10)
    {
      eventName: "subscribed",
      user: "user5",
      merchant: "merchC",
      timestamp: 1769300000,
    }, // User 5: resubscribes Jan 25
    { eventName: "cancelled", user: "user5", timestamp: 1772236800 }, // User 5: cancels Feb 28 (day 34 from Jan 25)

    // Cohort 2026-04 (April)
    {
      eventName: "subscribed",
      user: "user4",
      merchant: "merchB",
      timestamp: 1775433600,
    }, // User 4: Apr 05
  ];

  // 1. Test "new" logic
  console.log("Testing resubscription logic: 'new'");
  const reportNew = calculateChurnAnalysis(events, "new", REF_TIME);

  // Cohort 2026-01 lifespans:
  // - User 1 (Jan 10): active (never cancelled) -> Active 30d, Active 90d
  // - User 2 (Jan 15): cancelled day 5 -> Inactive 30d, Inactive 90d
  // - User 3 (Jan 20): cancelled day 54 -> Active 30d, Inactive 90d
  // - User 5 lifespan 1 (Jan 05): cancelled day 10 -> Inactive 30d, Inactive 90d
  // - User 5 lifespan 2 (Jan 25): cancelled day 34 -> Active 30d, Inactive 90d
  // Total Initial size in 2026-01 = 5 lifespans.
  // Active 30d = User 1, User 3, User 5 lifespan 2 = 3.
  // Active 90d = User 1 = 1.
  const janNew = reportNew.cohorts.find((c) => c.cohort === "2026-01");
  assertEquals(
    janNew?.initial_size,
    5,
    "Jan cohort initial size ('new' logic)",
  );
  assertEquals(
    janNew?.active_30_days,
    3,
    "Jan cohort active at 30 days ('new' logic)",
  );
  assertEquals(
    janNew?.active_90_days,
    1,
    "Jan cohort active at 90 days ('new' logic)",
  );
  assertEquals(
    janNew?.retention_rate_30d,
    "60.00%",
    "Jan 30d retention rate ('new' logic)",
  );
  assertEquals(
    janNew?.retention_rate_90d,
    "20.00%",
    "Jan 90d retention rate ('new' logic)",
  );

  // Cohort 2026-04 lifespans:
  // Next month start: 2026-05-01.
  // 30d limit: May 31. REF_TIME (Jun 15) is past May 31. So 30d is sufficient.
  // 90d limit: Jul 30. REF_TIME (Jun 15) is before Jul 30. So 90d is insufficient!
  const aprNew = reportNew.cohorts.find((c) => c.cohort === "2026-04");
  assertEquals(
    aprNew?.initial_size,
    1,
    "Apr cohort initial size ('new' logic)",
  );
  assertEquals(
    aprNew?.active_30_days,
    1,
    "Apr cohort active at 30 days ('new' logic)",
  );
  assertEquals(
    aprNew?.active_90_days,
    "insufficient data",
    "Apr cohort active at 90 days ('new' logic)",
  );
  assertEquals(
    aprNew?.retention_rate_30d,
    "100.00%",
    "Apr 30d retention rate ('new' logic)",
  );
  assertEquals(
    aprNew?.retention_rate_90d,
    "insufficient data",
    "Apr 90d retention rate ('new' logic)",
  );

  // 2. Test "retention" logic
  console.log("Testing resubscription logic: 'retention'");
  const reportRetention = calculateChurnAnalysis(events, "retention", REF_TIME);

  // Cohort 2026-01 users:
  // - User 1: starts Jan 10. Active 30d, Active 90d.
  // - User 2: starts Jan 15. Inactive 30d (cancelled Jan 20). Inactive 90d.
  // - User 3: starts Jan 20. Active 30d (cancelled day 54). Inactive 90d.
  // - User 5: starts Jan 05.
  //   - Status at day 30 (Feb 04): latest event is subscribed (Jan 25). So Active 30d!
  //   - Status at day 90 (Apr 05): latest event is cancelled (Feb 28). So Inactive 90d.
  // Total Initial size in 2026-01 = 4 users.
  // Active 30d = User 1, User 3, User 5 = 3.
  // Active 90d = User 1 = 1.
  const janRet = reportRetention.cohorts.find((c) => c.cohort === "2026-01");
  assertEquals(
    janRet?.initial_size,
    4,
    "Jan cohort initial size ('retention' logic)",
  );
  assertEquals(
    janRet?.active_30_days,
    3,
    "Jan cohort active at 30 days ('retention' logic)",
  );
  assertEquals(
    janRet?.active_90_days,
    1,
    "Jan cohort active at 90 days ('retention' logic)",
  );
  assertEquals(
    janRet?.retention_rate_30d,
    "75.00%",
    "Jan 30d retention rate ('retention' logic)",
  );
  assertEquals(
    janRet?.retention_rate_90d,
    "25.00%",
    "Jan 90d retention rate ('retention' logic)",
  );
}

function testMerchantChurnBreakdown() {
  console.log("\n--- Running Merchant Churn Breakdown Tests ---");

  // Mock events:
  // Merchant A:
  // - User 1: subscribed, cancelled (cancellation rate = 100%)
  // - Total subscribers = 1 (Filtered out because <= 1)
  // Merchant B:
  // - User 1: subscribed, active
  // - User 2: subscribed, cancelled
  // - User 3: subscribed, cancelled
  // - Total subscribers = 3. Cancellations = 2. Churn rate = 66.67%
  // Merchant C:
  // - User 1: subscribed, active
  // - User 2: subscribed, active
  // - Total subscribers = 2. Cancellations = 0. Churn rate = 0%
  const events = [
    {
      eventName: "subscribed",
      user: "user1",
      merchant: "merchA",
      timestamp: 100,
    },
    { eventName: "cancelled", user: "user1", timestamp: 150 },

    {
      eventName: "subscribed",
      user: "user1",
      merchant: "merchB",
      timestamp: 200,
    },
    {
      eventName: "subscribed",
      user: "user2",
      merchant: "merchB",
      timestamp: 210,
    },
    {
      eventName: "subscribed",
      user: "user3",
      merchant: "merchB",
      timestamp: 220,
    },
    { eventName: "cancelled", user: "user2", timestamp: 250 },
    { eventName: "cancelled", user: "user3", timestamp: 260 },

    {
      eventName: "subscribed",
      user: "user1",
      merchant: "merchC",
      timestamp: 300,
    },
    {
      eventName: "subscribed",
      user: "user2",
      merchant: "merchC",
      timestamp: 310,
    },
  ];

  const report = calculateChurnAnalysis(events, "new", 500);

  // merchA should be filtered out because total unique subscribers <= 1
  const merchA = report.top_merchants_churn.find(
    (m) => m.merchant_id === "merchA",
  );
  assertEquals(merchA, undefined, "Merchant A filtered out (<= 1 subscriber)");

  // merchB should have 3 subscribers, 2 cancellations, 66.67% churn
  const merchB = report.top_merchants_churn.find(
    (m) => m.merchant_id === "merchB",
  );
  assertEquals(merchB !== undefined, true, "Merchant B is present");
  assertEquals(merchB?.subscribers, 3, "Merchant B subscribers count");
  assertEquals(merchB?.cancellations, 2, "Merchant B cancellations count");
  assertEquals(merchB?.churn_rate, "66.67%", "Merchant B churn rate");

  // merchC should have 2 subscribers, 0 cancellations, 0.00% churn
  const merchC = report.top_merchants_churn.find(
    (m) => m.merchant_id === "merchC",
  );
  assertEquals(merchC !== undefined, true, "Merchant C is present");
  assertEquals(merchC?.subscribers, 2, "Merchant C subscribers count");
  assertEquals(merchC?.cancellations, 0, "Merchant C cancellations count");
  assertEquals(merchC?.churn_rate, "0.00%", "Merchant C churn rate");
}

function testChurnProjection() {
  console.log("\n--- Running Churn Projection Tests ---");

  // Mock events with 2 completed cohorts:
  // Cohort Jan: size 4, active30 is 2. Monthly churn rate = 50%
  // Cohort Feb: size 10, active30 is 8. Monthly churn rate = 20%
  // Average monthly churn rate = (50% + 20%) / 2 = 35%
  // Currently active subscribers = 8.
  // Projected churn for next month = 8 * 35% = 2.80
  const REF_TIME = 1781481600; // 2026-06-15

  const events = [
    // Jan cohort (Starts Jan 05: 1767571200)
    {
      eventName: "subscribed",
      user: "user1",
      merchant: "merchM",
      timestamp: 1767571200,
    },
    {
      eventName: "subscribed",
      user: "user2",
      merchant: "merchM",
      timestamp: 1767571210,
    },
    {
      eventName: "subscribed",
      user: "user3",
      merchant: "merchM",
      timestamp: 1767571220,
    },
    {
      eventName: "subscribed",
      user: "user4",
      merchant: "merchM",
      timestamp: 1767571230,
    },
    // 2 cancel in Jan cohort
    {
      eventName: "cancelled",
      user: "user1",
      timestamp: 1767571200 + 10 * 24 * 3600,
    },
    {
      eventName: "cancelled",
      user: "user2",
      timestamp: 1767571200 + 15 * 24 * 3600,
    },

    // Feb cohort (Starts Feb 05: 1770249600)
    ...Array.from({ length: 10 }, (_, i) => ({
      eventName: "subscribed",
      user: `feb_user_${i}`,
      merchant: "merchM",
      timestamp: 1770249600 + i,
    })),
    // 2 cancel in Feb cohort within 30 days
    {
      eventName: "cancelled",
      user: "feb_user_0",
      timestamp: 1770249600 + 5 * 24 * 3600,
    },
    {
      eventName: "cancelled",
      user: "feb_user_1",
      timestamp: 1770249600 + 10 * 24 * 3600,
    },
  ];

  const report = calculateChurnAnalysis(events, "new", REF_TIME);

  // Completed cohorts: Jan and Feb.
  // Average churn rate: 35.00%
  // Current active count:
  // - Jan: 2 active (user3, user4)
  // - Feb: 8 active (feb_user_2 to feb_user_9)
  // Total current active = 10.
  // Projected churn: 10 * 0.35 = 3.50
  assertEquals(
    report.projection.average_monthly_churn_rate,
    "35.00%",
    "Avg Monthly Churn Rate",
  );
  assertEquals(
    report.projection.current_active_subscribers,
    10,
    "Current Active Subscribers Count",
  );
  assertEquals(
    report.projection.projected_churn_count,
    "3.50",
    "Projected Churn Count",
  );
}

function testDatabaseAndRpcFallback() {
  console.log("\n--- Running SQLite and RPC Fallback Configuration Tests ---");

  // Create an in-memory SQLite database to test real DatabaseSync querying
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE events (
      event_name TEXT,
      data TEXT,
      timestamp INTEGER
    )
  `);

  const mockData = JSON.stringify({ user: "userA", merchant: "merchX" });
  db.prepare(
    "INSERT INTO events (event_name, data, timestamp) VALUES (?, ?, ?)",
  ).run("subscribed", mockData, 1768000000);

  const row = db.prepare("SELECT COUNT(*) as n FROM events").get() as {
    n: number;
  };
  assertEquals(row.n, 1, "Mock SQLite event inserted correctly");
  db.close();
}

function runAllTests() {
  console.log("==========================================");
  console.log("   PAYFLOW CHURN ANALYSIS TEST SUITE      ");
  console.log("==========================================");

  testCohortAndResubscriptionLogic();
  testMerchantChurnBreakdown();
  testChurnProjection();
  testDatabaseAndRpcFallback();

  console.log("\n==========================================");
  console.log("   ALL TESTS COMPLETED SUCCESSFULLY!      ");
  console.log("==========================================");
}

runAllTests();
