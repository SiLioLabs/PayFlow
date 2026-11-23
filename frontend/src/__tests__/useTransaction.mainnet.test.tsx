import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { ensureMainnetConfirmed } from "../utils/network";

const mockEnqueueTransaction = vi.fn();

// Mock stellar
vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  server: {
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
  },
}));

// Mock txQueue — useTransaction also touches the persisted UI entry lifecycle
vi.mock("../services/txQueue", () => ({
  enqueueTransaction: (...args: unknown[]) => mockEnqueueTransaction(...args),
  enqueue: vi.fn(() => 1),
  markSubmitted: vi.fn(),
  markConfirmed: vi.fn(),
  markFailed: vi.fn(),
  setRetry: vi.fn(),
}));

// Controllable rpc-health state so the circuit test needs no module resets
const rpcHealthState = { circuitOpen: false };
vi.mock("../context/RpcHealthContext", () => ({
  useRpcHealthContext: () => rpcHealthState,
}));

// Partial mock: keep real network utils, override the gate for deterministic tests
vi.mock("../utils/network", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/network")>();
  return {
    ...actual,
    ensureMainnetConfirmed: vi.fn(() => true),
  };
});

const ensureMock = ensureMainnetConfirmed as unknown as Mock;

async function submitCaught(
  result: { current: { submit: (fn: () => Promise<string>) => Promise<string> } },
  buildAndSign: () => Promise<string> = async () => "hash123"
): Promise<Error | null> {
  let caught: Error | null = null;
  await act(async () => {
    try {
      await result.current.submit(buildAndSign);
    } catch (e) {
      caught = e as Error;
    }
  });
  return caught;
}

describe("useTransaction mainnet safety gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    rpcHealthState.circuitOpen = false;
    mockEnqueueTransaction.mockResolvedValue("hash123");
    ensureMock.mockReturnValue(true);
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it("testnet: does not block and calls enqueueTransaction", async () => {
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      const hash = await result.current.submit(async () => "hash123");
      expect(hash).toBe("hash123");
    });

    expect(mockEnqueueTransaction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("mainnet: blocks when ensureMainnetConfirmed returns false and sets failed state", async () => {
    ensureMock.mockReturnValue(false);
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    const caught = await submitCaught(result);

    expect(caught?.message).toBe("Mainnet transaction cancelled");
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("Mainnet transaction cancelled");
    expect(mockEnqueueTransaction).not.toHaveBeenCalled();
  });

  it("mainnet: requires confirmation only once per session (second submit skips prompt)", async () => {
    // First call cancelled, second call confirmed
    ensureMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    const caught = await submitCaught(result);
    expect(caught?.message).toBe("Mainnet transaction cancelled");

    // Second attempt now confirmed -> succeeds
    await act(async () => {
      await result.current.submit(async () => "hash123");
    });

    expect(mockEnqueueTransaction).toHaveBeenCalledTimes(1);
    expect(ensureMock).toHaveBeenCalledTimes(2);
  });

  it("circuitOpen blocks before mainnet check", async () => {
    rpcHealthState.circuitOpen = true;
    const { useTransaction } = await import("../hooks/useTransaction");
    const { result } = renderHook(() => useTransaction());

    const caught = await submitCaught(result);

    expect(caught?.message).toBe("RPC unavailable");
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toBe("RPC unavailable");
    expect(ensureMock).not.toHaveBeenCalled();
    expect(mockEnqueueTransaction).not.toHaveBeenCalled();
  });
});
