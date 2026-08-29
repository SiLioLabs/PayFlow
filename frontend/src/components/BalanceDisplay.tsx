import React from "react";
import { useStellarBalance } from "../hooks/useStellarBalance";
import { formatXlm } from "../utils/format";

interface BalanceDisplayProps {
  address: string;
}

export default function BalanceDisplay({ address }: BalanceDisplayProps) {
  const { balance, loading, stale } = useStellarBalance(address);

  if (loading && !stale) {
    return <div className="skeleton balance-skeleton" />;
  }

  return (
    <div className="flex flex-col">
      <span className="wallet-bar__label">Balance</span>
      <span className="wallet-bar__address text-mono">
        {balance ? formatXlm(BigInt(Math.floor(Number(balance) * 10_000_000))) : "0.0000000 XLM"}
      </span>
    </div>
  );
}
