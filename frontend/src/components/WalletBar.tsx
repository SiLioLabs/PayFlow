import React from "react";
import { formatAddress } from "../utils/format";
import CopyButton from "./CopyButton";
import NetworkBadge from "./NetworkBadge";
import BalanceDisplay from "./BalanceDisplay";
import AmountUnitToggle from "./AmountUnitToggle";
import NotificationCenter from "./NotificationCenter";
import TxQueuePanel from "./TxQueuePanel";
import { useTxQueue } from "../services/txQueue";
import type { Notification } from "../hooks/useToast";
import ThemeToggle from "./ThemeToggle";

import { WalletAdapter } from "../services/wallets/WalletAdapter";

interface WalletBarProps {
  publicKey: string;
  activeAdapter: WalletAdapter | null;
  onDisconnect: () => void;
  notifications?: Notification[];
  unreadCount?: number;
  onMarkAllRead?: () => void;
  onClearNotifications?: () => void;
}

export default function WalletBar({
  publicKey,
  activeAdapter,
  onDisconnect,
  notifications = [],
  unreadCount = 0,
  onMarkAllRead = () => {},
  onClearNotifications = () => {},
}: WalletBarProps) {
  const { queueDepth } = useTxQueue();

  return (
    <div className="card wallet-bar">
      <div className="wallet-bar__content">
        {queueDepth > 0 && (
          <div className="wallet-bar__queue-badge badge badge-warning">
            {queueDepth} transaction{queueDepth > 1 ? "s" : ""} pending
          </div>
        )}
        <TxQueuePanel />
        <div className="wallet-bar__connection">
          <span className="wallet-bar__label">
            Connected via {activeAdapter ? `${activeAdapter.icon} ${activeAdapter.name}` : "Wallet"}
          </span>
          <div className="wallet-bar__address-row">
            <span className="wallet-bar__address">{formatAddress(publicKey)}</span>
            <CopyButton text={publicKey} ariaLabel="Copy wallet address" />
          </div>
        </div>
        <BalanceDisplay address={publicKey} />
        <NetworkBadge />
        <AmountUnitToggle />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <ThemeToggle />
        <NotificationCenter
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAllRead={onMarkAllRead}
          onClearAll={onClearNotifications}
        />
        <button onClick={onDisconnect} className="btn-secondary">
          Disconnect
        </button>
      </div>
    </div>
  );
}
