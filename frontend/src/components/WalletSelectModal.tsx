import React, { useEffect, useState } from "react";
import { WalletAdapter } from "../services/wallets/WalletAdapter";

interface WalletSelectModalProps {
  adapters: WalletAdapter[];
  onSelect: (adapter: WalletAdapter) => void;
  onClose: () => void;
}

export default function WalletSelectModal({ adapters, onSelect, onClose }: WalletSelectModalProps) {
  const [installedAdapters, setInstalledAdapters] = useState<
    { adapter: WalletAdapter; installed: boolean }[]
  >([]);

  useEffect(() => {
    let mounted = true;
    Promise.all(
      adapters.map(async (adapter) => {
        try {
          const installed = await adapter.isInstalled();
          return { adapter, installed };
        } catch {
          return { adapter, installed: false };
        }
      })
    ).then((results) => {
      if (mounted) setInstalledAdapters(results);
    });
    return () => {
      mounted = false;
    };
  }, [adapters]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold mb-4">Connect Wallet</h3>
        <p className="text-muted mb-4">Select a wallet to connect to PayFlow.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {installedAdapters.map(({ adapter, installed }) => (
            <button
              key={adapter.id}
              className="btn-secondary"
              onClick={() => onSelect(adapter)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-3) var(--space-4)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontSize: "1.5rem" }}>{adapter.icon}</span>
                <span className="font-semibold">{adapter.name}</span>
              </div>
              {!installed && (
                <span className="badge badge-warning" style={{ fontSize: "0.75rem" }}>
                  Not Installed
                </span>
              )}
            </button>
          ))}
          {installedAdapters.length === 0 && (
            <p className="text-muted text-center py-4">Checking for available wallets...</p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
