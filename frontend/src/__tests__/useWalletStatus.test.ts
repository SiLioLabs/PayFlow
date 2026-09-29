import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useWalletStatus } from "../hooks/useWalletStatus";

describe("useWalletStatus", () => {
  it("initializes with notStarted status and null error", () => {
    const { result } = renderHook(() => useWalletStatus());

    expect(result.current.status).toBe("notStarted");
    expect(result.current.error).toBeNull();
  });

  it("transitions to connecting status and clears error", () => {
    const { result } = renderHook(() => useWalletStatus());

    act(() => {
      result.current.setError("Previous error");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Previous error");

    act(() => {
      result.current.setConnecting();
    });

    expect(result.current.status).toBe("connecting");
    expect(result.current.error).toBeNull();
  });

  it("transitions to connected status and clears error", () => {
    const { result } = renderHook(() => useWalletStatus());

    act(() => {
      result.current.setConnecting();
    });

    act(() => {
      result.current.setConnected();
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.error).toBeNull();
  });

  it("transitions to error status with message", () => {
    const { result } = renderHook(() => useWalletStatus());

    act(() => {
      result.current.setConnecting();
    });

    act(() => {
      result.current.setError("Connection failed: Wallet not found");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Connection failed: Wallet not found");
  });

  it("resets to notStarted status and clears error", () => {
    const { result } = renderHook(() => useWalletStatus());

    act(() => {
      result.current.setError("Some error");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Some error");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("notStarted");
    expect(result.current.error).toBeNull();
  });

  it("handles full connection lifecycle: notStarted → connecting → connected", () => {
    const { result } = renderHook(() => useWalletStatus());

    expect(result.current.status).toBe("notStarted");

    act(() => {
      result.current.setConnecting();
    });

    expect(result.current.status).toBe("connecting");

    act(() => {
      result.current.setConnected();
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.error).toBeNull();
  });

  it("handles failed connection lifecycle: notStarted → connecting → error", () => {
    const { result } = renderHook(() => useWalletStatus());

    expect(result.current.status).toBe("notStarted");

    act(() => {
      result.current.setConnecting();
    });

    expect(result.current.status).toBe("connecting");

    act(() => {
      result.current.setError("Timeout connecting to wallet");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Timeout connecting to wallet");
  });

  it("allows retry after error by transitioning back to connecting", () => {
    const { result } = renderHook(() => useWalletStatus());

    // First attempt fails
    act(() => {
      result.current.setConnecting();
    });

    act(() => {
      result.current.setError("Network timeout");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Network timeout");

    // Retry: transition back to connecting
    act(() => {
      result.current.setConnecting();
    });

    expect(result.current.status).toBe("connecting");
    expect(result.current.error).toBeNull();

    // Success on retry
    act(() => {
      result.current.setConnected();
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.error).toBeNull();
  });

  it("distinguishes error from notStarted state", () => {
    const { result } = renderHook(() => useWalletStatus());

    // Initial state
    expect(result.current.status).toBe("notStarted");
    expect(result.current.error).toBeNull();

    // After error
    act(() => {
      result.current.setError("RPC failed");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("RPC failed");

    // States are distinct
    expect(result.current.status).not.toBe("notStarted");
  });
});
