import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isMainnetPassphrase,
  MAINNET_CONFIRM_KEY,
  isMainnetConfirmed,
  setMainnetConfirmed,
  clearMainnetConfirmed,
  ensureMainnetConfirmed,
} from "../utils/network";

describe("isMainnetPassphrase", () => {
  it("detects public mainnet passphrase", () => {
    expect(isMainnetPassphrase("Public Global Stellar Network ; September 2015")).toBe(true);
  });

  it("detects testnet as not mainnet", () => {
    expect(isMainnetPassphrase("Test SDF Network ; September 2015")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMainnetPassphrase("")).toBe(false);
  });
});

describe("mainnet confirmation persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("isMainnetConfirmed false initially", () => {
    expect(isMainnetConfirmed()).toBe(false);
  });

  it("setMainnetConfirmed persists flag", () => {
    setMainnetConfirmed();
    expect(isMainnetConfirmed()).toBe(true);
    expect(sessionStorage.getItem(MAINNET_CONFIRM_KEY)).toBe("true");
  });

  it("clearMainnetConfirmed removes flag", () => {
    setMainnetConfirmed();
    clearMainnetConfirmed();
    expect(isMainnetConfirmed()).toBe(false);
  });
});

describe("ensureMainnetConfirmed", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("allows when not mainnet without prompting", async () => {
    // By default NETWORK_PASSPHRASE is testnet, so ensureMainnetConfirmed returns true without calling confirmFn
    const confirmFn = vi.fn(() => false);
    const result = ensureMainnetConfirmed(confirmFn);
    expect(result).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("prompts and persists when mainnet and not yet confirmed (mocked)", async () => {
    // Simulate mainnet by temporarily mocking isMainnetNetwork via stellar module
    // We test the confirmFn injection path directly: force mainnet via mock
    vi.resetModules();
    // Mock stellar to force mainnet passphrase
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" };
    });
    const { ensureMainnetConfirmed: ensureMainnetMocked } = await import("../utils/network");
    sessionStorage.clear();
    const confirmFn = vi.fn(() => true);
    const result = ensureMainnetMocked(confirmFn);
    expect(result).toBe(true);
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(MAINNET_CONFIRM_KEY)).toBe("true");
    // Second call should not prompt again
    const confirmFn2 = vi.fn(() => false);
    const result2 = ensureMainnetMocked(confirmFn2);
    expect(result2).toBe(true);
    expect(confirmFn2).not.toHaveBeenCalled();
  });

  it("returns false when user cancels confirm on mainnet", async () => {
    vi.resetModules();
    vi.doMock("../stellar", async () => {
      const actual = (await vi.importActual("../stellar")) as Record<string, unknown>;
      return { ...actual, NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" };
    });
    const { ensureMainnetConfirmed: ensureMainnetMocked2 } = await import("../utils/network");
    sessionStorage.clear();
    const confirmFn = vi.fn(() => false);
    const result = ensureMainnetMocked2(confirmFn);
    expect(result).toBe(false);
    expect(sessionStorage.getItem(MAINNET_CONFIRM_KEY)).toBeNull();
  });
});
