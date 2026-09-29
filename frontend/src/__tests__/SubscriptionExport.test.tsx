import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import SubscriptionExport from "../components/SubscriptionExport";
import * as stellar from "../stellar";

const mockAddToast = vi.fn();

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

vi.mock("../stellar", () => ({
  getSubscriptionToken: vi.fn().mockResolvedValue("CB64D3BV7P25CBZ76AEGY2FJD2N2Z35TXTLA2HO7DS4SYYBZWAZZTACC"),
  getReferral: vi.fn().mockResolvedValue(null),
  getReferrer: vi.fn().mockResolvedValue(null),
  getSubscriptionHealth: vi.fn().mockResolvedValue({
    active: true,
    is_paused: false,
    charge_due: false,
    has_sufficient_allowance: true,
  }),
}));

describe("SubscriptionExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();
  });

  const mockData = [
    { subscriber: "GUSER1", merchant: "GMERCHANT1", amount_stroops: 1000 },
    { subscriber: "GUSER2", merchant: "GMERCHANT1", amount_stroops: 2000 },
  ];

  it("renders export button and format options", () => {
    render(<SubscriptionExport data={mockData} />);
    expect(screen.getByRole("button", { name: /Export as CSV/i })).toBeInTheDocument();
  });

  it("surfaces enrichment failures via toast and shows retry button", async () => {
    vi.mocked(stellar.getSubscriptionToken).mockRejectedValueOnce(new Error("RPC network timeout"));

    render(<SubscriptionExport data={mockData} />);

    const exportBtn = screen.getByRole("button", { name: /Export as CSV/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("dropped/failed enrichment row(s)"),
        "error"
      );
    });

    expect(screen.getByTestId("export-error-container")).toBeInTheDocument();
    expect(screen.getByTestId("export-retry-btn")).toBeInTheDocument();
  });

  it("re-runs export when Retry button is clicked", async () => {
    vi.mocked(stellar.getSubscriptionToken).mockRejectedValueOnce(new Error("RPC network timeout"));

    render(<SubscriptionExport data={mockData} />);

    const exportBtn = screen.getByRole("button", { name: /Export as CSV/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(screen.getByTestId("export-retry-btn")).toBeInTheDocument();
    });

    vi.mocked(stellar.getSubscriptionToken).mockResolvedValue("CB64D3BV7P25CBZ76AEGY2FJD2N2Z35TXTLA2HO7DS4SYYBZWAZZTACC");

    const retryBtn = screen.getByTestId("export-retry-btn");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(stellar.getSubscriptionToken).toHaveBeenCalledTimes(4);
    });
  });
});
