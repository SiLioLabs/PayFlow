import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import MerchantSubscriberTable, { deriveStatus } from "../components/MerchantSubscriberTable";
import type { MerchantSubscriber } from "../stellar";

// Mock CopyButton so it doesn't need clipboard access in tests
vi.mock("../components/CopyButton", () => ({
  default: ({ text }: { text: string }) => <button data-testid={`copy-${text}`}>Copy</button>,
}));

// ── Test data ──────────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);
const FUTURE = NOW + 86_400; // 1 day ahead  → active
const PAST = NOW - 86_400; // 1 day ago    → overdue

function makeSub(
  overrides: Partial<MerchantSubscriber> & { subscriber: string }
): MerchantSubscriber {
  return {
    subscriber: overrides.subscriber,
    amount: overrides.amount ?? "100000000", // 10 XLM
    interval: overrides.interval ?? 2_592_000, // 30 days
    lastCharged: overrides.lastCharged ?? NOW - 2_592_000,
    nextChargeAt: overrides.nextChargeAt ?? FUTURE,
  };
}

const ACTIVE_SUB = makeSub({
  subscriber: "GACTIVE111111111111111111111111111111111111111111111111",
  nextChargeAt: FUTURE,
});
const OVERDUE_SUB = makeSub({
  subscriber: "GOVERDUE22222222222222222222222222222222222222222222222",
  nextChargeAt: PAST,
});
const HIGH_AMOUNT_SUB = makeSub({
  subscriber: "GHIGH333333333333333333333333333333333333333333333333333",
  amount: "500000000",
  nextChargeAt: FUTURE + 100,
});
const LOW_AMOUNT_SUB = makeSub({
  subscriber: "GLOW4444444444444444444444444444444444444444444444444444",
  amount: "10000000",
  nextChargeAt: FUTURE + 200,
});

// ── deriveStatus unit tests ────────────────────────────────────────────────────

describe("deriveStatus", () => {
  it("returns 'active' for a future nextChargeAt", () => {
    expect(deriveStatus(FUTURE)).toBe("active");
  });

  it("returns 'overdue' for a past nextChargeAt", () => {
    expect(deriveStatus(PAST)).toBe("overdue");
  });
});

// ── MerchantSubscriberTable component tests ────────────────────────────────────

