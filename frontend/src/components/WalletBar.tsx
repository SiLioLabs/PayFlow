import React from "react";
import { formatAddress } from "../utils/format";
import NetworkBadge from "./NetworkBadge";

interface WalletBarProps {
  publicKey: string;
  onDisconnect: () => void;
}

export default function WalletBar({
  publicKey,
  onDisconnect,
}: WalletBarProps) {
  return (
    <div className="card wallet-bar">
      <div className="wallet-bar__content">
        <div>
          <span className="wallet-bar__label">Connected</span>
          <span className="wallet-bar__address">
            {formatAddress(publicKey)}
          </span>
        </div>
        <NetworkBadge />
      </div>
      <button onClick={onDisconnect} className="btn-secondary">
        Disconnect
      </button>
    </div>
  );
}
