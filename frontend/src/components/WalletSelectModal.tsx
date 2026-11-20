import React, { useEffect, useState, useRef, useCallback } from "react";
import { WalletAdapter } from "../services/wallets/WalletAdapter";
import type { WalletStatus } from "../hooks/useWalletStatus";
import { useFocusTrap } from "../hooks/useFocusTrap";

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
  >(() => adapters.map((adapter) => ({ adapter, installed: true })));
  const [lastAttemptedAdapter, setLastAttemptedAdapter] = useState<WalletAdapter | null>(null);
  const [isChecking, setIsChecking] = useState(adapters.length > 0);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true, onClose);

  const checkAdapters = useCallback(() => {
    let mounted = true;
    setIsChecking(adapters.length > 0);
    setDiscoveryError(null);

    if (adapters.length === 0) {
      setInstalledAdapters([]);
      setIsChecking(false);
      return () => {
        mounted = false;
      };
    }

    Promise.allSettled(
      adapters.map(async (adapter) => {
        const installed = await adapter.isInstalled();
        return { adapter, installed };
      })
    )
      .then((results) => {
        if (!mounted) return;
        const discovered: { adapter: WalletAdapter; installed: boolean }[] = [];
        let failures = 0;

        results.forEach((res, index) => {
          if (res.status === "fulfilled") {
            discovered.push(res.value);
          } else {
            failures++;
            // Preserve individual adapter even if checking availability failed
            discovered.push({ adapter: adapters[index], installed: false });
          }
        });

        setInstalledAdapters(discovered);
        setIsChecking(false);

        if (failures === adapters.length && adapters.length > 0) {
          setDiscoveryError("Failed to detect available wallets.");
        }
      })
      .catch(() => {
        if (!mounted) return;
        setIsChecking(false);
        setDiscoveryError("Failed to check wallet availability.");
      });

    return () => {
      mounted = false;
    };
  }, [adapters]);

  useEffect(() => {
    return checkAdapters();
  }, [checkAdapters]);

  function handleSelect(adapter: WalletAdapter) {
    setLastAttemptedAdapter(adapter);
    onSelect(adapter);
  }

  const isConnecting = connectionStatus === "connecting";
  const hasError = connectionStatus === "error";
  const retryAdapter = lastAttemptedAdapter || adapters[0];

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
      >
        <h3 id="wallet-modal-title" className="text-xl font-bold mb-4">Connect Wallet</h3>
        <p className="text-muted mb-4">Select a wallet to connect to PayFlow.</p>

        {/* Discovery error state with retry */}
        {discoveryError && (
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
            data-testid="wallet-discovery-error"
          >
            <p style={{ color: "var(--color-danger-text)", fontSize: "13px", marginBottom: "8px" }}>
              <strong>Discovery Failed:</strong> {discoveryError}
            </p>
            <button
              className="btn-secondary"
              onClick={checkAdapters}
              style={{ fontSize: "12px", padding: "6px 12px" }}
              data-testid="wallet-discovery-retry-button"
            >
              Retry Check
            </button>
          </div>
        )}

        {/* Connection error state with retry */}
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
            {retryAdapter && (
              <button
                className="btn-secondary"
                onClick={() => handleSelect(retryAdapter)}
                style={{ fontSize: "12px", padding: "6px 12px" }}
                data-testid="wallet-retry-button"
                aria-label={`Retry connecting to ${retryAdapter.name}`}
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
          {isChecking && installedAdapters.length === 0 && (
            <p className="text-muted text-center py-4" role="status">
              Checking for available wallets...
            </p>
          )}
          {!isChecking && installedAdapters.length === 0 && !discoveryError && (
            <p className="text-muted text-center py-4" role="status">
              No wallets available.
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
