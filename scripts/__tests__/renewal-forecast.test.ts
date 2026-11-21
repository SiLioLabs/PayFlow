/**
 * Tests for scripts/lib/forecast.ts (pure math) and an end-to-end run of
 * scripts/renewal-forecast.ts against a seeded fixture SQLite DB.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  forecastRenewals,
  forecastSubscription,
  type ForecastReport,
  type SubscriptionSnapshot,
} from "../lib/forecast.js";

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86_400;
const MONTH = 30 * DAY;

function sub(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    user: "GTEST",
    amount: 1_000_000,
    interval: MONTH,
    last_charged: 1_700_000_000,
    active: true,
    paused: false,
    charge_history: [],
    ...overrides,
  };
}

describe("forecast math — renewal cases", () => {
  it("regular monthly history renews one mean interval after the last charge", () => {
    const t0 = 1_690_000_000;
    const entry = forecastSubscription(
      sub({ charge_history: [t0, t0 + MONTH, t0 + 2 * MONTH, t0 + 3 * MONTH], last_charged: t0 + 3 * MONTH }),
    );
    expect(entry.next_renewal).toBe(t0 + 4 * MONTH);
    expect(entry.confidence).toBe("high");
    // Zero std-dev clamps the band to ±10% of the interval.
    expect(entry.confidence_band).toEqual({
      low: t0 + 4 * MONTH - 0.1 * MONTH,
      high: t0 + 4 * MONTH + 0.1 * MONTH,
    });
  });

  it("anchors on the latest charge even when history is unsorted", () => {
    const entry = forecastSubscription(sub({ charge_history: [1_000 + 2 * DAY, 1_000, 1_000 + DAY] }));
    expect(entry.next_renewal).toBe(1_000 + 3 * DAY);
    expect(entry.confidence).toBe("medium");
  });

  it("falls back to last_charged + interval with no usable history", () => {
    const entry = forecastSubscription(sub({ charge_history: [] }));
    expect(entry.next_renewal).toBe(1_700_000_000 + MONTH);
    expect(entry.reason).toBe("no_charge_history_fallback_interval");
    expect(entry.confidence_band).toBeNull();
  });

  it("paused and inactive subscriptions never forecast a renewal", () => {
    expect(forecastSubscription(sub({ paused: true })).reason).toBe("subscription_paused");
    expect(forecastSubscription(sub({ active: false })).reason).toBe("subscription_inactive");
  });
});

describe("forecast math — grace cases", () => {
  it("an overdue subscription (inside its grace window) still forecasts from its last charge", () => {
    const lastCharged = 1_700_000_000;
    const now = new Date((lastCharged + MONTH + 3 * DAY) * 1000); // 3 days past due
    const report = forecastRenewals([sub({ last_charged: lastCharged })], now);
    const [entry] = report.forecasts;
    expect(entry.next_renewal).toBe(lastCharged + MONTH);
    expect(entry.next_renewal! * 1000).toBeLessThan(now.getTime());
    expect(report.forecastable).toBe(1);
    expect(report.generated_at).toBe(now.toISOString());
  });

  it("a late charge (paid during grace) widens the band instead of shifting the anchor", () => {
    const t0 = 1_690_000_000;
    const history = [t0, t0 + MONTH, t0 + 2 * MONTH + 5 * DAY]; // second renewal 5 days late
    const entry = forecastSubscription(sub({ charge_history: history, last_charged: history[2] }));
    const mean = (MONTH + MONTH + 5 * DAY) / 2;
    expect(entry.next_renewal).toBe(Math.round(history[2] + mean));
    const margin = entry.next_renewal! - entry.confidence_band!.low;
    expect(margin).toBeGreaterThan(0.1 * MONTH);
  });

  it("counts buckets without NaN across mixed fixtures", () => {
    const report = forecastRenewals([
      sub({ user: "GA" }),
      sub({ user: "GB", paused: true }),
      sub({ user: "GC", active: false }),
      sub({ user: "GD", amount: -1 }),
    ]);
    expect(report).toMatchObject({ total: 4, forecastable: 1, paused: 1, inactive: 1, insufficient_data: 1 });
    for (const f of report.forecasts) {
      if (f.next_renewal !== null) expect(Number.isFinite(f.next_renewal)).toBe(true);
    }
  });
});

describe("renewal-forecast.ts end-to-end against a fixture DB", () => {
  it("reads the subscriptions table and emits a JSON report", () => {
    const dir = mkdtempSync(join(tmpdir(), "payflow-forecast-"));
    try {
      const dbFile = join(dir, "fixture.db");
      const fixture = JSON.parse(
        readFileSync(join(scriptsDir, "fixtures", "renewal-forecast.json"), "utf8"),
      ) as SubscriptionSnapshot[];

      const db = new DatabaseSync(dbFile);
      db.exec(`CREATE TABLE subscriptions (
        user TEXT, amount INTEGER, interval INTEGER, last_charged INTEGER,
        active INTEGER, paused INTEGER, charge_history TEXT
      )`);
      const insert = db.prepare("INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const s of fixture) {
        insert.run(s.user, s.amount, s.interval, s.last_charged, s.active ? 1 : 0, s.paused ? 1 : 0, JSON.stringify(s.charge_history));
      }
      db.close();

      const stdout = execFileSync(
        process.execPath,
        ["--import", "tsx", join(scriptsDir, "renewal-forecast.ts"), "--db", dbFile, "--json"],
        { cwd: scriptsDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const report = JSON.parse(stdout) as ForecastReport;
      const expected = forecastRenewals(fixture);

      expect(report.total).toBe(fixture.length);
      expect({ ...report, generated_at: "" }).toEqual({ ...expected, generated_at: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
