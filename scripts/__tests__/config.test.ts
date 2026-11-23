/**
 * scripts/__tests__/config.test.ts
 *
 * Tests for issue #1476: Secure keeper signing key loading.
 *
 * Covers:
 *  - File-based secret (KEEPER_SECRET_FILE) → happy path
 *  - File-based secret → missing file error
 *  - File-based secret → empty file error
 *  - KEEPER_SECRET env var → loaded correctly
 *  - KEEPER_SECRET env var on mainnet → logs a warning
 *  - SECRET_KEY legacy fallback
 *  - SECRET_KEY on mainnet → logs a warning
 *  - No secret configured → throws
 *  - loadFeeBumpSecret → file and env-var paths
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Networks } from "@stellar/stellar-sdk";

// Store the original process.env
const originalEnv = { ...process.env };

function clearSecretEnv(): void {
  delete process.env.KEEPER_SECRET_FILE;
  delete process.env.KEEPER_SECRET;
  delete process.env.SECRET_KEY;
  delete process.env.FEE_BUMP_SECRET_FILE;
  delete process.env.FEE_BUMP_SECRET;
  delete process.env.NETWORK_PASSPHRASE;
}

afterEach(() => {
  // Restore env after every test
  Object.assign(process.env, originalEnv);
  vi.restoreAllMocks();
  vi.resetModules();
});

beforeEach(() => {
  clearSecretEnv();
  vi.resetModules();
});

// ── loadSecret ────────────────────────────────────────────────────────────────

describe("loadSecret — file-based (KEEPER_SECRET_FILE)", () => {
  it("reads the secret from the file when KEEPER_SECRET_FILE is set", async () => {
    const tmpFile = join(tmpdir(), `payflow-test-secret-${Date.now()}`);
    writeFileSync(tmpFile, "STEST_SECRET_VALUE\n");

    process.env.KEEPER_SECRET_FILE = tmpFile;
    // Dynamically re-import to pick up new env
    const { loadSecret } = await import("../config");
    expect(loadSecret()).toBe("STEST_SECRET_VALUE");

    unlinkSync(tmpFile);
  });

  it("throws when KEEPER_SECRET_FILE points to a missing file", async () => {
    process.env.KEEPER_SECRET_FILE = "/tmp/does-not-exist-xyz";
    const { loadSecret } = await import("../config");
    expect(() => loadSecret()).toThrow(/Failed to read KEEPER_SECRET_FILE/);
  });

  it("throws when KEEPER_SECRET_FILE points to an empty file", async () => {
    const tmpFile = join(tmpdir(), `payflow-test-empty-${Date.now()}`);
    writeFileSync(tmpFile, "   \n");

    process.env.KEEPER_SECRET_FILE = tmpFile;
    const { loadSecret } = await import("../config");
    expect(() => loadSecret()).toThrow(/empty/i);

    unlinkSync(tmpFile);
  });
});

describe("loadSecret — KEEPER_SECRET env var", () => {
  it("returns KEEPER_SECRET when set", async () => {
    process.env.KEEPER_SECRET = "SENV_KEEPER_SECRET";
    const { loadSecret } = await import("../config");
    expect(loadSecret()).toBe("SENV_KEEPER_SECRET");
  });

  it("logs a warning when KEEPER_SECRET is used on mainnet", async () => {
    process.env.KEEPER_SECRET = "SMAINNET_SECRET";
    process.env.NETWORK_PASSPHRASE = Networks.PUBLIC;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadSecret } = await import("../config");
    loadSecret();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("KEEPER_SECRET env variable on mainnet")
    );
  });

  it("does not warn when KEEPER_SECRET is used on testnet", async () => {
    process.env.KEEPER_SECRET = "STEST_SECRET";
    process.env.NETWORK_PASSPHRASE = Networks.TESTNET;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadSecret } = await import("../config");
    loadSecret();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("loadSecret — SECRET_KEY legacy fallback", () => {
  it("falls back to SECRET_KEY when KEEPER_SECRET is absent", async () => {
    process.env.SECRET_KEY = "SLEGACY_SECRET_KEY";
    const { loadSecret } = await import("../config");
    expect(loadSecret()).toBe("SLEGACY_SECRET_KEY");
  });

  it("logs a warning when SECRET_KEY is used on mainnet", async () => {
    process.env.SECRET_KEY = "SLEGACY_MAINNET";
    process.env.NETWORK_PASSPHRASE = Networks.PUBLIC;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadSecret } = await import("../config");
    loadSecret();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SECRET_KEY env variable on mainnet")
    );
  });
});

describe("loadSecret — no secret configured", () => {
  it("throws when no secret source is available", async () => {
    const { loadSecret } = await import("../config");
    expect(() => loadSecret()).toThrow(/No keeper signing secret configured/);
  });
});

// ── loadFeeBumpSecret ─────────────────────────────────────────────────────────

describe("loadFeeBumpSecret", () => {
  it("returns null when no fee-bump secret is configured", async () => {
    const { loadFeeBumpSecret } = await import("../config");
    expect(loadFeeBumpSecret()).toBeNull();
  });

  it("reads from FEE_BUMP_SECRET_FILE when set", async () => {
    const tmpFile = join(tmpdir(), `payflow-fee-bump-${Date.now()}`);
    writeFileSync(tmpFile, "SFEE_BUMP_SECRET\n");

    process.env.FEE_BUMP_SECRET_FILE = tmpFile;
    const { loadFeeBumpSecret } = await import("../config");
    expect(loadFeeBumpSecret()).toBe("SFEE_BUMP_SECRET");

    unlinkSync(tmpFile);
  });

  it("falls back to FEE_BUMP_SECRET env var", async () => {
    process.env.FEE_BUMP_SECRET = "SFEE_BUMP_ENV";
    const { loadFeeBumpSecret } = await import("../config");
    expect(loadFeeBumpSecret()).toBe("SFEE_BUMP_ENV");
  });

  it("logs a warning when FEE_BUMP_SECRET env var is used on mainnet", async () => {
    process.env.FEE_BUMP_SECRET = "SFEE_BUMP_MAINNET";
    process.env.NETWORK_PASSPHRASE = Networks.PUBLIC;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadFeeBumpSecret } = await import("../config");
    loadFeeBumpSecret();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("FEE_BUMP_SECRET env variable on mainnet")
    );
  });
});
