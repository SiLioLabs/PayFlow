import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  AppConfigSchema,
  KeeperConfigSchema,
  AlertsConfigSchema,
  buildConfigFromEnv,
  ConfigValidationError,
  loadConfig,
  validateConfigForScript,
} from "../config.js";

type EnvStore = typeof process.env;
const SAVED_ENV_KEYS = new Set<string>();
function setEnv(key: string, value: string | undefined): void {
  SAVED_ENV_KEYS.add(key);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
function restoreEnv(keys: Set<string>): void {
  for (const k of keys) delete process.env[k];
}

const VALID_MIN = {
  STELLAR_NETWORK: "testnet",
  RPC_URL: "https://soroban-testnet.stellar.org:443",
  CONTRACT_ID: "GBVKI5GZ5X4OY33I2ADY2X3W4K7U6S5Q4W3E2R2T7Y9U8I7O6P5",
};

const VALID_SADDR = "SBVKI5GZ5X4OY33I2ADY2X3W4K7U6S5Q4W3E2R2T7Y9U8I7O6P5";

function mkEnv(overrides: Record<string, string> = {}): EnvStore {
  return { ...process.env, ...VALID_MIN, ...overrides };
}

describe("AppConfigSchema zod validations", () => {
  afterEach(() => {
    restoreEnv(SAVED_ENV_KEYS);
    SAVED_ENV_KEYS.clear();
  });

  it("accepts a valid minimal config", () => {
    const env = mkEnv();
    const raw = buildConfigFromEnv(env);
    const result = AppConfigSchema.safeParse(raw);
    assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error.issues));
    if (result.success) {
      assert.equal(result.data.STELLAR_NETWORK, "testnet");
      assert.equal(result.data.RPC_URL, VALID_MIN.RPC_URL);
      assert.equal(result.data.CONTRACT_ID, VALID_MIN.CONTRACT_ID);
    }
  });

  it("rejects an invalid STELLAR_NETWORK enum", () => {
    const env = mkEnv({ STELLAR_NETWORK: "rinkeby" });
    const raw = buildConfigFromEnv(env);
    const result = AppConfigSchema.safeParse(raw);
    assert.equal(result.success, false);
    if (!result.success) {
      const pathHit = result.error.issues.some((i) => i.path.includes("STELLAR_NETWORK"));
      assert.equal(pathHit, true);
    }
  });

  it("rejects RPC_URL with invalid protocol", () => {
    const env = mkEnv({ RPC_URL: "ftp://bad.example.com" });
    const raw = buildConfigFromEnv(env);
    const result = AppConfigSchema.safeParse(raw);
    assert.equal(result.success, false);
  });

  it("rejects RPC_URL missing scheme", () => {
    const env = mkEnv({ RPC_URL: "soroban-testnet.stellar.org" });
    const raw = buildConfigFromEnv(env);
    const result = AppConfigSchema.safeParse(raw);
    assert.equal(result.success, false);
  });

  it("rejects CONTRACT_ID with wrong Stellar address format", () => {
    const env = mkEnv({ CONTRACT_ID: "NOT_A_STELLAR_ADDRESS" });
    const raw = buildConfigFromEnv(env);
    const result = AppConfigSchema.safeParse(raw);
    assert.equal(result.success, false);
  });

  it("rejects CONTRACT_ID with wrong checksum length", () => {
    const env = mkEnv({ CONTRACT_ID: "G123" });
    const raw = buildConfigFromEnv(env);
    const result = AppConfigSchema.safeParse(raw);
    assert.equal(result.success, false);
  });
});

describe("KeeperConfigSchema zod failures", () => {
  it("rejects a PRIVATE_KEY with wrong format (G-addr instead of S-addr)", () => {
    const result = KeeperConfigSchema.safeParse({
      PRIVATE_KEY: VALID_MIN.CONTRACT_ID,
    });
    assert.equal(result.success, false);
  });

  it("rejects MAX_BATCH_SIZE over 1000 (network safety cap)", () => {
    const result = KeeperConfigSchema.safeParse({
      PRIVATE_KEY: "SBVKI5GZ5X4OY33I2ADY2X3W4K7U6S5Q4W3E2R1T0Y9U8I7O6P5",
      MAX_BATCH_SIZE: 9999,
    });
    assert.equal(result.success, false);
  });

  it("rejects negative POLL_INTERVAL_MS", () => {
    const result = KeeperConfigSchema.safeParse({
      PRIVATE_KEY: "SBVKI5GZ5X4OY33I2ADY2X3W4K7U6S5Q4W3E2R1T0Y9U8I7O6P5",
      POLL_INTERVAL_MS: -1,
    });
    assert.equal(result.success, false);
  });

  it("coerces DRY_RUN string values to boolean", () => {
    const r1 = KeeperConfigSchema.safeParse({
      PRIVATE_KEY: "SBVKI5GZ5X4OY33I2ADY2X3W4K7U6S5Q4W3E2R1T0Y9U8I7O6P5",
      DRY_RUN: "true",
    });
    assert.equal(r1.success, true);
    const r2 = KeeperConfigSchema.safeParse({
      PRIVATE_KEY: "SBVKI5GZ5X4OY33I2ADY2X3W4K7U6S5Q4W3E2R1T0Y9U8I7O6P5",
      DRY_RUN: "1",
    });
    assert.equal(r2.success, true);
  });
});

describe("AlertsConfigSchema zod failures", () => {
  it("rejects configuration when zero alerting channels are provided", () => {
    const result = AlertsConfigSchema.safeParse({});
    assert.equal(result.success, false);
  });

  it("accepts config with only SLACK_WEBHOOK_URL", () => {
    const result = AlertsConfigSchema.safeParse({
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/AAA/BBB/ccc",
    });
    assert.equal(result.success, true);
  });

  it("rejects FEE_BPS_THRESHOLD over 10000", () => {
    const result = AlertsConfigSchema.safeParse({
      ALERT_EMAIL: "admin@example.com",
      FEE_BPS_THRESHOLD: 50000,
    });
    assert.equal(result.success, false);
  });
});

describe("loadConfig() error formatting (human-readable)", () => {
  afterEach(() => {
    restoreEnv(SAVED_ENV_KEYS);
    SAVED_ENV_KEYS.clear();
  });

  it("ConfigValidationError message is human-readable with numbered issues", () => {
    setEnv("STELLAR_NETWORK", "bogus");
    setEnv("RPC_URL", undefined);
    setEnv("CONTRACT_ID", "NOT-A-VALID-ADDRESS");
    try {
      loadConfig({ strict: true, scriptName: "testscript" });
      assert.fail("expected ConfigValidationError");
    } catch (err) {
      assert.ok(err instanceof ConfigValidationError);
      const msg = err.message;
      assert.ok(msg.includes("[testscript]"), "script name prefix included");
      assert.ok(msg.includes("[1]"), "issues numbered starting at 1");
      assert.ok(err.issues.length >= 2, "at least 2 issues");
    }
  });

  it("validateConfigForScript alias enforces strict mode", () => {
    setEnv("STELLAR_NETWORK", VALID_MIN.STELLAR_NETWORK);
    setEnv("RPC_URL", VALID_MIN.RPC_URL);
    setEnv("CONTRACT_ID", VALID_MIN.CONTRACT_ID);
    const cfg = validateConfigForScript("stats-alias");
    assert.equal(cfg.STELLAR_NETWORK, "testnet");
  });
});
