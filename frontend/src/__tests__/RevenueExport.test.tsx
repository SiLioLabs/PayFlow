import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RevenueExport, { revenueToCSV } from "../components/RevenueExport";
import * as stellar from "../stellar";

vi.mock("../stellar", () => ({
  getMerchantRevenueDays: vi.fn(),
}));
vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

describe("RevenueExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.URL.createObjectURL = vi.fn(() => "blob:revenue");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("exports daily revenue with UTC dates and exact stroops/XLM values", () => {
    expect(revenueToCSV([{ day: 20_000, amount: 12_345_678n }], 55_000_000n)).toBe(
      "record_type,date_utc,revenue_stroops,revenue_xlm\r\ntotal,,55000000,5.5000000\r\ndaily,2024-10-04,12345678,1.2345678"
    );
  });

  it("includes the cumulative total when no daily buckets are available", () => {
    expect(revenueToCSV([], 10_000_000n)).toBe(
      "record_type,date_utc,revenue_stroops,revenue_xlm\r\ntotal,,10000000,1.0000000"
    );
  });

  it("downloads CSV using all fetched daily entries", async () => {
    vi.mocked(stellar.getMerchantRevenueDays).mockResolvedValue([
      { day: 20_000, amount: 10_000_000n },
    ]);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<RevenueExport merchantKey="GMERCHANT123" totalRevenue={20_000_000n} />);
    fireEvent.click(screen.getByTestId("export-revenue"));

    await waitFor(() =>
      expect(stellar.getMerchantRevenueDays).toHaveBeenCalledWith("GMERCHANT123")
    );
    expect(click).toHaveBeenCalledOnce();
    expect(window.URL.createObjectURL).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("shows a clear error if revenue history cannot be fetched", async () => {
    vi.mocked(stellar.getMerchantRevenueDays).mockRejectedValue(new Error("RPC unavailable"));
    render(<RevenueExport merchantKey="GMERCHANT123" totalRevenue={0n} />);
    fireEvent.click(screen.getByTestId("export-revenue"));
    expect(await screen.findByTestId("revenue-export-error")).toHaveTextContent("RPC unavailable");
  });
});
