import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SubscriptionHealthWidget from "../components/SubscriptionHealthWidget";
import type { ChargeSimResult, SubscriptionHealth } from "../stellar";

const mockGetSubscriptionHealth = vi.fn();
const mockSimulateCharge = vi.fn();

vi.mock("../stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stellar")>();
  return {
    ...actual,
    getSubscriptionHealth: (...args: unknown[]) => mockGetSubscriptionHealth(...args),
    simulateCharge: (...args: unknown[]) => mockSimulateCharge(...args),
  };
});

const HEALTHY: SubscriptionHealth = {
  active: true,
  charge_due: false,
  within_grace: false,
  has_sufficient_allowance: true,
  is_paused: false,
  trial_active: false,
  daily_limit_set: false,
};

describe("SubscriptionHealthWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSubscriptionHealth.mockResolvedValue(HEALTHY);
    mockSimulateCharge.mockResolvedValue("WouldSucceed" satisfies ChargeSimResult);
  });

  it("shows a loading skeleton while health is fetching", () => {
    mockGetSubscriptionHealth.mockReturnValue(new Promise(() => {}));
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    expect(screen.getByTestId("subscription-health-loading")).toBeInTheDocument();
  });

  it("renders Good status for a healthy subscription", async () => {
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    await waitFor(() => {
      expect(screen.getByTestId("subscription-health-status")).toHaveTextContent("Good");
    });
    expect(screen.queryByTestId("subscription-health-issues")).not.toBeInTheDocument();
  });

  it("renders Needs Attention when allowance is insufficient", async () => {
    mockGetSubscriptionHealth.mockResolvedValue({
      ...HEALTHY,
      has_sufficient_allowance: false,
    });
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    await waitFor(() => {
      expect(screen.getByTestId("subscription-health-status")).toHaveTextContent("Needs Attention");
    });
    expect(screen.getByText(/Token allowance is insufficient/)).toBeInTheDocument();
  });

  it("renders paused state", async () => {
    mockGetSubscriptionHealth.mockResolvedValue({ ...HEALTHY, is_paused: true });
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    await waitFor(() => {
      expect(screen.getByText(/Subscription is currently paused/)).toBeInTheDocument();
    });
  });

  it("renders grace period state", async () => {
    mockGetSubscriptionHealth.mockResolvedValue({ ...HEALTHY, within_grace: true });
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    await waitFor(() => {
      expect(screen.getByText(/Subscription is in its grace period/)).toBeInTheDocument();
    });
  });

  it("shows simulate_charge readout when enabled", async () => {
    mockSimulateCharge.mockResolvedValue("InsufficientAllowance" satisfies ChargeSimResult);
    render(<SubscriptionHealthWidget userKey="GUSER" showSimulateCharge />);
    await waitFor(() => {
      expect(screen.getByTestId("simulate-charge-readout")).toHaveTextContent(
        "Allowance is too low for the next charge"
      );
    });
    expect(screen.getByTestId("simulate-charge-readout")).toHaveAttribute(
      "data-sim-result",
      "InsufficientAllowance"
    );
  });

  it("does not fetch simulate_charge unless requested", async () => {
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    await waitFor(() => {
      expect(screen.getByTestId("subscription-health-status")).toBeInTheDocument();
    });
    expect(mockSimulateCharge).not.toHaveBeenCalled();
    expect(screen.queryByTestId("simulate-charge-readout")).not.toBeInTheDocument();
  });

  it("shows unavailable message when health fails to load", async () => {
    mockGetSubscriptionHealth.mockResolvedValue(null);
    render(<SubscriptionHealthWidget userKey="GUSER" />);
    await waitFor(() => {
      expect(screen.getByTestId("subscription-health-unavailable")).toBeInTheDocument();
    });
  });

  it("notifies parent when health loads", async () => {
    const onHealthChange = vi.fn();
    render(<SubscriptionHealthWidget userKey="GUSER" onHealthChange={onHealthChange} />);
    await waitFor(() => {
      expect(onHealthChange).toHaveBeenCalledWith(HEALTHY);
    });
  });
});
