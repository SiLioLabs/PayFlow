/**
 * config.test.ts — Tests for environment configuration normalization and validation
 *
 * Validates:
 * 1. Secret key alias resolution (KEEPER_SECRET → SECRET_KEY)
 * 2. Network passphrase alias resolution (NETWORK_PASSTHRASE → NETWORK_PASSPHRASE)
 * 3. Deprecation warnings are emitted when aliases are used
 * 4. Canonical names take precedence over aliases
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  normalizeEnv,
  getDeprecationWarnings,
  clearDeprecationWarnings,
  ConfigSchema,
  PUBLIC_NETWORK_PASSPHRASE,
  mainnetGateError,
  redactSecret,
  publicKeyMismatchError,
} from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("config normalization", () => {
  beforeEach(() => {
    clearDeprecationWarnings();
  });

  describe("SECRET_KEY / KEEPER_SECRET alias", () => {
    it("should use SECRET_KEY when provided", () => {
      const env = { SECRET_KEY: "S123" };
      const normalized = normalizeEnv(env);
      expect(normalized.SECRET_KEY).toBe("S123");
    });

    it("should fall back to KEEPER_SECRET if SECRET_KEY is missing", () => {
      const env = { KEEPER_SECRET: "S456" };
      const normalized = normalizeEnv(env);
      expect(normalized.SECRET_KEY).toBe("S456");
      expect(getDeprecationWarnings()).toContainEqual(
        expect.stringContaining("KEEPER_SECRET is deprecated"),
      );
    });

    it("should prefer SECRET_KEY over KEEPER_SECRET when both are present", () => {
      const env = { SECRET_KEY: "S789", KEEPER_SECRET: "S456" };
      const normalized = normalizeEnv(env);
      expect(normalized.SECRET_KEY).toBe("S789");
      // No warning should be emitted when canonical name is used
      const warnings = getDeprecationWarnings();
      expect(warnings.length).toBe(0);
    });
  });

  describe("NETWORK_PASSPHRASE / NETWORK_PASSTHRASE alias (typo)", () => {
    it("should use NETWORK_PASSPHRASE when provided", () => {
      const env = { NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" };
      const normalized = normalizeEnv(env);
      expect(normalized.NETWORK_PASSPHRASE).toBe(
        "Public Global Stellar Network ; September 2015",
      );
    });

    it("should fall back to NETWORK_PASSTHRASE if NETWORK_PASSPHRASE is missing", () => {
      const env = { NETWORK_PASSTHRASE: "Test SDF Network ; September 2015" };
      const normalized = normalizeEnv(env);
      expect(normalized.NETWORK_PASSPHRASE).toBe("Test SDF Network ; September 2015");
      expect(getDeprecationWarnings()).toContainEqual(
        expect.stringContaining("NETWORK_PASSTHRASE is deprecated"),
      );
    });

    it("should prefer NETWORK_PASSPHRASE over NETWORK_PASSTHRASE when both are present", () => {
      const env = {
        NETWORK_PASSPHRASE: "Correct Passphrase",
        NETWORK_PASSTHRASE: "Typo Passphrase",
      };
      const normalized = normalizeEnv(env);
      expect(normalized.NETWORK_PASSPHRASE).toBe("Correct Passphrase");
      const warnings = getDeprecationWarnings();
      expect(warnings.length).toBe(0);
    });
  });

  describe("combined scenarios", () => {
    it("should normalize both aliases when both are missing", () => {
      const env = { KEEPER_SECRET: "S111", NETWORK_PASSTHRASE: "Test Passphrase" };
      const normalized = normalizeEnv(env);
      expect(normalized.SECRET_KEY).toBe("S111");
      expect(normalized.NETWORK_PASSPHRASE).toBe("Test Passphrase");
      const warnings = getDeprecationWarnings();
      expect(warnings.length).toBe(2);
    });

    it("should not emit warnings when only canonical names are used", () => {
      const env = { SECRET_KEY: "S222", NETWORK_PASSPHRASE: "Correct" };
      const normalized = normalizeEnv(env);
      const warnings = getDeprecationWarnings();
      expect(warnings.length).toBe(0);
    });
  });
});

describe("docs parity: SCRIPTS-ENVIRONMENT.md vs ConfigSchema", () => {
  /** Extract canonical variable names from the ConfigSchema shape. */
  function getSchemaKeys(): string[] {
    const shape = ConfigSchema.shape;
    return Object.keys(shape).filter((k) => !["WEBHOOK_URL", "WEBHOOK_SECRET", "WEBHOOK_DLQ_FILE", "NETWORK_PASSPHRASE"].includes(k));
  }

  /** Extract variable names from the docs/SCRIPTS-ENVIRONMENT.md canonical table. */
  function getDocKeys(): string[] {
    const docPath = join(__dirname, "..", "docs", "SCRIPTS-ENVIRONMENT.md");
    const content = readFileSync(docPath, "utf8");
    // Match the canonical variables table rows (lines starting with | `VAR_NAME` |)
    const rows = content.match(/\|\s*`([A-Z_]+)`\s*\|/g) || [];
    return rows
      .map((r) => r.match(/`([A-Z_]+)`/)?.[1])
      .filter((v): v is string => !!v)
      .filter((v) => !["WEBHOOK_URL", "WEBHOOK_SECRET", "WEBHOOK_DLQ_FILE", "NETWORK_PASSPHRASE", "KEEPER_SECRET", "NETWORK_PASSTHRASE", "CHARGE_INTERVAL_MS", "PAGE_SIZE", "MAX_RETRIES", "KEEPER_PUBLIC_KEY", "DRY_RUN", "KEEPER_USE_LEGACY_PAGING", "LOG_LEVEL", "LOG_FORMAT", "DATA_DIR", "DB_FILE", "POLL_INTERVAL_MS", "START_LEDGER", "METRICS_PORT", "REPORT_DIR", "ALERT_WINDOW_LEDGERS", "SOROBAN_SOURCE_ACCOUNT"].includes(v));
  }

  it("every canonical schema key is documented in SCRIPTS-ENVIRONMENT.md", () => {
    const schemaKeys = getSchemaKeys();
    const docKeys = getDocKeys();
    const missing = schemaKeys.filter((k) => !docKeys.includes(k));
    expect(missing).toEqual([]);
  });
});

