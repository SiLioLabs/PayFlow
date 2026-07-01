import React from "react";
import { formatAddress } from "../utils/format";
import CopyButton from "./CopyButton";
import NetworkBadge from "./NetworkBadge";
import BalanceDisplay from "./BalanceDisplay";
import { useTxQueue } from "../services/txQueue";

interface WalletBarProps {
  publicKey: string;
  onDisconnect: () => void;
}

export default function WalletBar({ publicKey, onDisconnect }: WalletBarProps) {
  const { queueDepth } = useTxQueue();

  return (
    <div className="card wallet-bar">
      <div className="wallet-bar__content">
        {queueDepth > 0 && (
          <div className="wallet-bar__queue-badge badge badge-warning">
            {queueDepth} transaction{queueDepth > 1 ? "s" : ""} pending
          </div>
        )}
        <div className="wallet-bar__connection">
          <span className="wallet-bar__label">Connected</span>
          <div className="wallet-bar__address-row">
            <span className="wallet-bar__address">{formatAddress(publicKey)}</span>
            <CopyButton text={publicKey} ariaLabel="Copy wallet address" />
          </div>
        </div>
        <BalanceDisplay address={publicKey} />
        <NetworkBadge />
      </div>
      <button onClick={onDisconnect} className="btn-secondary">
        Disconnect
      </button>
    </div>
  );
}
