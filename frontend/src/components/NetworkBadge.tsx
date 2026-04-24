import React from "react";

/**
 * Display the current Stellar network
 * Reads from VITE_NETWORK_PASSPHRASE environment variable (defaults to testnet)
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
