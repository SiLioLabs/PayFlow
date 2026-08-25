import React from "react";
import { friendlyError } from "../utils/errors";

interface ErrorRecoveryProps {
  error: string | null;
  onIncreaseAllowance?: () => void;
  onViewDailyLimit?: () => void;
  dailyLimit?: string;
}

export default function ErrorRecovery({
  error,
  onIncreaseAllowance,
  onViewDailyLimit,
  dailyLimit,
}: ErrorRecoveryProps) {
  if (!error) return null;

  const raw = error.toLowerCase();

  let message = friendlyError(error);
  let action: React.ReactNode = null;

  if (raw.includes("insufficientallowance") || raw.includes("insufficient allowance")) {
    message = "Your token allowance is too low to complete this charge.";
    if (onIncreaseAllowance) {
      action = (
        <button className="btn-primary" onClick={onIncreaseAllowance}>
          Increase Allowance
        </button>
      );
    }
  } else if (raw.includes("dailylimitexceeded") || raw.includes("daily limit exceeded")) {
    message = `You have exceeded your daily spending limit${dailyLimit ? ` of ${dailyLimit}` : ""}. It resets in 24 hours.`;
    if (onViewDailyLimit) {
      action = (
        <button className="btn-secondary" onClick={onViewDailyLimit}>
          View Daily Limit
        </button>
      );
    }
  } else if (raw.includes("merchantfrozen") || raw.includes("merchant is frozen")) {
    message = "Merchant is suspended. Contact support.";
  } else if (raw.includes("contractpaused") || raw.includes("contract is paused")) {
    message = "Protocol is paused for maintenance. Try again later.";
  } else if (message === error) {
    // Unknown error
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

  return (
    <div
      className="network-warning"
      role="alert"
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
