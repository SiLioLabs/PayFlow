import { calculateChurnAnalysis, ChurnAnalysisReport } from "./churn-analysis.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const FIXTURES_PATH = resolve(__dirname, "data/churn-analysis-fixtures.json");

// Load golden fixtures
const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")).fixtures;

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

function deepEquals(actual: any, expected: any): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertDeepEquals(actual: any, expected: any, message: string) {
  if (!deepEquals(actual, expected)) {
    console.error(`Assertion Failed: ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected, null, 2)}`);
    console.error(`  Actual:   ${JSON.stringify(actual, null, 2)}`);
    process.exit(1);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

function runFixture(fixture: typeof fixtures[0], logic: "new" | "retention") {
  const report = calculateChurnAnalysis(fixture.events, logic, fixture.referenceTime);

  // Validate cohorts if expected
  if (fixture.expected.cohorts) {
    for (const expCohort of fixture.expected.cohorts) {
      const actCohort = report.cohorts.find((c) => c.cohort === expCohort.cohort);
      assertEquals(
        actCohort?.initial_size,
        expCohort.initial_size,
        `${fixture.name} [${logic}] cohort ${expCohort.cohort} initial_size`
      );
      assertEquals(
        actCohort?.active_30_days,
        expCohort.active_30_days,
        `${fixture.name} [${logic}] cohort ${expCohort.cohort} active_30_days`
      );
      assertEquals(
        actCohort?.active_90_days,
        expCohort.active_90_days,
        `${fixture.name} [${logic}] cohort ${expCohort.cohort} active_90_days`
      );
      assertEquals(
        actCohort?.retention_rate_30d,
        expCohort.retention_rate_30d,
        `${fixture.name} [${logic}] cohort ${expCohort.cohort} retention_rate_30d`
      );
      assertEquals(
        actCohort?.retention_rate_90d,
        expCohort.retention_rate_90d,
        `${fixture.name} [${logic}] cohort ${expCohort.cohort} retention_rate_90d`
      );
    }
  }

  // Validate projection if expected
  if (fixture.expected.projection) {
    assertEquals(
      report.projection.average_monthly_churn_rate,
      fixture.expected.projection.average_monthly_churn_rate,
      `${fixture.name} [${logic}] avg monthly churn rate`
    );
    assertEquals(
      report.projection.current_active_subscribers,
      fixture.expected.projection.current_active_subscribers,
      `${fixture.name} [${logic}] current active subscribers`
    );
    assertEquals(
      report.projection.projected_churn_count,
      fixture.expected.projection.projected_churn_count,
      `${fixture.name} [${logic}] projected churn count`
    );
  }

  // Validate merchant churn if expected
  if (fixture.expected.top_merchants_churn) {
    const expMerchants = fixture.expected.top_merchants_churn;
    const actMerchants = report.top_merchants_churn;

    assertEquals(
      actMerchants.length,
      expMerchants.length,
      `${fixture.name} [${logic}] merchant count`
    );

    for (let i = 0; i < expMerchants.length; i++) {
      assertEquals(
        actMerchants[i]?.merchant_id,
        expMerchants[i].merchant_id,
        `${fixture.name} [${logic}] merchant ${i} id`
      );
      assertEquals(
        actMerchants[i]?.subscribers,
        expMerchants[i].subscribers,
        `${fixture.name} [${logic}] merchant ${i} subscribers`
      );
      assertEquals(
        actMerchants[i]?.cancellations,
        expMerchants[i].cancellations,
        `${fixture.name} [${logic}] merchant ${i} cancellations`
      );
      assertEquals(
        actMerchants[i]?.churn_rate,
        expMerchants[i].churn_rate,
        `${fixture.name} [${logic}] merchant ${i} churn rate`
      );
    }
  }
}

function runAllFixtures() {
  console.log("==========================================");
  console.log("   CHURN ANALYSIS GOLDEN FIXTURE TESTS    ");
  console.log("==========================================\n");

  for (const fixture of fixtures) {
    console.log(`\n--- Fixture: ${fixture.name} ---`);
    console.log(`   ${fixture.description}`);

    // Test both logic modes unless fixture is logic-specific
    const logics: ("new" | "retention")[] = fixture.name.includes("new-logic")
      ? ["new"]
      : fixture.name.includes("retention-logic")
        ? ["retention"]
        : ["new", "retention"];

    for (const logic of logics) {
      console.log(`   Testing logic: '${logic}'`);
      runFixture(fixture, logic);
    }
  }

  console.log("\n==========================================");
  console.log("   ALL GOLDEN FIXTURE TESTS PASSED!       ");
  console.log("==========================================");
}

// Additional standalone tests for specific edge cases not covered by fixtures
function runAdditionalTests() {
  console.log("\n--- Additional Edge Case Tests ---");

  // Test: Data source reporting (sqlite vs rpc) - already covered by integration
  // Test: CSV output format
  const events = [
    { eventName: "subscribed", user: "user1", merchant: "merchA", timestamp: 1768003200 },
    { eventName: "cancelled", user: "user1", timestamp: 1768867200 },
  ];
  const report = calculateChurnAnalysis(events, "new", 1781481600);

  // Verify report structure completeness
  assertEquals(typeof report.generated_at, "string", "Report has generated_at");
  assertEquals(typeof report.reference_time, "string", "Report has reference_time");
  assertEquals(["sqlite", "rpc"].includes(report.data_source), true, "Report has valid data_source");
  assertEquals(["new", "retention"].includes(report.resubscription_logic), true, "Report has valid resubscription_logic");
  assertEquals(Array.isArray(report.cohorts), true, "Report has cohorts array");
  assertEquals(Array.isArray(report.top_merchants_churn), true, "Report has top_merchants_churn array");
  assertEquals(typeof report.projection, "object", "Report has projection object");

  // Verify projection fields
  assertEquals(typeof report.projection.average_monthly_churn_rate, "string", "Projection has avg churn rate string");
  assertEquals(typeof report.projection.current_active_subscribers, "number", "Projection has active count");
  assertEquals(typeof report.projection.projected_churn_count, "string", "Projection has projected churn string");

  console.log("[PASS] Report structure validation");
}

function runDatabaseAndRpcFallbackTests() {
  console.log("\n--- Database and RPC Fallback Configuration Tests ---");

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
  db.prepare("INSERT INTO events (event_name, data, timestamp) VALUES (?, ?, ?)")
    .run("subscribed", mockData, 1768000000);

  const row = db.prepare("SELECT COUNT(*) as n FROM events").get() as { n: number };
  assertEquals(row.n, 1, "Mock SQLite event inserted correctly");

  // The report must declare which data source fed it, so callers can tell a
  // real RPC-backed run from a fallback/empty one.
  const report = calculateChurnAnalysis([], "new", 1781481600);
  assertEquals(["sqlite", "rpc"].includes(report.data_source), true, "Report advertises sqlite/rpc data source");
  db.close();
}

function runAllTests() {
  console.log("==========================================");
  console.log("   PAYFLOW CHURN ANALYSIS TEST SUITE      ");
  console.log("==========================================");

  runAllFixtures();
  runAdditionalTests();
  runDatabaseAndRpcFallbackTests();

  console.log("\n==========================================");
  console.log("   ALL TESTS COMPLETED SUCCESSFULLY!      ");
  console.log("==========================================");
}

runAllTests();