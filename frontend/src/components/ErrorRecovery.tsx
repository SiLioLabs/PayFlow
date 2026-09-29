import React from "react";
import { friendlyError } from "../utils/errors";
import {
  CHARGE_SIM_LABELS,
  ChargeSimResult,
  chargeSimIsRisky,
  payBlockedReason,
  payWarningReason,
  SubscriptionHealth,
  subscriptionHasWarnings,
} from "../stellar";

interface ErrorRecoveryProps {
  error: string | null;
  onIncreaseAllowance?: () => void;
  onViewDailyLimit?: () => void;
  dailyLimit?: string;
  health?: SubscriptionHealth | null;
  simulateResult?: ChargeSimResult | null;
}

function healthGuidanceMessage(
  health: SubscriptionHealth | null | undefined,
  simulateResult: ChargeSimResult | null | undefined
): string | null {
  const blocked = payBlockedReason(health ?? null, simulateResult ?? null);
  if (blocked) return blocked;
  const warning = payWarningReason(health ?? null, simulateResult ?? null);
  if (warning) return warning;
  if (simulateResult && chargeSimIsRisky(simulateResult)) {
    return CHARGE_SIM_LABELS[simulateResult];
  }
  return null;
}

export default function ErrorRecovery({
  error,
  onIncreaseAllowance,
  onViewDailyLimit,
  dailyLimit,
  health,
  simulateResult,
}: ErrorRecoveryProps) {
  const healthMessage = healthGuidanceMessage(health, simulateResult);
  if (!error && !healthMessage) return null;

  const raw = (error ?? "").toLowerCase();
  const allowanceIssue =
    raw.includes("insufficientallowance") ||
    raw.includes("insufficient allowance") ||
    raw.includes("error(contract, #8)") ||
    (health != null && !health.has_sufficient_allowance) ||
    simulateResult === "InsufficientAllowance";
  const pausedIssue =
    raw.includes("subscriptionpaused") ||
    raw.includes("subscription is paused") ||
    raw.includes("error(contract, #17)") ||
    health?.is_paused === true ||
    simulateResult === "SubscriptionPaused";
  const graceIssue =
    raw.includes("graceperiodelapsed") ||
    raw.includes("grace period") ||
    raw.includes("error(contract, #9)") ||
    health?.within_grace === true ||
    simulateResult === "GracePeriodElapsed";
  const dailyLimitIssue =
    raw.includes("dailylimitexceeded") ||
    raw.includes("daily limit exceeded") ||
    raw.includes("error(contract, #25)");
  const merchantFrozen =
    raw.includes("merchantfrozen") ||
    raw.includes("merchant is frozen") ||
    raw.includes("error(contract, #22)");
  const contractPaused =
    raw.includes("contractpaused") ||
    raw.includes("contract is paused") ||
    raw.includes("error(contract, #18)") ||
    raw.includes("error(contract, #30)") ||
    simulateResult === "ContractPaused";

  let message = error ? friendlyError(error) : (healthMessage as string);
  let action: React.ReactNode = null;

  if (allowanceIssue) {
    message = error
      ? "Your token allowance is too low to complete this charge."
      : (healthMessage as string);
    if (onIncreaseAllowance) {
      action = (
        <button className="btn-primary" onClick={onIncreaseAllowance}>
          Increase Allowance
        </button>
      );
    }
  } else if (dailyLimitIssue) {
    message = `You have exceeded your daily spending limit${dailyLimit ? ` of ${dailyLimit}` : ""}. It resets in 24 hours.`;
    if (onViewDailyLimit) {
      action = (
        <button className="btn-secondary" onClick={onViewDailyLimit}>
          View Daily Limit
        </button>
      );
    }
  } else if (pausedIssue) {
    message = error
      ? "Subscription is paused. Resume it before paying or charging."
      : (healthMessage as string);
  } else if (graceIssue) {
    message = error
      ? "The grace period for this subscription has elapsed or is active. Recurring charges may fail."
      : (healthMessage as string);
  } else if (merchantFrozen) {
    message = "Merchant is suspended. Contact support.";
  } else if (contractPaused) {
    message = "Protocol is paused for maintenance. Try again later.";
  } else if (error && message === error) {
    message = `Contract Error: ${error}`;
    action = (
      <a
        href="https://github.com/Dantama022/PayFlow/tree/main/docs/ERROR-CODES.md"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary"
        style={{ textDecoration: "none", display: "inline-block", fontSize: "0.875rem" }}
      >
        View Error Codes
      </a>
    );
  }

  const isProactive = !error && !!healthMessage;
  const showBecauseUnhealthy =
    isProactive &&
    ((health != null && subscriptionHasWarnings(health)) ||
      chargeSimIsRisky(simulateResult ?? null));

  if (!error && !showBecauseUnhealthy && !healthMessage) return null;

  return (
    <div
      className="network-warning"
      role="alert"
      data-testid="error-recovery"
      data-proactive={isProactive ? "true" : "false"}
      style={{
        background: "var(--color-danger-bg)",
        color: "var(--color-danger-text)",
        borderColor: "var(--color-danger)",
        marginBottom: "var(--space-4)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span>⚠️</span>
        <span>{message}</span>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
