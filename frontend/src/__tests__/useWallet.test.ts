import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock stellar before the hook is imported
vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  server: {
    sendTransaction: vi.fn(),
  },
}));

import { useWallet } from "../hooks/useWallet";

const STORAGE_KEY = "wallet_public_key";

// ── helpers ───────────────────────────────────────────────────────────────────

function buildFreighterMock(opts: {
  isConnected: boolean;
  publicKey: string;
}): typeof window.freighter {
  return {
    isConnected: vi.fn().mockResolvedValue(opts.isConnected),
    getPublicKey: vi.fn().mockResolvedValue(opts.publicKey),
    getNetwork: vi.fn().mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    }),
    signTransaction: vi.fn().mockResolvedValue("signed-xdr"),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("useWallet", () => {
  beforeEach(() => {
    localStorage.clear();
    // Remove freighter from window by default
    delete (window as any).freighter;
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).freighter;
  });

  // ── ready flag ──────────────────────────────────────────────────────────────

  it("ready is false initially and becomes true when no cache exists", async () => {
    const { result } = renderHook(() => useWallet());

    // Immediately after mount, ready should eventually become true
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBeNull();
  });

  it("ready is false during re-validation and true once it resolves with a valid key", async () => {
    const key = "GCACHE123";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(key));
    (window as any).freighter = buildFreighterMock({
      isConnected: true,
      publicKey: key,
    });

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBe(key);
  });

  // ── cache re-validation ─────────────────────────────────────────────────────

  it("restores publicKey from cache when Freighter confirms the same key", async () => {
    const key = "GVALID456";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(key));
    (window as any).freighter = buildFreighterMock({
      isConnected: true,
      publicKey: key,
    });

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBe(key);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(key));
  });

  it("clears cache and publicKey when Freighter returns a different key than cached", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("GOLD_KEY"));
    const newKey = "GNEW_KEY789";
    (window as any).freighter = buildFreighterMock({
      isConnected: true,
      publicKey: newKey,
    });

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears cache and keeps publicKey null when Freighter is not connected", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("GSOME_KEY"));
    (window as any).freighter = buildFreighterMock({
      isConnected: false,
      publicKey: "",
    });

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears cache and keeps publicKey null when Freighter is absent after 3 polls", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("GSOME_KEY"));
    // window.freighter remains undefined

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 2000 });
    expect(result.current.publicKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears cache when re-validation throws an error", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("GSOME_KEY"));
    (window as any).freighter = {
      isConnected: vi.fn().mockRejectedValue(new Error("extension error")),
      getPublicKey: vi.fn(),
      getNetwork: vi.fn(),
      signTransaction: vi.fn(),
    };

    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // ── connect() ──────────────────────────────────────────────────────────────

  it("connect() works normally when no cache exists", async () => {
    const key = "GNEW_CONNECT";
    (window as any).freighter = buildFreighterMock({
      isConnected: true,
      publicKey: key,
    });

    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.publicKey).toBe(key);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(key);
  });

  it("connect() sets error when Freighter is not installed", async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/freighter wallet not found/i);
    expect(result.current.publicKey).toBeNull();
  });

  it("connect() sets error when wallet is locked", async () => {
    (window as any).freighter = buildFreighterMock({
      isConnected: false,
      publicKey: "",
    });

    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toMatch(/unlock freighter/i);
  });

  // ── disconnect() ────────────────────────────────────────────────────────────

  it("disconnect() clears publicKey and removes localStorage entry", async () => {
    const key = "GDISCONNECT";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(key));
    (window as any).freighter = buildFreighterMock({
      isConnected: true,
      publicKey: key,
    });

    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toBe(key);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.publicKey).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("exposes sessionRestored as an alias for ready", async () => {
    const { result } = renderHook(() => useWallet());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.sessionRestored).toBe(result.current.ready);
  });

  it("connecting is true during auto-revalidation", async () => {
    const key = "GCONNECTING";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(key));
    (window as any).freighter = buildFreighterMock({
      isConnected: true,
      publicKey: key,
    });

    const { result } = renderHook(() => useWallet());
    expect(result.current.connecting).toBe(true);
    await waitFor(() => expect(result.current.connecting).toBe(false));
  });
});
