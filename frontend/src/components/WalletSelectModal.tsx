import React, { useEffect, useState } from "react";
import { WalletAdapter } from "../services/wallets/WalletAdapter";
import type { WalletStatus } from "../hooks/useWalletStatus";

interface WalletSelectModalProps {
  adapters: WalletAdapter[];
  onSelect: (adapter: WalletAdapter) => void;
  onClose: () => void;
  connectionStatus?: WalletStatus;
  error?: string | null;
}

export default function WalletSelectModal({
  adapters,
  onSelect,
  onClose,
  connectionStatus = "notStarted",
  error = null,
}: WalletSelectModalProps) {
  const [installedAdapters, setInstalledAdapters] = useState<
    { adapter: WalletAdapter; installed: boolean }[]
  >([]);
  const [lastAttemptedAdapter, setLastAttemptedAdapter] = useState<WalletAdapter | null>(null);

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

  function handleSelect(adapter: WalletAdapter) {
    setLastAttemptedAdapter(adapter);
    onSelect(adapter);
  }

  const isConnecting = connectionStatus === "connecting";
  const hasError = connectionStatus === "error";

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h3 id="wallet-modal-title" className="text-xl font-bold mb-4">Connect Wallet</h3>
        <p className="text-muted mb-4">Select a wallet to connect to PayFlow.</p>

        {/* Error state with retry */}
        {hasError && error && (
          <div
            role="alert"
            aria-live="assertive"
            className="card"
            style={{
              background: "var(--color-danger-bg)",
              border: "1px solid var(--color-danger)",
              marginBottom: "16px",
              padding: "12px",
            }}
            data-testid="wallet-connection-error"
          >
            <p style={{ color: "var(--color-danger-text)", fontSize: "13px", marginBottom: "8px" }}>
              <strong>Connection Failed:</strong> {error}
            </p>
            {lastAttemptedAdapter && (
              <button
                className="btn-secondary"
                onClick={() => handleSelect(lastAttemptedAdapter)}
                style={{ fontSize: "12px", padding: "6px 12px" }}
                data-testid="wallet-retry-button"
                aria-label={`Retry connecting to ${lastAttemptedAdapter.name}`}
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {installedAdapters.map(({ adapter, installed }) => (
            <button
              key={adapter.id}
              className="btn-secondary"
              onClick={() => handleSelect(adapter)}
              disabled={isConnecting}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-3) var(--space-4)",
              }}
              aria-busy={isConnecting && lastAttemptedAdapter?.id === adapter.id}
              data-testid={`wallet-option-${adapter.id}`}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontSize: "1.5rem" }} aria-hidden="true">{adapter.icon}</span>
                <span className="font-semibold">{adapter.name}</span>
                {isConnecting && lastAttemptedAdapter?.id === adapter.id && (
                  <span className="text-muted" style={{ fontSize: "0.875rem" }}>
                    (Connecting...)
                  </span>
                )}
              </div>
              {!installed && (
                <span className="badge badge-warning" style={{ fontSize: "0.75rem" }}>
                  Not Installed
                </span>
              )}
            </button>
          ))}
          {installedAdapters.length === 0 && (
            <p className="text-muted text-center py-4" role="status">
              Checking for available wallets...
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={isConnecting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
