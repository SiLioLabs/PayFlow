import React from "react";
import ErrorRecovery from "./ErrorRecovery";
import type { SubscriptionHealth } from "../stellar";

interface SubscriptionCardStatusProps {
  status: string;
  isError: boolean;
  error?: string | null;
  health: SubscriptionHealth | null;
  onIncreaseAllowance: () => void;
}

export default function SubscriptionCardStatus({
  status,
  isError,
  error,
  health,
  onIncreaseAllowance,
}: SubscriptionCardStatusProps) {
  if (!status) return null;

  return (
    <>
      <p
        className={`form-status ${isError ? "text-error" : "text-success"}`}
        role="status"
        data-testid="subscription-card-status"
        style={{ color: isError ? "var(--color-danger)" : "var(--color-success)" }}
      >
        {isError ? `⚠️ ${status}` : status}
      </p>
      {isError && (
        <ErrorRecovery
          error={error || status}
          health={health}
          onIncreaseAllowance={
            health && !health.has_sufficient_allowance ? onIncreaseAllowance : undefined
          }
        />
      )}
    </>
  );
}
