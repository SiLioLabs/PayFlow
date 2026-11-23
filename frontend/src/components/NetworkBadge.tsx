import React from "react";
import { isMainnetPassphrase } from "../utils/network";
import { NETWORK_PASSPHRASE } from "../stellar";

/**
 * NetworkBadge: displays Testnet or Mainnet label derived from NETWORK_PASSPHRASE (#59)
 * Uses .badge-testnet / .badge-mainnet CSS classes — zero inline styles.
 * Always visible (App shell + WalletBar) so users can tell network at a glance.
 * Mainnet badge uses danger styling to draw attention per SECURITY.md caution.
 */
export default function NetworkBadge() {
  const passphrase = NETWORK_PASSPHRASE;
  const isMainnet = isMainnetPassphrase(passphrase);
  const networkName = isMainnet ? "Mainnet" : "Testnet";

  return (
    <span
      data-testid="network-badge"
      aria-label={`Network: ${networkName}`}
      title={isMainnet ? "Mainnet — real funds at risk" : "Testnet"}
      className={`badge ${isMainnet ? "badge-mainnet" : "badge-testnet"}`}
    >
      {networkName}
    </span>
  );
}