describe("MerchantSubscriberTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  describe("empty state", () => {
    it("renders empty state message when no subscribers", () => {
      render(<MerchantSubscriberTable subscribers={[]} />);
      expect(screen.getByTestId("mst-empty-state")).toBeInTheDocument();
      expect(screen.getByText(/no subscribers yet/i)).toBeInTheDocument();
    });

    it("does not render the table when no subscribers", () => {
      render(<MerchantSubscriberTable subscribers={[]} />);
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });

  // ── Renders subscribers ──────────────────────────────────────────────────

  describe("renders subscribers", () => {
    it("renders a table row for each subscriber", () => {
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB, OVERDUE_SUB]} />);
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByTestId(`mst-row-${ACTIVE_SUB.subscriber}`)).toBeInTheDocument();
      expect(screen.getByTestId(`mst-row-${OVERDUE_SUB.subscriber}`)).toBeInTheDocument();
    });

    it("renders all required column headers", () => {
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB]} />);
      expect(screen.getByText("Subscriber Address")).toBeInTheDocument();
      expect(screen.getByText(/Amount \(XLM\)/i)).toBeInTheDocument();
      expect(screen.getByText("Interval")).toBeInTheDocument();
      expect(screen.getByText("Last Charged")).toBeInTheDocument();
      expect(screen.getByText("Next Charge")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
    });

    it("renders 'Active' status badge for active subscriber", () => {
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB]} />);
      const row = screen.getByTestId(`mst-row-${ACTIVE_SUB.subscriber}`);
      expect(within(row).getByText("Active")).toBeInTheDocument();
    });

    it("renders 'Overdue' status badge for overdue subscriber", () => {
      render(<MerchantSubscriberTable subscribers={[OVERDUE_SUB]} />);
      const row = screen.getByTestId(`mst-row-${OVERDUE_SUB.subscriber}`);
      expect(within(row).getByText("Overdue")).toBeInTheDocument();
    });

    it("renders CopyButton for each subscriber address", () => {
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB]} />);
      expect(screen.getByTestId(`copy-${ACTIVE_SUB.subscriber}`)).toBeInTheDocument();
    });

    it("renders truncated subscriber address", () => {
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB]} />);
      // formatAddress(addr, 8, 6) — first 8 + last 6 chars
      const addr = ACTIVE_SUB.subscriber;
      const truncated = `${addr.slice(0, 8)}…${addr.slice(-6)}`;
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });
  });

  // ── Sorting ──────────────────────────────────────────────────────────────

  describe("sorting", () => {
    const subs = [LOW_AMOUNT_SUB, HIGH_AMOUNT_SUB];

    it("sorts by Amount ascending by default when Amount header clicked", async () => {
      render(<MerchantSubscriberTable subscribers={subs} />);

      await userEvent.click(screen.getByRole("columnheader", { name: /amount/i }));

      const rows = screen.getAllByRole("row").slice(1); // skip header
      // LOW_AMOUNT_SUB (10 XLM) should come first
      expect(rows[0]).toHaveAttribute("data-testid", `mst-row-${LOW_AMOUNT_SUB.subscriber}`);
      expect(rows[1]).toHaveAttribute("data-testid", `mst-row-${HIGH_AMOUNT_SUB.subscriber}`);
    });

    it("sorts by Amount descending on second click", async () => {
      render(<MerchantSubscriberTable subscribers={subs} />);

      const amountHeader = screen.getByRole("columnheader", { name: /amount/i });
      await userEvent.click(amountHeader); // asc
      await userEvent.click(amountHeader); // desc

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveAttribute("data-testid", `mst-row-${HIGH_AMOUNT_SUB.subscriber}`);
      expect(rows[1]).toHaveAttribute("data-testid", `mst-row-${LOW_AMOUNT_SUB.subscriber}`);
    });

    it("sorts by Next Charge ascending (default)", () => {
      // Default sort is nextCharge asc — HIGH (FUTURE+100) before LOW (FUTURE+200)
      render(<MerchantSubscriberTable subscribers={[LOW_AMOUNT_SUB, HIGH_AMOUNT_SUB]} />);

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveAttribute("data-testid", `mst-row-${HIGH_AMOUNT_SUB.subscriber}`);
      expect(rows[1]).toHaveAttribute("data-testid", `mst-row-${LOW_AMOUNT_SUB.subscriber}`);
    });

    it("sorts by Next Charge descending when header clicked once", async () => {
      // First click on already-active nextCharge header → toggles to desc
      // desc → LOW (FUTURE+200) before HIGH (FUTURE+100)
      render(<MerchantSubscriberTable subscribers={[LOW_AMOUNT_SUB, HIGH_AMOUNT_SUB]} />);

      const header = screen.getByRole("columnheader", { name: /next charge/i });
      await userEvent.click(header); // asc → desc

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveAttribute("data-testid", `mst-row-${LOW_AMOUNT_SUB.subscriber}`);
      expect(rows[1]).toHaveAttribute("data-testid", `mst-row-${HIGH_AMOUNT_SUB.subscriber}`);
    });

    it("applies secondary sort by address for stable tie-breaking", async () => {
      // Two subs with identical amount and nextChargeAt
      const subA = makeSub({
        subscriber: "GAAAA555555555555555555555555555555555555555555555555555",
        amount: "100000000",
        nextChargeAt: FUTURE,
      });
      const subB = makeSub({
        subscriber: "GBBBBB66666666666666666666666666666666666666666666666666",
        amount: "100000000",
        nextChargeAt: FUTURE,
      });

      render(<MerchantSubscriberTable subscribers={[subB, subA]} />);

      await userEvent.click(screen.getByRole("columnheader", { name: /amount/i }));

      const rows = screen.getAllByRole("row").slice(1);
      // GAAAA… < GBBBBB… alphabetically
      expect(rows[0]).toHaveAttribute("data-testid", `mst-row-${subA.subscriber}`);
    });

    it("toggles aria-sort attribute on sortable columns", async () => {
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB]} />);

      const amountHeader = screen.getByRole("columnheader", { name: /amount/i });
      expect(amountHeader).toHaveAttribute("aria-sort", "none");

      await userEvent.click(amountHeader);
      expect(amountHeader).toHaveAttribute("aria-sort", "ascending");

      await userEvent.click(amountHeader);
      expect(amountHeader).toHaveAttribute("aria-sort", "descending");
    });

    it("supports keyboard Enter on sortable column header", async () => {
      render(<MerchantSubscriberTable subscribers={[LOW_AMOUNT_SUB, HIGH_AMOUNT_SUB]} />);

      const amountHeader = screen.getByRole("columnheader", { name: /amount/i });
      amountHeader.focus();
      await userEvent.keyboard("{Enter}");

      expect(amountHeader).toHaveAttribute("aria-sort", "ascending");
    });
  });

  // ── Filtering ─────────────────────────────────────────────────────────────

  describe("filtering", () => {
    const subs = [ACTIVE_SUB, OVERDUE_SUB];

    it("renders filter group with All/Active/Overdue buttons", () => {
      render(<MerchantSubscriberTable subscribers={subs} />);
      expect(screen.getByRole("group", { name: /filter/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show all/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show active/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show overdue/i })).toBeInTheDocument();
    });

    it("shows all subscribers by default", () => {
      render(<MerchantSubscriberTable subscribers={subs} />);
      expect(screen.getByTestId(`mst-row-${ACTIVE_SUB.subscriber}`)).toBeInTheDocument();
      expect(screen.getByTestId(`mst-row-${OVERDUE_SUB.subscriber}`)).toBeInTheDocument();
    });

    it("filters to only active subscribers when Active is clicked", async () => {
      render(<MerchantSubscriberTable subscribers={subs} />);

      await userEvent.click(screen.getByRole("button", { name: /show active/i }));

      expect(screen.getByTestId(`mst-row-${ACTIVE_SUB.subscriber}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`mst-row-${OVERDUE_SUB.subscriber}`)).not.toBeInTheDocument();
    });

    it("filters to only overdue subscribers when Overdue is clicked", async () => {
      render(<MerchantSubscriberTable subscribers={subs} />);

      await userEvent.click(screen.getByRole("button", { name: /show overdue/i }));

      expect(screen.queryByTestId(`mst-row-${ACTIVE_SUB.subscriber}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`mst-row-${OVERDUE_SUB.subscriber}`)).toBeInTheDocument();
    });

    it("shows 'no results' message when filter yields empty set", async () => {
      // Only active subscribers, filter by overdue
      render(<MerchantSubscriberTable subscribers={[ACTIVE_SUB]} />);

      await userEvent.click(screen.getByRole("button", { name: /show overdue/i }));

      expect(screen.getByTestId("mst-no-results")).toBeInTheDocument();
    });

    it("marks the active filter button as aria-pressed", async () => {
      render(<MerchantSubscriberTable subscribers={subs} />);

      const activeBtn = screen.getByRole("button", { name: /show active/i });
      expect(activeBtn).toHaveAttribute("aria-pressed", "false");

      await userEvent.click(activeBtn);
      expect(activeBtn).toHaveAttribute("aria-pressed", "true");
    });

    it("shows correct counts in filter button labels", () => {
      render(<MerchantSubscriberTable subscribers={subs} />);
      // All (2), Active (1), Overdue (1)
      expect(screen.getByRole("button", { name: /show all \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show active \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /show overdue \(1\)/i })).toBeInTheDocument();
    });
  });

  describe("virtualization of filtered/sorted rows", () => {
    const MANY_SUBS: MerchantSubscriber[] = Array.from({ length: 200 }, (_, i) =>
      makeSub({
        subscriber: `GSUB${i.toString().padStart(52, "0")}`,
        amount: String((i + 1) * 1_000_000),
        nextChargeAt: i % 2 === 0 ? FUTURE + i : PAST - i,
      })
    );

    it("reports the full filtered/sorted count via aria-rowcount even though only a window is rendered", () => {
      render(<MerchantSubscriberTable subscribers={MANY_SUBS} />);

      const table = screen.getByRole("table", { name: /merchant subscriber list/i });
      expect(table).toHaveAttribute("aria-rowcount", String(MANY_SUBS.length));

      // Only a windowed subset of the 200 rows should be mounted in the DOM.
      const renderedRows = screen.getAllByTestId(/^mst-row-/);
      expect(renderedRows.length).toBeGreaterThan(0);
      expect(renderedRows.length).toBeLessThan(MANY_SUBS.length);
    });

    it("keeps the virtual window in sync after filtering to a smaller set", async () => {
      render(<MerchantSubscriberTable subscribers={MANY_SUBS} />);

      await userEvent.click(screen.getByRole("button", { name: /show overdue/i }));

      const overdueCount = MANY_SUBS.filter((s) => deriveStatus(s.nextChargeAt) === "overdue").length;
      const table = screen.getByRole("table", { name: /merchant subscriber list/i });
      expect(table).toHaveAttribute("aria-rowcount", String(overdueCount));

      // Every rendered row must actually be overdue — the filter must apply to
      // the full list before virtualization windows it, not the other way round.
      const renderedRows = screen.getAllByTestId(/^mst-row-/);
      renderedRows.forEach((row) => {
        expect(row.className).toContain("mst-row--overdue");
      });
    });
  });
});
