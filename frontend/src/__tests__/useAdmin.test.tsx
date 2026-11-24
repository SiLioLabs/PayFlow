import { renderHook, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useAdmin } from "../hooks/useAdmin";
import * as stellar from "../stellar";

vi.mock("../stellar", () => ({
  getContractAdmin: vi.fn(),
  getContractPendingAdmin: vi.fn(),
}));

describe("useAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stellar.getContractPendingAdmin).mockResolvedValue(null);
  });

  it("marks the connected wallet as admin when it matches on-chain admin", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");

    const { result } = renderHook(() => useAdmin("GADMIN123"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.adminAddress).toBe("GADMIN123");
    expect(result.current.isPendingAdmin).toBe(false);
  });

  it("denies admin privileges for non-admin wallets", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");

    const { result } = renderHook(() => useAdmin("GUSER456"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.adminAddress).toBe("GADMIN123");
  });

  it("exposes pendingAdminAddress when a transfer is staged", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");
    vi.mocked(stellar.getContractPendingAdmin).mockResolvedValue("GNEWADMIN999");

    const { result } = renderHook(() => useAdmin("GADMIN123"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pendingAdminAddress).toBe("GNEWADMIN999");
    expect(result.current.isPendingAdmin).toBe(false); // connected as current admin, not pending
  });

  it("marks wallet as isPendingAdmin when it matches the pending admin", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");
    vi.mocked(stellar.getContractPendingAdmin).mockResolvedValue("GNEWADMIN999");

    const { result } = renderHook(() => useAdmin("GNEWADMIN999"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isPendingAdmin).toBe(true);
    expect(result.current.pendingAdminAddress).toBe("GNEWADMIN999");
  });

  it("returns null pendingAdminAddress when no transfer is pending", async () => {
    vi.mocked(stellar.getContractAdmin).mockResolvedValue("GADMIN123");
    vi.mocked(stellar.getContractPendingAdmin).mockResolvedValue(null);

    const { result } = renderHook(() => useAdmin("GADMIN123"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pendingAdminAddress).toBeNull();
  });
});
