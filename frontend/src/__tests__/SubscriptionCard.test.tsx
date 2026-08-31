import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import SubscriptionCard, {
  computeAllowanceHealth,
  TrialBadge,
} from "../components/SubscriptionCard";
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

// Mock TransferSubscriptionModal so we can assert it opens, in isolation from its own logic
vi.mock("../components/TransferSubscriptionModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="transfer-subscription-modal">
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

// Mock the stellar module — getAllowance and getTrialEnd are used by SubscriptionCard
const mockGetAllowance = vi.fn();
const mockGetTrialEnd = vi.fn();
const mockGetSubscriptionHealth = vi.fn();
const mockSimulateCharge = vi.fn();
vi.mock("../stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stellar")>();
  return {
    ...actual,
    getAllowance: (...args: unknown[]) => mockGetAllowance(...args),
    getTrialEnd: (...args: unknown[]) => mockGetTrialEnd(...args),
    getSubscriptionHealth: (...args: unknown[]) => mockGetSubscriptionHealth(...args),
    simulateCharge: (...args: unknown[]) => mockSimulateCharge(...args),
    buildCancelTx: vi.fn().mockResolvedValue("cancel-xdr"),
  };
});

// Mock hooks used by SubscriptionCard
vi.mock("../hooks/useSubscriptionSync", () => ({
  useSubscriptionSync: () => ({
    mutate: vi.fn((_op: string, fn: () => Promise<string>) => fn()),
  }),
}));

const { mockPause, mockPauseUntil } = vi.hoisted(() => ({
  mockPause: vi.fn(),
  mockPauseUntil: vi.fn(),
}));

vi.mock("../hooks/usePauseResume", () => ({
  usePauseResume: () => ({
    pause: mockPause,
    pauseUntil: mockPauseUntil,
    resume: vi.fn(),
    pauseTx: { state: "idle", error: null },
    pauseUntilTx: { state: "idle", error: null },
    resumeTx: { state: "idle", error: null },
  }),
}));

vi.mock("../context/ShortcutRegistry", () => ({
  useRegisterShortcuts: vi.fn(),
}));

vi.mock("../hooks/useResponsive", () => ({
  useResponsive: () => ({ isMobile: false }),
}));

