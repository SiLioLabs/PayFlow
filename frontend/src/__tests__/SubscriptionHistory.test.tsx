import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SubscriptionHistory from "../components/SubscriptionHistory";

// Mock the useContractEvents hook
vi.mock("../hooks/useContractEvents", () => ({
  useContractEvents: vi.fn(),
}));

import { useContractEvents } from "../hooks/useContractEvents";

const mockedUseContractEvents = vi.mocked(useContractEvents);

describe("SubscriptionHistory", () => {
  beforeEach(() => {
    mockedUseContractEvents.mockClear();
  });

  it("renders loading state initially", () => {
    mockedUseContractEvents.mockReturnValue({
      events: [],
      loading: true,
      error: null,
      refresh: vi.fn(),
      loadMore: vi.fn(),
      hasMore: false,
    });

    render(<SubscriptionHistory userKey="GABC123" />);

    expect(screen.getByLabelText(/loading charge history/i)).toBeInTheDocument();
  });

  it("renders charge events when data is loaded", async () => {
    const mockContractEvents = [
      {
        eventName: "charged",
        address: "GABC123",
        txHash: "abc123def456",
        ledger: 100,
        timestamp: "2024-01-15T10:00:00Z",
        data: {
          _value: {
            merchant: "GXYZ789",
            amount: 5000000n,
            charged_at: 1705312800n,
          },
        },
      },
      {
        eventName: "charged",
        address: "GABC123",
        txHash: "def789abc123",
        ledger: 99,
        timestamp: "2024-01-01T10:00:00Z",
        data: {
          _value: {
            merchant: "GXYZ789",
            amount: 10000000n,
            charged_at: 1704103200n,
          },
        },
      },
    ];

    mockedUseContractEvents.mockReturnValue({
      events: mockContractEvents as any,
      loading: false,
      error: null,
      refresh: vi.fn(),
      loadMore: vi.fn(),
      hasMore: false,
    });

    render(<SubscriptionHistory userKey="GABC123" />);

    expect(screen.getByText(/Jan 15, 2024/i)).toBeInTheDocument();
    expect(screen.getByText(/0.50 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/Jan 1, 2024/i)).toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
  });

  it("renders empty state when no charges exist", () => {
    mockedUseContractEvents.mockReturnValue({
      events: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      loadMore: vi.fn(),
      hasMore: false,
    });

    render(<SubscriptionHistory userKey="GABC123" />);

    expect(
      screen.getByText(/no charges yet\. your subscription billing history will appear here\./i)
    ).toBeInTheDocument();
  });

  it("renders error state when fetch fails", () => {
    mockedUseContractEvents.mockReturnValue({
      events: [],
      loading: false,
      error: "Network error",
      refresh: vi.fn(),
      loadMore: vi.fn(),
      hasMore: false,
    });

    render(<SubscriptionHistory userKey="GABC123" />);

    expect(screen.getByText(/unable to load charge history\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls useContractEvents with the correct user key", () => {
    mockedUseContractEvents.mockReturnValue({
      events: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      loadMore: vi.fn(),
      hasMore: false,
    });

    render(<SubscriptionHistory userKey="GTESTUSER123" />);

    expect(mockedUseContractEvents).toHaveBeenCalledWith("charged", "GTESTUSER123");
  });
});
