import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SubscriptionHistory from "../components/SubscriptionHistory";

// Mock the useContractEvents hook
vi.mock("../hooks/useContractEvents", () => ({
  useContractEvents: vi.fn(),
}));

import { useContractEvents } from "../hooks/useContractEvents";

const mockedUseContractEvents = vi.mocked(useContractEvents);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(opts: { txHash: string; merchant?: string; amount: bigint; chargedAt: number }) {
  return {
    eventName: "charged",
    address: "GABC123",
    txHash: opts.txHash,
    ledger: 100,
    timestamp: new Date(opts.chargedAt * 1000).toISOString(),
    data: {
      _value: {
        merchant: opts.merchant ?? "GXYZ789",
        amount: opts.amount,
        charged_at: BigInt(opts.chargedAt),
      },
    },
  };
}

/** 2024-01-15T12:00:00Z */
const TS_JAN15 = 1705320000;
/** 2024-01-20T12:00:00Z */
const TS_JAN20 = 1705752000;
/** 2024-01-25T12:00:00Z */
const TS_JAN25 = 1706184000;

const MOCK_EVENTS = [
  makeEvent({ txHash: "tx_jan15", amount: 5_000_000n, chargedAt: TS_JAN15 }), // 0.50 XLM
  makeEvent({ txHash: "tx_jan20", amount: 10_000_000n, chargedAt: TS_JAN20 }), // 1.00 XLM
  makeEvent({ txHash: "tx_jan25", amount: 20_000_000n, chargedAt: TS_JAN25 }), // 2.00 XLM
];

function defaultMock() {
  mockedUseContractEvents.mockReturnValue({
    events: MOCK_EVENTS as any,
    loading: false,
    error: null,
    refresh: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("SubscriptionHistory", () => {
  beforeEach(() => {
    mockedUseContractEvents.mockClear();
  });

  // ── Existing tests (regression) ──────────────────────────────────────────

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
    expect(screen.getByText(/loading charge history/i)).toBeInTheDocument();
  });

  it("renders charge events when data is loaded", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);
    expect(screen.getByText(/0.50 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/2.00 XLM/i)).toBeInTheDocument();
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

  // ── Date filter ───────────────────────────────────────────────────────────

  it("filters by start date — hides events before the start", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-start-date"), {
      target: { value: "2024-01-20" },
    });

    // Jan 15 is before start — should be hidden
    expect(screen.queryByText(/0.50 XLM/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/2.00 XLM/i)).toBeInTheDocument();
  });

  it("filters by end date — hides events after the end", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-end-date"), {
      target: { value: "2024-01-20" },
    });

    expect(screen.getByText(/0.50 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    // Jan 25 is after end — should be hidden
    expect(screen.queryByText(/2.00 XLM/i)).not.toBeInTheDocument();
  });

  it("filters by date range (start + end)", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-start-date"), {
      target: { value: "2024-01-18" },
    });
    fireEvent.change(screen.getByTestId("filter-end-date"), {
      target: { value: "2024-01-22" },
    });

    expect(screen.queryByText(/0.50 XLM/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.queryByText(/2.00 XLM/i)).not.toBeInTheDocument();
  });

  it("shows validation error when start date is after end date", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-start-date"), {
      target: { value: "2024-01-25" },
    });
    fireEvent.change(screen.getByTestId("filter-end-date"), {
      target: { value: "2024-01-15" },
    });

    expect(screen.getByTestId("filter-error")).toBeInTheDocument();
    expect(screen.getByText(/start date must be on or before end date/i)).toBeInTheDocument();
  });

  // ── Amount filter ─────────────────────────────────────────────────────────

  it("filters by minimum XLM amount", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-min-xlm"), {
      target: { value: "1" },
    });

    expect(screen.queryByText(/0.50 XLM/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/2.00 XLM/i)).toBeInTheDocument();
  });

  it("filters by maximum XLM amount", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-max-xlm"), {
      target: { value: "1" },
    });

    expect(screen.getByText(/0.50 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.queryByText(/2.00 XLM/i)).not.toBeInTheDocument();
  });

  it("shows validation error when min amount is greater than max amount", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-min-xlm"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("filter-max-xlm"), { target: { value: "1" } });

    expect(screen.getByTestId("filter-error")).toBeInTheDocument();
    expect(
      screen.getByText(/min amount must be less than or equal to max amount/i)
    ).toBeInTheDocument();
  });

  // ── Combined filters ──────────────────────────────────────────────────────

  it("applies date + amount filters together", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-start-date"), {
      target: { value: "2024-01-18" },
    });
    fireEvent.change(screen.getByTestId("filter-end-date"), {
      target: { value: "2024-01-26" },
    });
    fireEvent.change(screen.getByTestId("filter-max-xlm"), { target: { value: "1.5" } });

    // Jan 20 @ 1.00 XLM passes; Jan 25 @ 2.00 XLM exceeds max
    expect(screen.queryByText(/0.50 XLM/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.queryByText(/2.00 XLM/i)).not.toBeInTheDocument();
  });

  // ── Clear filters ─────────────────────────────────────────────────────────

  it("clear filters button restores all records", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-start-date"), {
      target: { value: "2024-01-20" },
    });
    expect(screen.queryByText(/0.50 XLM/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("clear-filters"));

    expect(screen.getByText(/0.50 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/1.00 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/2.00 XLM/i)).toBeInTheDocument();
  });

  // ── Results count ─────────────────────────────────────────────────────────

  it("shows filtered results count when filters are active", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-start-date"), {
      target: { value: "2024-01-18" },
    });
    fireEvent.change(screen.getByTestId("filter-end-date"), {
      target: { value: "2024-01-22" },
    });

    expect(screen.getByTestId("filter-results-count")).toHaveTextContent("Showing 1 of 3 charges");
  });

  it("does not show results count when no filters are active", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);
    expect(screen.queryByTestId("filter-results-count")).not.toBeInTheDocument();
  });

  // ── Empty state after filtering ───────────────────────────────────────────

  it("shows empty state message when no records match the filter", () => {
    defaultMock();
    render(<SubscriptionHistory userKey="GABC123" />);

    fireEvent.change(screen.getByTestId("filter-min-xlm"), { target: { value: "100" } });

    expect(screen.getByTestId("filter-empty-state")).toBeInTheDocument();
    expect(screen.getByText(/no charges match the current filters/i)).toBeInTheDocument();
  });
});