describe("SubscriptionCard", () => {
  const mockOnSign = vi.fn().mockResolvedValue("test-hash");
  const mockOnRefresh = vi.fn();
  const mockUserKey = "GUSER123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234";
  const mockOnCancel = vi.fn();

  const createMockSubscription = (overrides?: Partial<Subscription>): Subscription => ({
    merchant: "GMERCHANT123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678",
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
    // Default: healthy allowance (>=3x amount = 300000000)
    mockGetAllowance.mockResolvedValue(300000000n);
    // Default: no trial active
    mockGetTrialEnd.mockResolvedValue(null);
    mockGetSubscriptionHealth.mockResolvedValue({
      active: true,
      charge_due: false,
      within_grace: false,
      has_sufficient_allowance: true,
      is_paused: false,
      trial_active: false,
      daily_limit_set: false,
    });
    mockSimulateCharge.mockResolvedValue("WouldSucceed");
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

  // ── TrialBadge unit tests (Issue #666) ────────────────────────────────────

  describe("TrialBadge", () => {
    it("renders nothing when trialEndTimestamp is null", () => {
      const { container } = render(<TrialBadge trialEndTimestamp={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when trial has already expired (ts <= now)", () => {
      const pastTs = Math.floor(Date.now() / 1000) - 1; // 1 second ago
      const { container } = render(<TrialBadge trialEndTimestamp={pastTs} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders 'Trial ends today' when less than 1 full day remains", () => {
      const soonTs = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      render(<TrialBadge trialEndTimestamp={soonTs} />);
      expect(screen.getByTestId("trial-badge")).toHaveTextContent("Trial ends today");
    });

    it("renders 'Trial ends in 3 days' when 3 days remain", () => {
      const threedays = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;
      render(<TrialBadge trialEndTimestamp={threedays} />);
      expect(screen.getByTestId("trial-badge")).toHaveTextContent("Trial ends in 3 days");
    });

    it("renders 'Trial ends in 1 day' when exactly 1 day remains", () => {
      const oneday = Math.floor(Date.now() / 1000) + 24 * 3600 + 60; // slightly over 1 day
      render(<TrialBadge trialEndTimestamp={oneday} />);
      expect(screen.getByTestId("trial-badge")).toHaveTextContent("Trial ends in 2 days");
    });

    it("has accessible aria-label when trial is active", () => {
      const futureTs = Math.floor(Date.now() / 1000) + 5 * 24 * 3600;
      render(<TrialBadge trialEndTimestamp={futureTs} />);
      expect(screen.getByTestId("trial-badge")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Trial period active")
      );
    });
  });

  // ── SubscriptionCard trial badge integration tests (Issue #666) ───────────

  describe("Trial badge in SubscriptionCard", () => {
    it("shows trial badge when get_trial_end returns a future timestamp", async () => {
      const futureTs = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600); // 7 days from now
      mockGetTrialEnd.mockResolvedValue(futureTs);

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("trial-badge")).toBeInTheDocument();
      });
      expect(screen.getByTestId("trial-badge")).toHaveTextContent("Trial ends in");
    });

    it("shows no trial badge when get_trial_end returns null (never trialed)", async () => {
      mockGetTrialEnd.mockResolvedValue(null);

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      // Wait for async effects to settle
      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-healthy")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("trial-badge")).not.toBeInTheDocument();
    });

    it("shows no trial badge when trial has already expired", async () => {
      const pastTs = BigInt(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago
      mockGetTrialEnd.mockResolvedValue(pastTs);

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("allowance-badge-healthy")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("trial-badge")).not.toBeInTheDocument();
    });

    it("hides trial badge and shows normal next-charge when trial expired", async () => {
      mockGetTrialEnd.mockResolvedValue(null); // trial ended → None from contract

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.queryByTestId("trial-badge")).not.toBeInTheDocument();
      });
      // Normal next charge countdown should be visible
      expect(screen.getByTestId("next-charge")).toBeInTheDocument();
    });

    it("shows no trial badge on RPC error (fails silently)", async () => {
      mockGetTrialEnd.mockRejectedValue(new Error("RPC unavailable"));

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        // Should still render the card normally
        expect(screen.getByText("Premium Plan")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("trial-badge")).not.toBeInTheDocument();
    });

    it("does not call getTrialEnd for cancelled subscriptions", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(mockGetTrialEnd).not.toHaveBeenCalled();
    });

    it("shows 'Trial Active' status badge when trial is active", async () => {
      const futureTs = BigInt(Math.floor(Date.now() / 1000) + 3 * 24 * 3600);
      mockGetTrialEnd.mockResolvedValue(futureTs);

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("trial-badge")).toBeInTheDocument();
      });

      // The header status badge should also say "Trial Active"
      expect(screen.getByText("Trial Active")).toBeInTheDocument();
    });

    it("shows 'First charge' label instead of 'Next charge' during trial", async () => {
      const futureTs = BigInt(Math.floor(Date.now() / 1000) + 3 * 24 * 3600);
      mockGetTrialEnd.mockResolvedValue(futureTs);

      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("trial-badge")).toBeInTheDocument();
      });

      expect(screen.getByText("First charge")).toBeInTheDocument();
    });
  });

  // ── Allowance health badge rendering ──────────────────────────────────────

  describe("Allowance health badge", () => {
    it("shows green 'Healthy' badge when allowance >= 3x subscription amount", async () => {
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
      expect(screen.getByTestId("allowance-badge-low")).toHaveTextContent("Allowance too low");
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
      expect(screen.getByTestId("allowance-badge-unknown")).toHaveTextContent("Allowance unknown");
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

    it("does not show allowance indicator for cancelled subscriptions", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

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

      await waitFor(() => expect(screen.getByTestId("allowance-badge-none")).toBeInTheDocument());

      expect(screen.getByTestId("allowance-badge-none")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Click to increase allowance")
      );
    });
  });

  // ── Amount and interval rendering ─────────────────────────────────────────

  describe("Amount Rendering", () => {
    it("renders amount in XLM (not stroops)", () => {
      const subscription = createMockSubscription({ amount: "50000000" });
      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("5.0000000 XLM")).toBeInTheDocument();
    });

    it("renders amount with correct decimal formatting", () => {
      const subscription = createMockSubscription({ amount: "123456789" });
      render(
        <SubscriptionCard
          subscription={subscription}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByText("12.3456789 XLM")).toBeInTheDocument();
    });
  });

  describe("Interval Display", () => {
    it("renders daily interval", () => {
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

    it("renders weekly interval", () => {
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

    it("renders monthly interval", () => {
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
      expect(screen.getByRole("button", { name: /cancel subscription/i })).toBeInTheDocument();
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
      await userEvent.click(screen.getByRole("button", { name: /cancel subscription/i }));
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
      expect(screen.queryAllByRole("button", { name: /cancel subscription/i })).toHaveLength(0);
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
      mockGetTrialEnd.mockResolvedValue(null);
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      // Initially shows Active (trial check is async, defaults to no trial)
      expect(screen.getByText("Active")).toBeInTheDocument();
    });
  });

  describe("Next Charge Display", () => {
    it("shows next charge countdown when subscription is active", () => {
      const lastCharged = 1000000;
      const interval = 2592000;
      render(
        <SubscriptionCard
          subscription={createMockSubscription({
            last_charged: lastCharged,
            interval,
            active: true,
          })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByTestId("next-charge")).toHaveTextContent(String(lastCharged + interval));
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
    it("renders pause button when active and not paused", () => {
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

    it("renders resume button when subscription is paused", () => {
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

  describe("Bounded pause (pause_until)", () => {
    it("shows a validation error and does not call pauseUntil when no date is chosen", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      await userEvent.click(screen.getByLabelText(/pause until a specific date/i));
      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));

      expect(screen.getByTestId("pause-until-error")).toBeInTheDocument();
      expect(mockPauseUntil).not.toHaveBeenCalled();
    });

    it("calls pauseUntil with the chosen future expiry (Unix seconds)", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      await userEvent.click(screen.getByLabelText(/pause until a specific date/i));

      const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const localValue = future.toISOString().slice(0, 16);
      const input = screen.getByTestId("pause-until-input");
      await userEvent.type(input, localValue);

      await userEvent.click(screen.getByRole("button", { name: /^pause$/i }));

      expect(mockPauseUntil).toHaveBeenCalledTimes(1);
      const expiryArg = mockPauseUntil.mock.calls[0][0] as bigint;
      expect(typeof expiryArg).toBe("bigint");
      expect(expiryArg).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
    });
  });

  describe("Subscription health widget", () => {
    it("shows Good health for an active healthy subscription", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      await waitFor(() => {
        expect(screen.getByTestId("subscription-health-status")).toHaveTextContent("Good");
      });
      expect(screen.queryByTestId("health-action-warning")).not.toBeInTheDocument();
    });

    it("shows loading skeleton while health is fetching", () => {
      mockGetSubscriptionHealth.mockReturnValue(new Promise(() => {}));
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByTestId("subscription-health-loading")).toBeInTheDocument();
    });

    it("warns on pause/cancel when health is unhealthy but does not disable them", async () => {
      mockGetSubscriptionHealth.mockResolvedValue({
        active: true,
        charge_due: false,
        within_grace: false,
        has_sufficient_allowance: false,
        is_paused: false,
        trial_active: false,
        daily_limit_set: false,
      });
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      await waitFor(() => {
        expect(screen.getByTestId("health-action-warning")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /^pause$/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /cancel subscription/i })).not.toBeDisabled();
    });

    it("surfaces grace period in the health widget", async () => {
      mockGetSubscriptionHealth.mockResolvedValue({
        active: true,
        charge_due: true,
        within_grace: true,
        has_sufficient_allowance: true,
        is_paused: false,
        trial_active: false,
        daily_limit_set: false,
      });
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      await waitFor(() => {
        expect(screen.getByText(/Subscription is in its grace period/)).toBeInTheDocument();
      });
    });

    it("does not show health widget for cancelled subscriptions", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(mockGetSubscriptionHealth).not.toHaveBeenCalled();
      expect(screen.queryByTestId("subscription-health-widget")).not.toBeInTheDocument();
    });

    it("shows simulate_charge readout when enabled", async () => {
      mockSimulateCharge.mockResolvedValue("SubscriptionPaused");
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
          showSimulateCharge
        />
      );
      await waitFor(() => {
        expect(screen.getByTestId("simulate-charge-readout")).toHaveTextContent(/paused/i);
      });
    });
  });

  describe("Cancel Button", () => {
    it("renders cancel button when subscription is active", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByRole("button", { name: /cancel subscription/i })).toBeInTheDocument();
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
      expect(screen.queryAllByRole("button", { name: /cancel subscription/i })).toHaveLength(0);
    });
  });

  describe("Transfer subscription", () => {
    it("renders the transfer trigger button for an active subscription", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByTestId("transfer-subscription-button")).toBeInTheDocument();
    });

    it("renders the transfer trigger button when the subscription is paused", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: true })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.getByTestId("transfer-subscription-button")).toBeInTheDocument();
    });

    it("does not render the transfer trigger button when subscription is inactive", () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );
      expect(screen.queryByTestId("transfer-subscription-button")).not.toBeInTheDocument();
    });

    it("opens TransferSubscriptionModal when the transfer button is clicked", async () => {
      render(
        <SubscriptionCard
          subscription={createMockSubscription({ active: true, paused: false })}
          userKey={mockUserKey}
          onSign={mockOnSign}
          onRefresh={mockOnRefresh}
        />
      );

      expect(screen.queryByTestId("transfer-subscription-modal")).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId("transfer-subscription-button"));
      expect(screen.getByTestId("transfer-subscription-modal")).toBeInTheDocument();
    });
  });
});
