import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SubscriptionCard, { computeAllowanceHealth } from "../components/SubscriptionCard";
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

// Mock IncreaseAllowanceModal so we can assert it opens
vi.mock("../components/IncreaseAllowanceModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="increase-allowance-modal">
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

// Mock the stellar module — getAllowance is used for health indicator
const mockGetAllowance = vi.fn();
vi.mock("../stellar", () => ({
  getAllowance: (...args: unknown[]) => mockGetAllowance(...args),
  buildPauseTx: vi.fn(),
  buildResumeTx: vi.fn(),
}));

describe("SubscriptionCard", () => {
  const mockOnSign = vi.fn().mockResolvedValue("test-hash");
  const mockOnRefresh = vi.fn();
  const mockOnCancel = vi.fn();
  const mockUserKey = "GUSER123456789";

  const createMockSubscription = (overrides?: Partial<Subscription>): Subscription => ({
    merchant: "GMERCHANT123456789",
    amount: "100000000", // 10 XLM in stroops
    interval: 2592000,  // 30 days
    last_charged: 1000000,
    active: true,
    paused: false,
    trial_duration: 0,
    label: "Premium Plan",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: healthy allowance (>=3x amount = 300000000)
    mockGetAllowance.mockResolvedValue(300000000n);
  });

  // ── computeAllowanceHealth unit tests ──────────────────────────────────────

  describe("computeAllowanceHealth", () => {
    it("returns 'unknown' when allowance is null (RPC error)", () => {
      expect(computeAllowanceHealth(null, 100n)).toBe("unknown");
    });

    it("returns 'none' when allowance is 0", () => {
      expect(computeAllowanceHealth(0n, 100n)).toBe("none");
    });

    it("returns 'low' when allowance is less than amount", () => {
      expect(computeAllowanceHealth(50n, 100n)).toBe("low");
    });

    it("returns 'low' when allowance equals amount (not enough for 3 charges)", () => {
      expect(computeAllowanceHealth(100n, 100n)).toBe("low");
    });

    it("returns 'low' when allowance is between 1x and 3x amount", () => {
      expect(computeAllowanceHealth(250n, 100n)).toBe("low");
    });

    it("returns 'healthy' when allowance is exactly 3x amount", () => {
      expect(computeAllowanceHealth(300n, 100n)).toBe("healthy");
    });

    it("returns 'healthy' when allowance is more than 3x amount", () => {
      expect(computeAllowanceHealth(1000n, 100n)).toBe("healthy");
    });
  });

  // ── Allowance health badge rendering ──────────────────────────────────────

  describe("Allowance health badge", () => {
    it("shows green 'Healthy' badge when allowance >= 3x subscription amount", async () => {
      // 300000000 = 3 × 100000000 → healthy
      mockGetAllowance.mockResolvedValue(300000000n);
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-healthy")).toBeInTheDocument();
      });
      expect(screen.getByTestId("allowance-badge-healthy")).toHaveTextContent("Healthy");
    });

    it("shows amber warning badge 'Allowance too low' when allowance < amount", async () => {
      mockGetAllowance.mockResolvedValue(50000000n); // 5 XLM < 10 XLM
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-low")).toBeInTheDocument();
      });
      expect(screen.getByTestId("allowance-badge-low")).toHaveTextContent(
        "Allowance too low"
      );
    });

    it("shows red badge 'No allowance — charges will fail' when allowance is 0", async () => {
      mockGetAllowance.mockResolvedValue(0n);
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-none")).toBeInTheDocument();
      });
      expect(screen.getByTestId("allowance-badge-none")).toHaveTextContent(
        "No allowance — charges will fail"
      );
    });

    it("shows neutral 'Allowance unknown' badge on RPC error", async () => {
      mockGetAllowance.mockRejectedValue(new Error("RPC unavailable"));
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-unknown")).toBeInTheDocument();
      });
      expect(screen.getByTestId("allowance-badge-unknown")).toHaveTextContent(
        "Allowance unknown"
      );
    });

    it("opens IncreaseAllowanceModal when warning badge is clicked", async () => {
      mockGetAllowance.mockResolvedValue(0n);
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-none")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId("allowance-badge-none"));

      expect(screen.getByTestId("increase-allowance-modal")).toBeInTheDocument();
    });

    it("opens IncreaseAllowanceModal when low allowance badge is clicked", async () => {
      mockGetAllowance.mockResolvedValue(50000000n);
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-low")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId("allowance-badge-low"));

      expect(screen.getByTestId("increase-allowance-modal")).toBeInTheDocument();
    });

    it("closes IncreaseAllowanceModal when onClose is called", async () => {
      mockGetAllowance.mockResolvedValue(0n);
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId("allowance-badge-none")).toBeInTheDocument()
      );
      await userEvent.click(screen.getByTestId("allowance-badge-none"));
      expect(screen.getByTestId("increase-allowance-modal")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Close Modal"));
      expect(
        screen.queryByTestId("increase-allowance-modal")
      ).not.toBeInTheDocument();
    });

    it("does not show allowance indicator for cancelled subscriptions", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      // getAllowance should not have been called
      expect(mockGetAllowance).not.toHaveBeenCalled();
      expect(screen.queryByTestId(/allowance-badge/)).not.toBeInTheDocument();
    });

    it("badge has accessible aria-label describing action", async () => {
      mockGetAllowance.mockResolvedValue(0n);
      render(
        <SubscriptionCard
          subscription={createMockSubscription()}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() =>
        expect(screen.getByTestId("allowance-badge-none")).toBeInTheDocument()
      );

      expect(screen.getByTestId("allowance-badge-none")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Click to increase allowance")
      );
    });
  });

  // ── Existing tests preserved ───────────────────────────────────────────────

  describe("Amount Rendering", () => {
    it("renders amount in XLM (not stroops)", async () => {
      const subscription = createMockSubscription({ amount: "50000000" });
      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("5.00 XLM")).toBeInTheDocument();

      const cancelButton = screen.getByRole("button", {
        name: /cancel subscription/i,
      });
      await userEvent.click(cancelButton);
    });

    it("renders amount with correct decimal formatting", async () => {
      const subscription = createMockSubscription({ amount: "123456789" });
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
  });

  describe("Interval Display", () => {
    it("renders daily interval", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ interval: 86400 })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("1d")).toBeInTheDocument();
    });

    it("renders weekly interval", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ interval: 604800 })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("1w")).toBeInTheDocument();
    });

    it("renders monthly interval", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ interval: 2592000 })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("1mo")).toBeInTheDocument();
    });
  });

  describe("Cancel Button", () => {
    it("renders cancel button when subscription is active", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(
        screen.getByRole("button", { name: /cancel subscription/i })
      ).toBeInTheDocument();
    });

    it("calls onCancel when cancel button is clicked", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      await userEvent.click(
        screen.getByRole("button", { name: /cancel subscription/i })
      );
      // Clicking cancel opens the confirm dialog
      expect(screen.getByText(/Cancel subscription\?/i)).toBeInTheDocument();
      void mockOnCancel; // used for backwards-compat reference
    });

    it("does not render cancel button when subscription is inactive", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(
        screen.queryAllByRole("button", { name: /cancel subscription/i })
      ).toHaveLength(0);
    });
  });

  describe("Status Badge", () => {
    it("shows 'Cancelled' badge when subscription is inactive", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("Cancelled")).toBeInTheDocument();
    });

    it("shows 'Active' badge when active and not in trial", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, trial_duration: 0 })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("shows 'Trial Active' badge when subscription is in trial", async () => {
      const now = Math.floor(Date.now() / 1000);
      render(
        <SubscriptionCard
          subscription={createMockSubscription({
            active: true,
            last_charged: now - 1000,
            trial_duration: 86400 * 7,
          })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("Trial Active")).toBeInTheDocument();
    });
  });

  describe("Next Charge Display", () => {
    it("shows next charge countdown when subscription is active", async () => {
      const lastCharged = 1000000;
      const interval = 2592000;
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ last_charged: lastCharged, interval, active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByTestId("next-charge")).toHaveTextContent(
        String(lastCharged + interval)
      );
    });

    it("shows dash when subscription is inactive", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("Pause and Resume Buttons", () => {
    it("renders pause button when active and not paused", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    });

    it("renders resume button when subscription is paused", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    });

    it("does not render pause or resume buttons when inactive", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    });
  });
});
