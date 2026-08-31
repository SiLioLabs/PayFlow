import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import ErrorRecovery from "../components/ErrorRecovery";
import type { SubscriptionHealth } from "../stellar";

const HEALTHY: SubscriptionHealth = {
  active: true,
  charge_due: false,
  within_grace: false,
  has_sufficient_allowance: true,
  is_paused: false,
  trial_active: false,
  daily_limit_set: false,
};

describe("ErrorRecovery", () => {
  it("renders nothing when there is no error and health is good", () => {
    const { container } = render(<ErrorRecovery error={null} health={HEALTHY} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Increase Allowance for insufficient-allowance errors", async () => {
    const onIncreaseAllowance = vi.fn();
    render(
      <ErrorRecovery
        error="HostError: InsufficientAllowance"
        onIncreaseAllowance={onIncreaseAllowance}
      />
    );
    expect(screen.getByTestId("error-recovery")).toHaveTextContent(
      "Your token allowance is too low to complete this charge."
    );
    await userEvent.click(screen.getByRole("button", { name: /increase allowance/i }));
    expect(onIncreaseAllowance).toHaveBeenCalled();
  });

  it("shows proactive allowance guidance from health without an error", () => {
    const onIncreaseAllowance = vi.fn();
    render(
      <ErrorRecovery
        error={null}
        health={{ ...HEALTHY, has_sufficient_allowance: false }}
        onIncreaseAllowance={onIncreaseAllowance}
      />
    );
    expect(screen.getByTestId("error-recovery")).toHaveAttribute("data-proactive", "true");
    expect(screen.getByText(/Token allowance is insufficient/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /increase allowance/i })).toBeInTheDocument();
  });

  it("shows paused guidance from health", () => {
    render(<ErrorRecovery error={null} health={{ ...HEALTHY, is_paused: true }} />);
    expect(screen.getByTestId("error-recovery")).toHaveTextContent(/paused/i);
  });

  it("shows grace-period guidance from health", () => {
    render(<ErrorRecovery error={null} health={{ ...HEALTHY, within_grace: true }} />);
    expect(screen.getByTestId("error-recovery")).toHaveTextContent(/grace period/i);
  });

  it("shows simulate_charge InsufficientAllowance guidance", () => {
    const onIncreaseAllowance = vi.fn();
    render(
      <ErrorRecovery
        error={null}
        health={HEALTHY}
        simulateResult="InsufficientAllowance"
        onIncreaseAllowance={onIncreaseAllowance}
      />
    );
    expect(screen.getByText(/Token allowance is insufficient/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /increase allowance/i })).toBeInTheDocument();
  });

  it("shows contract-paused guidance from simulate_charge", () => {
    render(<ErrorRecovery error={null} simulateResult="ContractPaused" />);
    expect(screen.getByTestId("error-recovery")).toHaveTextContent(/protocol is paused/i);
  });
});
