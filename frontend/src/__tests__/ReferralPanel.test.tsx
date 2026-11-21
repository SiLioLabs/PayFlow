import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import ReferralPanel, {
  buildReferralUrl,
  getReferrerFromSearch,
} from "../components/ReferralPanel";

// Mock fetchEvents so we don't hit real RPC
const mockFetchEvents = vi.fn();
vi.mock("../stellar", () => ({
  fetchEvents: (...args: unknown[]) => mockFetchEvents(...args),
}));

// Mock useClipboard so copy tests don't need real clipboard API
vi.mock("../hooks/useClipboard", () => ({
  useClipboard: () => ({
    copied: false,
    error: null,
    copy: vi.fn(),
  }),
}));

const TEST_PUBLIC_KEY = "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ";

// ── Pure helper unit tests ─────────────────────────────────────────────────────

describe("buildReferralUrl", () => {
  it("generates the correct referral URL with default base", () => {
    const url = buildReferralUrl(TEST_PUBLIC_KEY, "https://app.payflow.io");
    expect(url).toBe(`https://app.payflow.io/?ref=${TEST_PUBLIC_KEY}`);
  });

  it("generates referral URL with custom base URL", () => {
    const url = buildReferralUrl(TEST_PUBLIC_KEY, "https://staging.payflow.io");
    expect(url).toBe(`https://staging.payflow.io/?ref=${TEST_PUBLIC_KEY}`);
  });

  it("generates referral URL with trailing slash on base", () => {
    const url = buildReferralUrl(TEST_PUBLIC_KEY, "https://app.payflow.io/");
    expect(url).toBe(`https://app.payflow.io//?ref=${TEST_PUBLIC_KEY}`);
  });
});

describe("getReferrerFromSearch", () => {
  it("returns the ref param value when present", () => {
    expect(getReferrerFromSearch(`?ref=${TEST_PUBLIC_KEY}`)).toBe(TEST_PUBLIC_KEY);
  });

  it("returns null when ref param is absent", () => {
    expect(getReferrerFromSearch("?merchant=GABC")).toBeNull();
  });

  it("returns null when ref param is empty string", () => {
    expect(getReferrerFromSearch("?ref=")).toBeNull();
  });

  it("returns null for empty search string", () => {
    expect(getReferrerFromSearch("")).toBeNull();
  });

  it("trims whitespace from ref param value", () => {
    expect(getReferrerFromSearch(`?ref=%20${TEST_PUBLIC_KEY}%20`)).toBe(TEST_PUBLIC_KEY);
  });
});

// ── ReferralPanel component tests ─────────────────────────────────────────────

