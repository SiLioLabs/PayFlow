import React from "react";

/**
 * NetworkBadge: displays Testnet or Mainnet label derived from NETWORK_PASSPHRASE (#59)
 * Uses .badge-testnet / .badge-mainnet CSS classes — zero inline styles.
 */
export default function NetworkBadge() {
  const passphrase = import.meta.env.VITE_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
  const isMainnet = passphrase.includes("Public Global");
  const networkName = isMainnet ? "Mainnet" : "Testnet";

  return (
    <span
      className={`badge ${isMainnet ? "badge-mainnet" : "badge-testnet"}`}
    >
      {networkName}
    </span>
  );
}
