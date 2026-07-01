import React from "react";
import { NETWORK_PASSPHRASE } from "../stellar";

/**
 * NetworkBadge: displays Testnet or Mainnet label derived from NETWORK_PASSPHRASE (#59)
 * Uses .badge-testnet / .badge-mainnet CSS classes — zero inline styles.
 */
export default function NetworkBadge() {
  const passphrase = NETWORK_PASSPHRASE;
  const isMainnet = passphrase.includes("Public Global");
  const networkName = isMainnet ? "Mainnet" : "Testnet";

  return (
    <span className={`badge ${isMainnet ? "badge-mainnet" : "badge-testnet"}`}>{networkName}</span>
  );
}
