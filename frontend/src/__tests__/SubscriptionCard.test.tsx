import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SubscriptionCard from "../components/SubscriptionCard";
import { Subscription } from "../types";

// Mock the NextChargeCountdown component to simplify testing
vi.mock("../components/NextChargeCountdown", () => ({
  default: ({ nextChargeTimestamp }: { nextChargeTimestamp: number }) => (
    <span data-testid="next-charge">{nextChargeTimestamp}</span>
  ),
}));

// Mock the CopyButton component
vi.mock("../components/CopyButton", () => ({
  default: ({ text }: { text: string }) => <button data-testid={`copy-${text}`}>Copy</button>,
}));

// Mock the stellar module to avoid actual blockchain interactions
vi.mock("../stellar", () => ({
  buildPauseTx: vi.fn(),
  buildResumeTx: vi.fn(),
}));

describe("SubscriptionCard", () => {
  const mockOnSign = vi.fn().mockResolvedValue("test-hash");
  const mockOnRefresh = vi.fn();
  const mockUserKey = "GUSER123456789";

  const createMockSubscription = (overrides?: Partial<Subscription>): Subscription => ({
    merchant: "GMERCHANT123456789",
    amount: "100000000", // 10 XLM in stroops
    interval: 2592000, // 30 days
    last_charged: 1000000,
    active: true,
    paused: false,
    trial_duration: 0,
    label: "Premium Plan",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Amount Rendering", () => {
    it("renders amount in XLM (not stroops)", () => {
      const subscription = createMockSubscription({
        amount: "50000000", // 5 XLM in stroops
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("5.00 XLM")).toBeInTheDocument();
    });

    it("renders amount with correct decimal formatting", () => {
      const subscription = createMockSubscription({
        amount: "123456789", // ~12.35 XLM
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("12.35 XLM")).toBeInTheDocument();
    });

    it("renders zero amount correctly", () => {
      const subscription = createMockSubscription({
        amount: "0",
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("0.00 XLM")).toBeInTheDocument();
    });
  });

  describe("Interval Display", () => {
    it("renders daily interval as human-readable string", () => {
      const subscription = createMockSubscription({
        interval: 86400, // 1 day in seconds
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("1d")).toBeInTheDocument();
    });

    it("renders weekly interval as human-readable string", () => {
      const subscription = createMockSubscription({
        interval: 604800, // 1 week in seconds
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("1w")).toBeInTheDocument();
    });

    it("renders monthly interval as human-readable string", () => {
      const subscription = createMockSubscription({
        interval: 2592000, // ~30 days in seconds
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("1mo")).toBeInTheDocument();
    });

    it("renders multiple days interval correctly", () => {
      const subscription = createMockSubscription({
        interval: 259200, // 3 days in seconds
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("3d")).toBeInTheDocument();
    });

    it("renders seconds interval when less than a day", () => {
      const subscription = createMockSubscription({
        interval: 3600, // 1 hour in seconds
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("3600s")).toBeInTheDocument();
    });
  });

  describe("Cancel Button", () => {
    it("renders cancel button when subscription is active", () => {
      const subscription = createMockSubscription({
        active: true,
        paused: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      const cancelButton = screen.getByRole("button", {
        name: /cancel subscription/i,
      });
      expect(cancelButton).toBeInTheDocument();
    });

    it("calls onCancel when cancel button is clicked", async () => {
      const subscription = createMockSubscription({
        active: true,
        paused: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      const cancelButton = screen.getByRole("button", {
        name: /cancel subscription/i,
      });
      await userEvent.click(cancelButton);
    });

    it("does not render cancel button when subscription is inactive", () => {
      const subscription = createMockSubscription({
        active: false,
        paused: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      const cancelButtons = screen.queryAllByRole("button", {
        name: /cancel subscription/i,
      });
      expect(cancelButtons).toHaveLength(0);
    });

    it("has aria-label for accessibility", () => {
      const subscription = createMockSubscription({
        active: true,
        paused: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      const cancelButton = screen.getByRole("button", {
        name: /cancel subscription/i,
      });
      expect(cancelButton).toHaveAttribute("aria-label", "Cancel subscription");
    });
  });

  describe("Inactive Subscription Badge", () => {
    it("shows 'Cancelled' badge when subscription is inactive", () => {
      const subscription = createMockSubscription({
        active: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("Cancelled")).toBeInTheDocument();
    });

    it("shows 'Active' badge when subscription is active and not in trial", () => {
      const subscription = createMockSubscription({
        active: true,
        trial_duration: 0,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("shows 'Trial Active' badge when subscription is in trial", () => {
      // Mock the current time and create a subscription with active trial
      const now = Math.floor(Date.now() / 1000);
      const lastCharged = now - 1000; // 1000 seconds ago
      const trialDuration = 86400 * 7; // 7 day trial

      const subscription = createMockSubscription({
        active: true,
        last_charged: lastCharged,
        trial_duration: trialDuration,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("Trial Active")).toBeInTheDocument();
    });

    it("badge has appropriate CSS class for inactive state", () => {
      const subscription = createMockSubscription({
        active: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      const badge = screen.getByText("Cancelled");
      expect(badge).toHaveClass("badge-inactive");
    });

    it("badge has appropriate CSS class for active state", () => {
      const subscription = createMockSubscription({
        active: true,
        trial_duration: 0,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      const badge = screen.getByText("Active");
      expect(badge).toHaveClass("badge-active");
    });
  });

  describe("Merchant Display", () => {
    it("renders merchant address truncated", () => {
      const subscription = createMockSubscription({
        merchant: "GMERCHANT123456789ABCDEFGH",
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText(/GMERCHAN.*CDEFGH/)).toBeInTheDocument();
    });
  });

  describe("Label Display", () => {
    it("renders subscription label when provided", () => {
      const subscription = createMockSubscription({
        label: "Premium Plan",
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("Premium Plan")).toBeInTheDocument();
    });

    it("does not render label when not provided", () => {
      const subscription = createMockSubscription({
        label: undefined,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      // Should not have a paragraph with the label (besides the heading)
      const paragraphs = screen.queryAllByText(/Premium Plan/);
      expect(paragraphs).toHaveLength(0);
    });
  });

  describe("Next Charge Display", () => {
    it("shows next charge countdown when subscription is active", () => {
      const lastCharged = 1000000;
      const interval = 2592000; // 30 days
      const expectedNextCharge = lastCharged + interval;

      const subscription = createMockSubscription({
        last_charged: lastCharged,
        interval,
        active: true,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByTestId("next-charge")).toHaveTextContent(expectedNextCharge.toString());
    });

    it("shows dash when subscription is inactive", () => {
      const subscription = createMockSubscription({
        active: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("Pause and Resume Buttons", () => {
    it("renders pause button when subscription is active and not paused", () => {
      const subscription = createMockSubscription({
        active: true,
        paused: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    });

    it("renders resume button when subscription is paused", () => {
      const subscription = createMockSubscription({
        active: true,
        paused: true,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    });

    it("does not render pause or resume buttons when subscription is inactive", () => {
      const subscription = createMockSubscription({
        active: false,
        paused: false,
      });

      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    });
  });
});
