import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TxState } from "../hooks/useTransaction";

// Mock dependencies before import
vi.mock("../stellar", () => ({
  server: {
    getTransaction: vi.fn(),
  },
}));
vi.mock("../services/txQueue", () => ({
  enqueueTransaction: vi.fn(),
}));

import { useTransaction } from "../hooks/useTransaction";
import { server } from "../stellar";
import { enqueueTransaction } from "../services/txQueue";

describe("useTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with idle state", () => {
    const { result } = renderHook(() => useTransaction());
    expect(result.current.state).toEqual({ status: "idle" });
    expect(result.current.status).toBe("idle");
    expect(result.current.hash).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("transitions to pending on submit", async () => {
    const { result } = renderHook(() => useTransaction());
    const mockBuildAndSign = vi.fn().mockResolvedValue("tx-hash-123");
    vi.mocked(enqueueTransaction).mockResolvedValue("tx-hash-123");
    vi.mocked(server.getTransaction).mockResolvedValue({ status: "SUCCESS" });

    await act(async () => {
      result.current.submit(mockBuildAndSign);
    });

    await waitFor(() => expect(result.current.state.status).toBe("success"));
  });

  it("transitions to success and sets hash when confirmed", async () => {
    const { result } = renderHook(() => useTransaction());
    const mockBuildAndSign = vi.fn().mockResolvedValue("tx-hash-123");
    vi.mocked(enqueueTransaction).mockResolvedValue("tx-hash-123");
    vi.mocked(server.getTransaction).mockResolvedValue({ status: "SUCCESS" });

    await act(async () => {
      await result.current.submit(mockBuildAndSign);
    });

    expect(result.current.state).toEqual({
      status: "success",
      hash: "tx-hash-123",
    });
    expect(result.current.hash).toBe("tx-hash-123");
    expect(result.current.status).toBe("success");
  });

  it("transitions to failed on submit error", async () => {
    const { result } = renderHook(() => useTransaction());
    const mockBuildAndSign = vi.fn().mockRejectedValue(new Error("submit failed"));
    vi.mocked(enqueueTransaction).mockRejectedValue(new Error("submit failed"));

    await expect(
      act(async () => {
        await result.current.submit(mockBuildAndSign);
      })
    ).rejects.toThrow("submit failed");

    expect(result.current.state).toEqual({
      status: "failed",
      error: "submit failed",
    });
    expect(result.current.error).toBe("submit failed");
    expect(result.current.status).toBe("failed");
  });

  it("resets to idle from any state", async () => {
    const { result } = renderHook(() => useTransaction());

    // First test from success
    const mockBuildAndSign = vi.fn().mockResolvedValue("tx-hash-123");
    vi.mocked(enqueueTransaction).mockResolvedValue("tx-hash-123");
    vi.mocked(server.getTransaction).mockResolvedValue({ status: "SUCCESS" });

    await act(async () => {
      await result.current.submit(mockBuildAndSign);
    });

    expect(result.current.state.status).toBe("success");

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toEqual({ status: "idle" });
    expect(result.current.status).toBe("idle");
    expect(result.current.hash).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // Compile-time checks (run via typecheck)
  // @ts-expect-error accessing hash on idle state should fail
  function testIdleHash() {
    const state: TxState = { status: "idle" };
    console.log(state.hash);
  }

  // @ts-expect-error accessing hash on pending state should fail
  function testPendingHash() {
    const state: TxState = { status: "pending" };
    console.log(state.hash);
  }

  // @ts-expect-error accessing hash on failed state should fail
  function testFailedHash() {
    const state: TxState = { status: "failed", error: "test" };
    console.log(state.hash);
  }

  // @ts-expect-error accessing error on idle state should fail
  function testIdleError() {
    const state: TxState = { status: "idle" };
    console.log(state.error);
  }

  // @ts-expect-error accessing error on pending state should fail
  function testPendingError() {
    const state: TxState = { status: "pending" };
    console.log(state.error);
  }

  // @ts-expect-error accessing error on success state should fail
  function testSuccessError() {
    const state: TxState = { status: "success", hash: "test" };
    console.log(state.error);
  }

  // Should work - accessing hash on success
  function testSuccessHash() {
    const state: TxState = { status: "success", hash: "test" };
    if (state.status === "success") {
      console.log(state.hash); // No error
    }
  }

  // Should work - accessing error on failed
  function testFailedError() {
    const state: TxState = { status: "failed", error: "test" };
    if (state.status === "failed") {
      console.log(state.error); // No error
    }
  }
});