describe("ReferralPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchEvents.mockResolvedValue({ events: [] });
    // Reset location search
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: "" },
    });
  });

  it("renders the referral panel section", () => {
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);
    expect(screen.getByRole("region", { name: /referral program/i })).toBeInTheDocument();
  });

  it("shows placeholder text when wallet is not connected (publicKey null)", () => {
    render(<ReferralPanel publicKey={null} />);
    expect(screen.getByTestId("referral-code")).toHaveTextContent(
      "Connect wallet to see your referral code"
    );
  });

  it("displays the connected wallet address as the referral code", () => {
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);
    expect(screen.getByTestId("referral-code")).toHaveTextContent(TEST_PUBLIC_KEY);
  });

  it("displays the correct share link with the wallet address", () => {
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);
    const link = screen.getByTestId("referral-link");
    expect(link).toHaveTextContent(`/?ref=${TEST_PUBLIC_KEY}`);
  });

  it("renders copy buttons for address and share link when connected", () => {
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);
    const copyBtns = screen.getAllByRole("button", { name: /copy/i });
    // At least 2 copy buttons: one for address, one for share link
    expect(copyBtns.length).toBeGreaterThanOrEqual(2);
  });

  it("does not render copy buttons when wallet not connected", () => {
    render(<ReferralPanel publicKey={null} />);
    expect(screen.queryAllByRole("button", { name: /copy/i })).toHaveLength(0);
  });

  it("shows referred count of 0 when no events returned", async () => {
    mockFetchEvents.mockResolvedValue({ events: [] });
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("referred-count")).toHaveTextContent("0");
    });
  });

  it("shows correct referred count based on unique referral events", async () => {
    mockFetchEvents.mockResolvedValue({
      events: [
        {
          address: "GABC111",
          eventName: "referred",
          data: {},
          ledger: 1,
          timestamp: "",
          txHash: "tx1",
        },
        {
          address: "GDEF222",
          eventName: "referred",
          data: {},
          ledger: 2,
          timestamp: "",
          txHash: "tx2",
        },
        {
          address: "GABC111",
          eventName: "referred",
          data: {},
          ledger: 3,
          timestamp: "",
          txHash: "tx3",
        }, // duplicate
      ],
    });

    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);

    await waitFor(() => {
      // 2 unique addresses despite 3 events
      expect(screen.getByTestId("referred-count")).toHaveTextContent("2");
    });
  });

  it("shows '—' when fetchEvents fails (RPC error)", async () => {
    mockFetchEvents.mockRejectedValue(new Error("RPC timeout"));
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("referred-count")).toHaveTextContent("—");
    });
  });

  it("calls fetchEvents with 'referred' event name and user address", async () => {
    mockFetchEvents.mockResolvedValue({ events: [] });
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);

    await waitFor(() => {
      expect(mockFetchEvents).toHaveBeenCalledWith("referred", TEST_PUBLIC_KEY);
    });
  });

  it("does not call fetchEvents when publicKey is null", () => {
    render(<ReferralPanel publicKey={null} />);
    expect(mockFetchEvents).not.toHaveBeenCalled();
  });

  it("shows self-referral warning when ?ref= matches connected wallet", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: `?ref=${TEST_PUBLIC_KEY}` },
    });

    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);

    expect(screen.getByTestId("self-referral-warning")).toBeInTheDocument();
    expect(screen.getByTestId("self-referral-warning")).toHaveTextContent(/cannot refer yourself/i);
  });

  it("does not show self-referral warning when ?ref= is a different address", async () => {
    const otherAddress = "GBVKI23OQZCANDASZ2N4YXD5PQNGNIDPZAOBVDQFTQRGNFGFKQ3HYX2";
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: `?ref=${otherAddress}` },
    });

    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);
    expect(screen.queryByTestId("self-referral-warning")).not.toBeInTheDocument();
  });

  it("has accessible aria-label on the referred count element", async () => {
    mockFetchEvents.mockResolvedValue({
      events: [
        {
          address: "GABC111",
          eventName: "referred",
          data: {},
          ledger: 1,
          timestamp: "",
          txHash: "tx1",
        },
      ],
    });
    render(<ReferralPanel publicKey={TEST_PUBLIC_KEY} />);

    await waitFor(() => {
      expect(screen.getByTestId("referred-count")).toHaveAttribute(
        "aria-label",
        "1 users referred"
      );
    });
  });
});

// ── SubscribeForm ?ref= pre-fill tests ────────────────────────────────────────

describe("SubscribeForm referrer pre-fill", () => {
  // We test getReferrerFromSearch directly since SubscribeForm uses it
  it("reads ?ref= from URL and returns it when valid", () => {
    const result = getReferrerFromSearch(`?ref=${TEST_PUBLIC_KEY}&other=foo`);
    expect(result).toBe(TEST_PUBLIC_KEY);
  });

  it("returns null when ?ref= is missing entirely", () => {
    const result = getReferrerFromSearch("?merchant=GABC");
    expect(result).toBeNull();
  });

  it("returns null when search string is empty", () => {
    expect(getReferrerFromSearch("")).toBeNull();
  });

  it("returns null when ref value is only whitespace", () => {
    expect(getReferrerFromSearch("?ref=%20%20")).toBeNull();
  });
});
