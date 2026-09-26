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
import { normalizeEnv, getDeprecationWarnings } from "./config.js";

describe("config normalization", () => {
  beforeEach(() => {
    // Clear warnings between tests (mock reset)
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
