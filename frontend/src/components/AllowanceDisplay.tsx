import React, { useEffect, useState } from "react";
import { getAllowance } from "../stellar";
import { formatXlm } from "../utils/format";

interface Props {
  userKey: string;
  subscriptionAmount: bigint;
  refreshTrigger: number;
}

export default function AllowanceDisplay({ userKey, subscriptionAmount, refreshTrigger }: Props) {
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAllowance(userKey)
      .then(setAllowance)
      .catch(() => setAllowance(null))
      .finally(() => setLoading(false));
  }, [userKey, refreshTrigger]);

  if (loading) {
    return (
      <div className="allowance-display">
        <span className="text-muted">Allowance:</span>
        <span className="text-mono">Loading…</span>
      </div>
    );
  }

  if (allowance === null) {
    return (
      <div className="allowance-display">
        <span className="text-muted">Allowance:</span>
        <span className="text-error">Unavailable</span>
      </div>
    );
  }

  const warningMultiplier = 3n;
  const criticalMultiplier = 1n;

  let healthState = "Healthy";
  let badgeClass = "badge-success";

  if (allowance < subscriptionAmount * criticalMultiplier) {
    healthState = "Critical";
    badgeClass = "badge-error";
  } else if (allowance < subscriptionAmount * warningMultiplier) {
    healthState = "Warning";
    badgeClass = "badge-warning";
  }

  return (
    <div className="allowance-display">
      <span className="text-muted">Allowance:</span>
      <span className="text-mono">{formatXlm(allowance)}</span>
      <span className={`badge ${badgeClass}`}>{healthState}</span>
    </div>
  );
}
