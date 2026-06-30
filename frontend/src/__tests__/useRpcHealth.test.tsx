import React from "react";
import { render, screen, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useRpcHealth } from "../hooks/useRpcHealth";

// Mock the stellar module
vi.mock("../stellar", () => ({
  server: {
    getHealth: vi.fn(),
  },
}));

import { server } from "../stellar";

const mockedServer = vi.mocked(server);

function Test() {
  const { status, latencyMs, error } = useRpcHealth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="latency">{latencyMs === null ? "null" : latencyMs}</span>
      <span data-testid="error">{error || "null"}</span>
    </div>
  );
}

describe("useRpcHealth", () => {
  let mockNow = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => mockNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Initial State", () => {
    it("default healthy state is true before check completes", () => {
      mockedServer.getHealth.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<Test />);

      expect(screen.getByTestId("status")).toHaveTextContent("healthy");
      expect(screen.getByTestId("latency")).toHaveTextContent("null");
      expect(screen.getByTestId("error")).toHaveTextContent("null");
    });
  });

  describe("Healthy and Degraded States", () => {
    it("healthy response (latency <= 2000ms) -> status = healthy", async () => {
      mockedServer.getHealth.mockImplementation(async () => {
        mockNow += 500; // 500ms latency
        return {} as any;
      });

      render(<Test />);

      // Wait for check to complete (it runs on mount)
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(screen.getByTestId("status")).toHaveTextContent("healthy");
      expect(screen.getByTestId("latency")).toHaveTextContent("500");
      expect(screen.getByTestId("error")).toHaveTextContent("null");
    });

    it("degraded response (latency > 2000ms) -> status = degraded", async () => {
      mockedServer.getHealth.mockImplementation(async () => {
        mockNow += 2500; // 2500ms latency
        return {} as any;
      });

      render(<Test />);

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(screen.getByTestId("status")).toHaveTextContent("degraded");
      expect(screen.getByTestId("latency")).toHaveTextContent("2500");
      expect(screen.getByTestId("error")).toHaveTextContent("null");
    });
  });

  describe("Error Response", () => {
    it("error response -> status = unreachable, error set, latencyMs = null", async () => {
      const testError = new Error("Network error");
      mockedServer.getHealth.mockRejectedValue(testError);

      render(<Test />);

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(screen.getByTestId("status")).toHaveTextContent("unreachable");
      expect(screen.getByTestId("latency")).toHaveTextContent("null");
      expect(screen.getByTestId("error")).toHaveTextContent("Network error");
    });
  });

  describe("Exponential Backoff and Retries", () => {
    it("retries at 2s and 4s intervals on failures, and resets on success", async () => {
      mockedServer.getHealth.mockRejectedValue(new Error("Failure"));

      render(<Test />);

      // First check runs immediately and fails.
      await act(async () => {
        await Promise.resolve(); // let microtasks flush
      });

      expect(screen.getByTestId("status")).toHaveTextContent("unreachable");
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(1);

      // Advance by 1900ms -> should not have retried yet
      await act(async () => {
        vi.advanceTimersByTime(1900);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(1);

      // Advance by another 100ms (total 2s) -> second check runs and fails
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(2);

      // Advance by 3900ms -> should not have retried yet
      await act(async () => {
        vi.advanceTimersByTime(3900);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(2);

      // Setup success for the next try
      mockedServer.getHealth.mockImplementation(async () => {
        mockNow += 100;
        return {} as any;
      });

      // Advance by 100ms (total 4s from the last failure) -> third check runs and succeeds
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("status")).toHaveTextContent("healthy");
      expect(screen.getByTestId("latency")).toHaveTextContent("100");

      // Setup failure for the next periodic run
      mockedServer.getHealth.mockRejectedValue(new Error("Failure 2"));

      // Advance by 59.9s -> next run should not have triggered (scheduled for 60s)
      await act(async () => {
        vi.advanceTimersByTime(59900);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(3);

      // Advance to 60s -> check runs, fails, and schedules next retry in 2s (reset backoff)
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(4);
      expect(screen.getByTestId("status")).toHaveTextContent("unreachable");

      // Advance by 2s -> should retry in 2s because backoff sequence was reset
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mockedServer.getHealth).toHaveBeenCalledTimes(5);
    });
  });

  describe("Timers cleanup on unmount", () => {
    it("cancels all active timers when unmounted", async () => {
      mockedServer.getHealth.mockResolvedValue({} as any);
      const clearSpy = vi.spyOn(global, "clearTimeout");
      const { unmount } = render(<Test />);
      
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      unmount();
      expect(clearSpy).toHaveBeenCalled();
    });
  });
});
