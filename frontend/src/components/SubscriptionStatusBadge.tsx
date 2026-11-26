import React from "react";

export type AllowanceHealth = "healthy" | "low" | "none" | "unknown";

export function computeAllowanceHealth(allowance: bigint | null, amount: bigint): AllowanceHealth {
  if (allowance === null) return "unknown";
  if (allowance === 0n) return "none";
  if (allowance < amount) return "low";
  if (amount > 0n && allowance >= amount * 3n) return "healthy";
  return "low";
}

interface AllowanceHealthBadgeProps {
  health: AllowanceHealth;
  loading: boolean;
  onClick: () => void;
}

export function AllowanceHealthBadge({ health, loading, onClick }: AllowanceHealthBadgeProps) {
  if (loading) {
    return (
      <span
        className="allowance-health-badge allowance-health-badge--unknown"
        aria-label="Checking allowance…"
      >
        Checking…
      </span>
    );
  }

  if (health === "healthy") {
    return (
      <span
        className="allowance-health-badge allowance-health-badge--healthy"
        aria-label="Allowance is healthy"
        data-testid="allowance-badge-healthy"
      >
        ✓ Healthy
      </span>
    );
  }

  const label =
    health === "none"
      ? "No allowance — charges will fail"
      : health === "low"
        ? "Allowance too low"
        : "Allowance unknown";
  const className =
    health === "none"
      ? "allowance-health-badge allowance-health-badge--none"
      : health === "low"
        ? "allowance-health-badge allowance-health-badge--low"
        : "allowance-health-badge allowance-health-badge--unknown";

  return (
    <button
      className={className}
      onClick={onClick}
      aria-label={`${label}. Click to increase allowance.`}
      data-testid={`allowance-badge-${health}`}
    >
      {health === "none"
        ? "⚠ No allowance — charges will fail"
        : health === "low"
          ? "⚠ Allowance too low"
          : "? Allowance unknown"}
    </button>
  );
}

interface TrialBadgeProps {
  trialEndTimestamp: number | null;
}

export function TrialBadge({ trialEndTimestamp }: TrialBadgeProps) {
  if (trialEndTimestamp === null) return null;

  const nowSecs = Math.floor(Date.now() / 1000);
  if (trialEndTimestamp <= nowSecs) return null;

  const daysRemaining = Math.ceil((trialEndTimestamp - nowSecs) / (24 * 60 * 60));
  const label =
    daysRemaining <= 1
      ? "Trial ends today"
      : `Trial ends in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;
  const exactDate = new Date(trialEndTimestamp * 1000).toLocaleString();

  return (
    <span
      className="trial-badge"
      aria-label={`Trial period active. ${label}`}
      data-testid="trial-badge"
      title={exactDate}
    >
      🎁 {label}
    </span>
  );
}

interface SubscriptionStatusBadgeProps {
  active: boolean;
  paused: boolean;
  isInTrial: boolean;
}

export function SubscriptionStatusBadge({
  active,
  paused,
  isInTrial,
}: SubscriptionStatusBadgeProps) {
  const className = `badge ${
    active && !paused ? "badge-active" : paused ? "badge-warning" : "badge-inactive"
  }`;
  const label = active ? (paused ? "Paused" : isInTrial ? "Trial Active" : "Active") : "Cancelled";

  return <span className={className}>{label}</span>;
}
