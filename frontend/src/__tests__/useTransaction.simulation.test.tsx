import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnqueue = vi.fn(() => 1);
const mockEnqueueTransaction = vi.fn();

vi.mock("../stellar", () => ({
  server: { getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }) },
}));

vi.mock("../services/txQueue", () => ({
  enqueueTransaction: (...args: unknown[]) => mockEnqueueTransaction(...args),
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  markSubmitted: vi.fn(),
  markConfirmed: vi.fn(),
  markFailed: vi.fn(),
  setRetry: vi.fn(),
}));

vi.mock("../context/RpcHealthContext", () => ({
  useRpcHealthContext: () => ({ circuitOpen: false }),
}));

vi.mock("../utils/network", () => ({
  ensureMainnetConfirmed: () => true,
}));

import { useTransaction } from "../hooks/useTransaction";

const failingPreview = {
  feeStroops: 1000,
  feeXlm: "0.0001000",
  errorCode: "#8",
  errorMessage: "Increase your token allowance and try again.",
  overrideAllowed: false,
  blockSigning: true,
  rpcError: null,
};

describe("useTransaction simulation guard", () => {
  const buildAndSign = vi.fn().mockResolvedValue("hash");

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockReturnValue(1);
    mockEnqueueTransaction.mockResolvedValue("hash123");
  });

  it("throws before enqueueing when simulation predicted a failure", async () => {
    const { result } = renderHook(() => useTransaction());
    let caught: Error | null = null;

    await act(async () => {
      try {
        await result.current.submit(buildAndSign, "Subscribe", { preview: failingPreview });
      } catch (e) {
        caught = e as Error;
      }
    });

    expect(caught?.message).toContain("token allowance");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(buildAndSign).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
  });

  it("passes the preview into the queue entry", async () => {
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.submit(buildAndSign, "Subscribe", { preview: null });
    });

    expect(mockEnqueue).toHaveBeenCalledWith("Subscribe", null, null);
  });

  it("allows signing when the user explicitly overrode a safe failure", async () => {
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      await result.current.submit(buildAndSign, "Charge", {
        preview: { ...failingPreview, errorCode: "#6", overrideAllowed: true },
        allowSimulationOverride: true,
      });
    });

    expect(mockEnqueueTransaction).toHaveBeenCalled();
    expect(result.current.status).toBe("success");
  });
});
