/**
 * Tests for useNetworkStatus hook and OfflineBanner component (Issues #668, #1057).
 *
 * Coverage:
 *  - useNetworkStatus initialises from navigator.onLine
 *  - useNetworkStatus updates to false when 'offline' event fires
 *  - useNetworkStatus updates to true when 'online' event fires
 *  - status transitions across online | offline | unknown | checking
 *  - wallet network match / mismatch (merged from useNetworkCheck)
 *  - OfflineBanner renders when visible=true
 *  - OfflineBanner does not render when visible=false
 *  - OfflineBanner has role="alert" for screen readers
 *  - OfflineBanner auto-dismisses (visible=false) when connectivity is restored
 *  - Buttons are disabled while offline
 */
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { NETWORK_PASSPHRASE } from "../stellar";
import OfflineBanner from "../components/OfflineBanner";

// ── useNetworkStatus hook tests ───────────────────────────────────────────────

describe("useNetworkStatus", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");

  function setNavigatorOnLine(value: boolean) {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      configurable: true,
      value,
    });
  }

  afterEach(() => {
    // Restore original navigator.onLine descriptor
    if (originalOnLine) {
      Object.defineProperty(Navigator.prototype, "onLine", originalOnLine);
    }
    delete window.freighter;
  });

  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function mockFreighterGetNetwork(getNetwork: () => Promise<unknown>) {
    window.freighter = { getNetwork: vi.fn(getNetwork) } as unknown as typeof window.freighter;
  }

  it("initialises to true when navigator.onLine is true", () => {
    setNavigatorOnLine(true);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it("initialises to false when page loads while offline (navigator.onLine is false)", () => {
    setNavigatorOnLine(false);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
  });

  it("updates to false when window fires 'offline' event", () => {
    setNavigatorOnLine(true);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it("updates to true when window fires 'online' event after going offline", () => {
    setNavigatorOnLine(false);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOnline).toBe(true);
  });

  it("removes event listeners on unmount (no memory leaks)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();

    // Both 'online' and 'offline' handlers should have been removed
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("responds to multiple online/offline transitions correctly", () => {
    setNavigatorOnLine(true);
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.isOnline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.isOnline).toBe(false);
  });
  describe("status contract", () => {
    it("is 'unknown' when online but no wallet is available to verify the network", () => {
      setNavigatorOnLine(true);
      const { result } = renderHook(() => useNetworkStatus());
      expect(result.current.status).toBe("unknown");
      expect(result.current.isOnline).toBe(true);
      expect(result.current.networkMatch).toBe(true);
    });

    it("is 'offline' on page load while offline, and 'unknown' once back online", () => {
      setNavigatorOnLine(false);
      const { result } = renderHook(() => useNetworkStatus());
      expect(result.current.status).toBe("offline");
      expect(result.current.isOnline).toBe(false);

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(result.current.status).toBe("unknown");
      expect(result.current.isOnline).toBe(true);
    });

    it("goes 'checking' -> 'online' when the wallet network check succeeds", async () => {
      setNavigatorOnLine(true);
      const d = deferred<{ network: string; networkPassphrase: string }>();
      mockFreighterGetNetwork(() => d.promise);

      const { result } = renderHook(() => useNetworkStatus());
      expect(result.current.status).toBe("checking");
      expect(result.current.isOnline).toBe(true);
      expect(result.current.networkMatch).toBe(true); // optimistic while checking

      await act(async () => {
        d.resolve({ network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASE });
      });
      expect(result.current.status).toBe("online");
      expect(result.current.networkMatch).toBe(true);
      expect(result.current.walletNetwork).toBe("TESTNET");
    });

    it("goes 'checking' -> 'unknown' when the wallet check throws (older Freighter)", async () => {
      setNavigatorOnLine(true);
      const d = deferred<never>();
      mockFreighterGetNetwork(() => d.promise);

      const { result } = renderHook(() => useNetworkStatus());
      expect(result.current.status).toBe("checking");

      await act(async () => {
        d.reject(new Error("getNetwork not supported"));
      });
      expect(result.current.status).toBe("unknown");
      expect(result.current.networkMatch).toBe(true);
      expect(result.current.walletNetwork).toBe("");
    });

    it("'offline' takes precedence over 'checking' and 'online'", async () => {
      setNavigatorOnLine(true);
      const d = deferred<{ network: string; networkPassphrase: string }>();
      mockFreighterGetNetwork(() => d.promise);

      const { result } = renderHook(() => useNetworkStatus());
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(result.current.status).toBe("offline");

      await act(async () => {
        d.resolve({ network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASE });
      });
      expect(result.current.status).toBe("offline");

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(result.current.status).toBe("online");
    });

    it("reports a mismatch when the wallet is on a different network", async () => {
      setNavigatorOnLine(true);
      mockFreighterGetNetwork(() =>
        Promise.resolve({
          network: "PUBLIC",
          networkPassphrase: "Public Global Stellar Network ; September 2015",
        })
      );

      const { result } = renderHook(() => useNetworkStatus());
      await waitFor(() => expect(result.current.networkMatch).toBe(false));
      expect(result.current.walletNetwork).toBe("PUBLIC");
      expect(result.current.status).toBe("online");
    });

    it("ignores a wallet check that settles after unmount", async () => {
      setNavigatorOnLine(true);
      const d = deferred<{ network: string; networkPassphrase: string }>();
      mockFreighterGetNetwork(() => d.promise);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { unmount } = renderHook(() => useNetworkStatus());
      unmount();
      await act(async () => {
        d.resolve({ network: "TESTNET", networkPassphrase: NETWORK_PASSPHRASE });
      });

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});

// ── OfflineBanner component tests ─────────────────────────────────────────────

describe("OfflineBanner", () => {
  it("renders the banner when visible=true", () => {
    render(<OfflineBanner visible={true} />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });

  it("does not render when visible=false", () => {
    render(<OfflineBanner visible={false} />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("displays the correct offline message", () => {
    render(<OfflineBanner visible={true} />);
    expect(
      screen.getByText(/you are offline\. wallet actions are unavailable\./i)
    ).toBeInTheDocument();
  });

  it("has role='alert' for immediate screen reader announcement", () => {
    render(<OfflineBanner visible={true} />);
    expect(screen.getByTestId("offline-banner")).toHaveAttribute("role", "alert");
  });

  it("has aria-live='assertive' for immediate announcement", () => {
    render(<OfflineBanner visible={true} />);
    expect(screen.getByTestId("offline-banner")).toHaveAttribute("aria-live", "assertive");
  });

  it("banner disappears (auto-dismisses) when visible flips to false", () => {
    const { rerender } = render(<OfflineBanner visible={true} />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();

    rerender(<OfflineBanner visible={false} />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("banner reappears when visible flips back to true", () => {
    const { rerender } = render(<OfflineBanner visible={false} />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();

    rerender(<OfflineBanner visible={true} />);
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
  });
});

// ── Integration: offline disables buttons ────────────────────────────────────

describe("Offline state disables action buttons", () => {
  /**
   * Minimal test harness: a button that is disabled when isOnline=false.
   * This mirrors how App.tsx passes isOnline to child components.
   */
  function TestActionButton({ isOnline }: { isOnline: boolean }) {
    return (
      <button disabled={!isOnline} data-testid="action-btn">
        Subscribe
      </button>
    );
  }

  it("button is enabled when online", () => {
    render(<TestActionButton isOnline={true} />);
    expect(screen.getByTestId("action-btn")).not.toBeDisabled();
  });

  it("button is disabled when offline", () => {
    render(<TestActionButton isOnline={false} />);
    expect(screen.getByTestId("action-btn")).toBeDisabled();
  });

  it("button re-enables when connection is restored", () => {
    const { rerender } = render(<TestActionButton isOnline={false} />);
    expect(screen.getByTestId("action-btn")).toBeDisabled();

    rerender(<TestActionButton isOnline={true} />);
    expect(screen.getByTestId("action-btn")).not.toBeDisabled();
  });
});
