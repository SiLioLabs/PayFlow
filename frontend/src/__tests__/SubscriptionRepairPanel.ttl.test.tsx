/**
 * Tests for the user-facing SubscriptionRepairPanel (TTL / archived-state variant).
 *
 * This panel renders when a subscription's on-chain storage entry has been
 * archived by Stellar's state-expiry mechanism and guides the user through
 * restoring it via `extend_subscription_ttl`.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../stellar", () => ({
  buildExtendSubscriptionTtlTx: vi.fn(),
  estimateExtendTtlFee: vi.fn(),
  isArchivedError: vi.fn(),
}));

vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(() => ({
    status: "idle",
    hash: null,
    error: null,
    submit: vi.fn(async (fn: () => Promise<string>) => fn()),
  })),
}));

vi.mock("../context/RpcHealthContext", () => ({
  useRpcHealthContext: vi.fn(() => ({ healthy: true, circuitOpen: false, error: null })),
}));

import * as stellar from "../stellar";
import { useTransaction } from "../hooks/useTransaction";
import SubscriptionRepairPanel from "../components/SubscriptionRepairPanel";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_KEY = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const MOCK_ON_SIGN = vi.fn().mockResolvedValue("mock-tx-hash");

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof SubscriptionRepairPanel>> = {}
) {
  return render(
    <SubscriptionRepairPanel
      userKey={USER_KEY}
      isArchived={true}
      onSign={MOCK_ON_SIGN}
      onRestored={vi.fn()}
      {...overrides}
    />
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SubscriptionRepairPanel (TTL / archived state)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: fee estimate resolves quickly
    vi.mocked(stellar.estimateExtendTtlFee).mockResolvedValue(500_000n);
    vi.mocked(stellar.isArchivedError).mockReturnValue(true);
  });

  // ── Visibility ──────────────────────────────────────────────────────────────

  it("renders nothing when subscription is not archived", () => {
    const { container } = renderPanel({ isArchived: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when isArchived is true", () => {
    renderPanel({ isArchived: true });
    expect(screen.getByRole("region", { name: /subscription archived/i })).toBeInTheDocument();
  });

  it("renders the panel when subscriptionError matches an archived pattern", () => {
    vi.mocked(stellar.isArchivedError).mockReturnValue(true);
    renderPanel({ isArchived: undefined, subscriptionError: "entryExpired" });
    expect(screen.getByRole("region", { name: /subscription archived/i })).toBeInTheDocument();
  });

  it("does not render when subscriptionError is unrelated", () => {
    vi.mocked(stellar.isArchivedError).mockReturnValue(false);
    const { container } = renderPanel({
      isArchived: undefined,
      subscriptionError: "no subscription found",
    });
    expect(container.firstChild).toBeNull();
  });

  // ── Explanation copy ────────────────────────────────────────────────────────

  it("shows the archived explanation message", () => {
    renderPanel();
    expect(
      screen.getByText(/your subscription data has been archived by the stellar network/i)
    ).toBeInTheDocument();
  });

  it("renders the 'Restore Subscription' button", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /restore subscription/i })).toBeInTheDocument();
  });

  // ── Fee estimate ────────────────────────────────────────────────────────────

  it("shows estimated cost in XLM after fee is loaded", async () => {
    // 5_000_000 stroops = 0.5 XLM
    vi.mocked(stellar.estimateExtendTtlFee).mockResolvedValue(5_000_000n);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/≈ 0\.5 XLM/i)).toBeInTheDocument();
    });
  });

  it("falls back to a static fee estimate when RPC returns null", async () => {
    vi.mocked(stellar.estimateExtendTtlFee).mockResolvedValue(null);
    renderPanel();
    // The fallback 500_000 stroops = 0.05 XLM
    await waitFor(() => {
      expect(screen.getByText(/≈.*XLM/i)).toBeInTheDocument();
    });
  });

  // ── Ownership ───────────────────────────────────────────────────────────────

  it("enables the restore button when the user is the subscription owner", () => {
    renderPanel({ userKey: USER_KEY, subscriberAddress: USER_KEY });
    expect(screen.getByRole("button", { name: /restore subscription/i })).not.toBeDisabled();
  });

  it("disables the restore button when the user is not the subscription owner", () => {
    renderPanel({ userKey: USER_KEY, subscriberAddress: OTHER_KEY });
    expect(screen.getByRole("button", { name: /restore subscription/i })).toBeDisabled();
  });

  it("shows an ownership warning when the user is not the owner", () => {
    renderPanel({ userKey: USER_KEY, subscriberAddress: OTHER_KEY });
    expect(screen.getByRole("alert", { name: /ownership notice/i })).toBeInTheDocument();
  });

  // ── Restore flow ────────────────────────────────────────────────────────────

  it("shows a confirmation modal when Restore is clicked", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /restore subscription/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("submits extend_subscription_ttl on confirmation and calls onRestored", async () => {
    const onRestored = vi.fn();
    vi.mocked(stellar.buildExtendSubscriptionTtlTx).mockResolvedValue("extend-xdr");

    const submitMock = vi.fn(async (fn: () => Promise<string>) => fn());
    vi.mocked(useTransaction).mockReturnValue({
      status: "idle",
      hash: "mock-tx-hash",
      error: null,
      submit: submitMock,
    });

    renderPanel({ onRestored });

    await userEvent.click(screen.getByRole("button", { name: /restore subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(stellar.buildExtendSubscriptionTtlTx).toHaveBeenCalledWith(USER_KEY, USER_KEY);
    });

    await waitFor(() => {
      expect(onRestored).toHaveBeenCalled();
    });
  });

  it("cancels the modal without submitting when Cancel is clicked", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /restore subscription/i }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(stellar.buildExtendSubscriptionTtlTx).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Pending state ───────────────────────────────────────────────────────────

  it("shows 'Restoring…' while the transaction is pending", () => {
    vi.mocked(useTransaction).mockReturnValue({
      status: "pending",
      hash: null,
      error: null,
      submit: vi.fn(),
    });

    renderPanel();
    expect(screen.getByRole("button", { name: /restore subscription/i })).toBeDisabled();
    expect(screen.getByText(/Restoring…/)).toBeInTheDocument();
  });

  // ── Success state ───────────────────────────────────────────────────────────

  it("shows success message after restore completes", () => {
    vi.mocked(useTransaction).mockReturnValue({
      status: "success",
      hash: "abc123def456",
      error: null,
      submit: vi.fn(),
    });

    renderPanel();
    expect(screen.getByRole("status", { name: /restore successful/i })).toBeInTheDocument();
    expect(screen.getByText(/subscription restored/i)).toBeInTheDocument();
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  it("shows a friendly error message when the restore transaction fails", () => {
    vi.mocked(useTransaction).mockReturnValue({
      status: "failed",
      hash: null,
      error: "HostError: Contract unavailable",
      submit: vi.fn(),
    });

    renderPanel();
    expect(screen.getByRole("alert", { name: /restore error/i })).toBeInTheDocument();
  });

  // ── Accessibility ───────────────────────────────────────────────────────────

  it("restore button has an aria-label", () => {
    renderPanel();
    const btn = screen.getByRole("button", { name: /restore subscription/i });
    expect(btn).toHaveAttribute("aria-label", "Restore subscription");
  });

  it("panel section has an accessible region label", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: /subscription archived/i })).toBeInTheDocument();
  });

  it("has aria-live on the panel for screen reader announcements", () => {
    renderPanel();
    const panel = screen.getByRole("region", { name: /subscription archived/i });
    expect(panel).toHaveAttribute("aria-live", "polite");
  });
});
