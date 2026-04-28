import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SubscriptionHistory from "../components/SubscriptionHistory";

// Mock the stellar module
vi.mock("../stellar", () => ({
  getChargeHistory: vi.fn(),
}));

import { getChargeHistory } from "../stellar";

const mockedGetChargeHistory = vi.mocked(getChargeHistory);

describe("SubscriptionHistory", () => {
  beforeEach(() => {
    mockedGetChargeHistory.mockClear();
  });

  it("renders loading state initially", () => {
    mockedGetChargeHistory.mockImplementation(() => new Promise(() => {}));

    render(<SubscriptionHistory userKey="GABC123" />);

    expect(screen.getByLabelText(/loading charge history/i)).toBeInTheDocument();
  });

  it("renders charge events when data is loaded", async () => {
    const mockEvents = [
      {
        date: new Date("2024-01-15T10:00:00Z"),
        amount: "5000000", // 0.5 XLM in stroops
        txHash: "abc123def456",
        merchant: "GXYZ789",
      },
      {
        date: new Date("2024-01-01T10:00:00Z"),
        amount: "10000000", // 1.0 XLM in stroops
        txHash: "def789abc123",
        merchant: "GXYZ789",
      },
    ];

    mockedGetChargeHistory.mockResolvedValue(mockEvents);

    render(<SubscriptionHistory userKey="GABC123" />);

    await waitFor(() => {
      expect(screen.getByText(/Jan 15, 2024/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/0.50 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/Jan 1, 2024/i)).toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
  });

  it("renders empty state when no charges exist", async () => {
    mockedGetChargeHistory.mockResolvedValue([]);

    render(<SubscriptionHistory userKey="GABC123" />);

    await waitFor(() => {
      expect(
        screen.getByText(/no charges yet\. your subscription billing history will appear here\./i)
      ).toBeInTheDocument();
    });
  });

  it("renders error state when fetch fails", async () => {
    mockedGetChargeHistory.mockRejectedValue(new Error("Network error"));

    render(<SubscriptionHistory userKey="GABC123" />);

    await waitFor(() => {
      expect(screen.getByText(/unable to load charge history\./i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls getChargeHistory with the correct user key", async () => {
    mockedGetChargeHistory.mockResolvedValue([]);

    render(<SubscriptionHistory userKey="GTESTUSER123" />);

    await waitFor(() => {
      expect(mockedGetChargeHistory).toHaveBeenCalledWith("GTESTUSER123");
    });
  });
});
