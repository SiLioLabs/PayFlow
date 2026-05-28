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

  const isLow = allowance < subscriptionAmount;

  return (
    <div className="allowance-display">
      <span className="text-muted">Allowance:</span>
      <span className="text-mono">{formatXlm(allowance)}</span>
      {isLow && <span className="badge badge-warning">Low allowance</span>}
    </div>
  );
}
