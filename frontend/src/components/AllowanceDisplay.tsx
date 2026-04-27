import React, { useEffect, useState } from "react";
import { getAllowance } from "../stellar";
import { formatXlm } from "../utils/format";

interface Props {
  userKey: string;
  tokenId: string;
  subscriptionAmount: bigint;
}

export default function AllowanceDisplay({ userKey, tokenId, subscriptionAmount }: Props) {
  const [allowance, setAllowance] = useState<bigint | null>(null);

  useEffect(() => {
    getAllowance(userKey, tokenId)
      .then(setAllowance)
      .catch(() => setAllowance(null));
  }, [userKey, tokenId]);

  if (allowance === null) return null;

  const isLow = allowance < subscriptionAmount;

  return (
    <div className="allowance-display">
      <span className="text-muted">Allowance:</span>
      <span className="text-mono">{formatXlm(allowance)}</span>
      {isLow && <span className="badge badge-warning">Low allowance</span>}
    </div>
  );
}
