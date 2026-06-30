import { renderHook, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useAdmin } from "../hooks/useAdmin";
import * as stellar from "../stellar";

vi.mock("../stellar", () => ({
  getContractAdmin: vi.fn(),
}));

describe("useAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the connected wallet as admin when it matches on-chain admin", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");

    const { result } = renderHook(() => useAdmin("GADMIN123"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.adminAddress).toBe("GADMIN123");
  });

  it("denies admin privileges for non-admin wallets", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");

    const { result } = renderHook(() => useAdmin("GUSER456"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.adminAddress).toBe("GADMIN123");
  });
});
