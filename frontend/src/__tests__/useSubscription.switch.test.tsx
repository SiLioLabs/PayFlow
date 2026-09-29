import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSubscription } from "../hooks/useSubscription";
import * as stellar from "../stellar";
import { RpcHealthContext } from "../context/RpcHealthContext";
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
    status: "healthy",
    latencyMs: 100,
    error: null,
    circuitOpen: false,
    lastCheck: Date.now()
  })),
}));

describe("useSubscription user switch behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>;

  it("synchronously clears subscription data and shows loading state on userKey change", async () => {
    const mockGetSubscription = vi.mocked(stellar.getSubscription);
    
    // Setup first user
    const firstUser = "GUSER123";
    const subData1 = { merchant: "GMERCHANT1", amount: "5000", interval: 3600, active: true } as any;
    
    // First call returns data for user 1
    mockGetSubscription.mockImplementation(async (key) => {
      if (key === firstUser) return subData1;
      return null;
    });

    const { result, rerender } = renderHook(
      ({ userKey }) => useSubscription(userKey),
      { initialProps: { userKey: firstUser }, wrapper }
    );

    // Wait for first user fetch to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Verify first user state
    expect(result.current.loading).toBe(false);
    expect(result.current.subscription).toEqual(subData1);

    // Switch userKey to simulate wallet change
    const secondUser = "GUSER456";
    
    // Make the second fetch take a little time so we can observe the loading state
    mockGetSubscription.mockImplementation(async (key) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          if (key === secondUser) resolve({ merchant: "GMERCHANT2", amount: "2000", interval: 86400, active: true } as any);
          else resolve(null);
        }, 50);
      });
    });

    // Rerender with new user
    rerender({ userKey: secondUser });

    // IMMEDIATELY after rerender, before the promise resolves:
    // The state should be cleared!
    expect(result.current.loading).toBe(true);
    expect(result.current.subscription).toBeNull();
    expect(result.current.error).toBeNull();

    // Now wait for the second fetch to resolve
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Verify second user state
    expect(result.current.loading).toBe(false);
    expect(result.current.subscription?.merchant).toBe("GMERCHANT2");
  });
});
