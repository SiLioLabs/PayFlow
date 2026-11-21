import React from "react";
import { useStellarBalance } from "../hooks/useStellarBalance";
import { formatXlm } from "../utils/format";
import { STROOPS_PER_XLM } from "../constants";

interface BalanceDisplayProps {
  address: string;
  tokenId?: string;
}

export default function BalanceDisplay({ address, tokenId }: BalanceDisplayProps) {
  const { balance, loading, stale, error } = useStellarBalance(address, 10000, tokenId);

  if (loading && !stale) {
    return <div className="skeleton balance-skeleton" />;
  }

  if (error && balance === "0") {
    return (
      <div className="flex flex-col">
        <span className="wallet-bar__label">Balance</span>
        <span
          className="wallet-bar__address text-mono text-error"
          title={error}
          aria-label={`Balance unavailable: ${error}`}
          data-testid="balance-error"
          role="alert"
        >
          Unavailable
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span className="wallet-bar__label">Balance</span>
      <span className="wallet-bar__address text-mono">
        {balance ? formatXlm(BigInt(Math.floor(Number(balance) * STROOPS_PER_XLM))) : "0.0000000 XLM"}
      </span>
    </div>
  );
}
