import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePauseResume } from "../hooks/usePauseResume";
import { useTransaction } from "../hooks/useTransaction";
import { buildPauseTx, buildResumeTx } from "../stellar";

vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(),
}));

vi.mock("../stellar", () => ({
  buildPauseTx: vi.fn().mockResolvedValue("pause-xdr"),
  buildResumeTx: vi.fn().mockResolvedValue("resume-xdr"),
  server: {},
  getAllowance: vi.fn(),
  getDailyLimit: vi.fn(),
  buildApproveTx: vi.fn(),
  buildSetDailyLimitTx: vi.fn(),
  buildCancelTx: vi.fn(),
  buildPayPerUseTx: vi.fn(),
}));

describe("usePauseResume", () => {
  const onSign = vi.fn().mockResolvedValue("signed-xdr");
  const onRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation for useTransaction
    vi.mocked(useTransaction).mockReturnValue({
      status: "idle",
      hash: null,
      error: null,
      submit: vi.fn().mockImplementation(async (cb) => {
        return cb();
      }),
    });
  });

  it("should initialize with idle status for pauseTx and resumeTx", () => {
    const { result } = renderHook(() => usePauseResume("user-key", onSign, onRefresh));

    expect(result.current.pauseTx.state).toBe("idle");
    expect(result.current.resumeTx.state).toBe("idle");
  });

  it("should successfully build, sign, submit pause transaction, and call refresh", async () => {
    const { result } = renderHook(() => usePauseResume("user-key", onSign, onRefresh));

    await act(async () => {
      await result.current.pause();
    });

    expect(buildPauseTx).toHaveBeenCalledWith("user-key");
    expect(onSign).toHaveBeenCalledWith("pause-xdr");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("should successfully build, sign, submit resume transaction, and call refresh", async () => {
    const { result } = renderHook(() => usePauseResume("user-key", onSign, onRefresh));

    await act(async () => {
      await result.current.resume();
    });

    expect(buildResumeTx).toHaveBeenCalledWith("user-key");
    expect(onSign).toHaveBeenCalledWith("resume-xdr");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("should propagate errors if transaction submission fails", async () => {
    const submitError = new Error("On-chain failure");

    vi.mocked(useTransaction).mockReturnValue({
      status: "failed",
      hash: null,
      error: "On-chain failure",
      submit: vi.fn().mockRejectedValue(submitError),
    });

    const { result } = renderHook(() => usePauseResume("user-key", onSign, onRefresh));

    await expect(
      act(async () => {
        await result.current.pause();
      })
    ).rejects.toThrow("On-chain failure");

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
