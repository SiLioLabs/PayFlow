import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxSimulationPreview } from "../stellar";

vi.mock("../stellar", () => ({
  simulateTransactionPreview: vi.fn(),
}));

import { simulateTransactionPreview } from "../stellar";
import { useTransactionPreview } from "../hooks/useTransactionPreview";

const mockSimulate = vi.mocked(simulateTransactionPreview);

function preview(overrides: Partial<TxSimulationPreview> = {}): TxSimulationPreview {
  return {
    feeStroops: 1000,
    feeXlm: "0.0001000",
    errorCode: null,
    errorMessage: null,
    overrideAllowed: false,
    blockSigning: false,
    rpcError: null,
    ...overrides,
  };
}

describe("useTransactionPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not simulate while disabled", async () => {
    const buildXdr = vi.fn().mockResolvedValue("xdr");
    const { result } = renderHook(() => useTransactionPreview(buildXdr, false));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(buildXdr).not.toHaveBeenCalled();
    expect(mockSimulate).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it("builds the XDR and simulates when enabled", async () => {
    const buildXdr = vi.fn().mockResolvedValue("built-xdr");
    mockSimulate.mockResolvedValue(preview());

    const { result } = renderHook(() => useTransactionPreview(buildXdr, true));

    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(buildXdr).toHaveBeenCalledOnce();
    expect(mockSimulate).toHaveBeenCalledWith("built-xdr");
    expect(result.current.preview?.feeXlm).toBe("0.0001000");
    expect(result.current.blocked).toBe(false);
  });

  it("blocks signing on a simulated contract failure", async () => {
    mockSimulate.mockResolvedValue(
      preview({
        errorCode: "#8",
        errorMessage: "Increase your token allowance and try again.",
        blockSigning: true,
      })
    );

    const buildXdr = vi.fn().mockResolvedValue("xdr");
    const { result } = renderHook(() => useTransactionPreview(buildXdr));

    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.preview?.errorCode).toBe("#8");
  });

  it("a safe failure can be overridden, an unsafe one cannot", async () => {
    mockSimulate.mockResolvedValue(
      preview({ errorCode: "#8", errorMessage: "Allowance", blockSigning: true })
    );
    const buildXdr = vi.fn().mockResolvedValue("xdr");
    const { result } = renderHook(() => useTransactionPreview(buildXdr));

    await waitFor(() => expect(result.current.blocked).toBe(true));
    result.current.setOverride(true);
    await waitFor(() => expect(result.current.blocked).toBe(false));
  });

  it("surfaces RPC-level simulation failures without blocking", async () => {
    mockSimulate.mockResolvedValue(preview({ rpcError: "RPC down", feeXlm: null }));
    const buildXdr = vi.fn().mockResolvedValue("xdr");
    const { result } = renderHook(() => useTransactionPreview(buildXdr));

    await waitFor(() => expect(result.current.error).toBe("RPC down"));
    expect(result.current.blocked).toBe(false);
  });
});