// The following suites port the security assertions of the retired root-level
// `keeper-config.ts` / `config.test.ts` onto the canonical implementations.
describe("mainnet safety gate (ALLOW_MAINNET)", () => {
  it("accepts testnet without ALLOW_MAINNET", () => {
    expect(mainnetGateError("Test SDF Network ; September 2015", false)).toBeNull();
    expect(mainnetGateError(undefined, false)).toBeNull();
  });

  it("blocks mainnet without ALLOW_MAINNET", () => {
    const error = mainnetGateError(PUBLIC_NETWORK_PASSPHRASE, false);
    expect(error).toContain("Mainnet");
    expect(error).toContain("ALLOW_MAINNET");
    expect(error).toContain("ALLOW_MAINNET=true");
  });

  it("allows mainnet with ALLOW_MAINNET=true", () => {
    expect(mainnetGateError(PUBLIC_NETWORK_PASSPHRASE, true)).toBeNull();
  });
});

describe("redactSecret", () => {
  const keypair = Keypair.random();
  const secret = keypair.secret();

  it("never exposes the full secret", () => {
    const redacted = redactSecret(secret);
    expect(redacted).not.toContain(secret);
    expect(redacted).toBe("S" + "*".repeat(8) + secret.slice(-4));
  });

  it("leaves text without a secret key unchanged", () => {
    expect(redactSecret("not a secret")).toBe("not a secret");
  });

  it("redacts a realistic Stellar secret key embedded in a string", () => {
    const input = `keeper starting with secret=${secret} end`;
    const result = redactSecret(input);
    expect(result).not.toContain(secret);
    expect(result).toMatch(/S\*{8}/);
  });

  it("preserves the last 4 characters of the key in the redacted form", () => {
    const result = redactSecret(secret);
    expect(result.endsWith(secret.slice(-4))).toBe(true);
  });

  it("does not match strings that contain invalid base32 chars (0, 1, 8, 9)", () => {
    // Regression coverage ported from the retired root keeper-config tests
    // (issue #1293): the pattern must use the exact base32 alphabet
    // [A-Z2-7]. Strings built from 0/1/8/9 are structurally impossible
    // Stellar keys and must pass through unchanged.
    const fakes = [
      "S" + "0".repeat(55),
      "S" + "1".repeat(55),
      "S" + "8".repeat(55),
      "S" + "9".repeat(55),
    ];
    for (const fake of fakes) {
      expect(redactSecret(fake)).toBe(fake);
    }
  });

  it("produces a masked value with the correct structure (S + 8 asterisks + 4 suffix chars)", () => {
    const result = redactSecret(secret);
    expect(result.length).toBe(13);
    expect(result[0]).toBe("S");
    expect(result.slice(1, 9)).toBe("********");
    expect(result.slice(9)).toBe(secret.slice(-4));
  });
});

describe("publicKeyMismatchError", () => {
  const keypair = Keypair.random();

  it("accepts a matching KEEPER_PUBLIC_KEY", () => {
    expect(publicKeyMismatchError(keypair.secret(), keypair.publicKey())).toBeNull();
  });

  it("rejects a KEEPER_PUBLIC_KEY that does not match the secret", () => {
    const otherPublicKey = Keypair.random().publicKey();
    expect(publicKeyMismatchError(keypair.secret(), otherPublicKey)).toContain(
      "does not match",
    );
  });

  it("skips the check when a value is absent or the secret is malformed", () => {
    expect(publicKeyMismatchError(undefined, keypair.publicKey())).toBeNull();
    expect(publicKeyMismatchError(keypair.secret(), undefined)).toBeNull();
    expect(
      publicKeyMismatchError("not-a-stellar-secret", keypair.publicKey()),
    ).toBeNull();
  });
});
