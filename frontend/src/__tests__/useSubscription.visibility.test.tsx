import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSubscription } from "../hooks/useSubscription";
import * as stellar from "../stellar";
import React from "react";

vi.mock("../stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof stellar>();
  return {
    ...actual,
    getSubscription: vi.fn(),
  };
});

vi.mock("../context/RpcHealthContext", () => ({
  useRpcHealthContext: vi.fn(() => ({
    healthy: true,
    circuitOpen: false,
    error: null,
    activeRpcUrl: "https://soroban-testnet.stellar.org",
    customRpcUrl: null,
    setCustomRpcUrl: () => {},
  })),
}));

describe("useSubscription visibility refresh (#1253)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>;

  it("registers exactly one visibility refresh: one getSubscription call per focus event", async () => {
    const mockGetSubscription = vi.mocked(stellar.getSubscription);
    mockGetSubscription.mockResolvedValue(null);

    const { result } = renderHook(() => useSubscription("GUSER123"), { wrapper });

    // Initial fetch on mount
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetSubscription).toHaveBeenCalledTimes(1);

    // A single focus event must trigger exactly one re-fetch (5s cooldown respected).
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetSubscription).toHaveBeenCalledTimes(2);

    // Rapid second focus within cooldown must not double-fetch.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetSubscription).toHaveBeenCalledTimes(2);

    // Keep hook alive so unmount cleanup runs without errors.
    expect(result.current.loading).toBe(false);
  });
});
