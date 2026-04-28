import React, { useState } from "react";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";
import { useFreighterAvailable } from "./hooks/useFreighterAvailable";
import { useNetworkCheck } from "./hooks/useNetworkCheck";
import { useContractId } from "./hooks/useContractId";
import { useRpcHealth } from "./hooks/useRpcHealth";
import { useSubscriberCount } from "./hooks/useSubscriberCount";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import MerchantDashboard from "./components/MerchantDashboard";
import TabBar from "./components/TabBar";
import ConnectWallet from "./components/ConnectWallet";
import WalletBar from "./components/WalletBar";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export default function App() {
  const { publicKey, connect, signAndSubmit, disconnect, error } = useWallet();
  const { theme, toggle } = useTheme();
  const { available: freighterAvailable, installUrl } = useFreighterAvailable();
  const { networkMatch, walletNetwork } = useNetworkCheck();
  const { valid: contractIdValid, error: contractIdError } = useContractId();
  const { healthy: rpcHealthy, error: rpcError } = useRpcHealth();
  const { count: subscriberCount, loading: subscriberCountLoading } = useSubscriberCount();
  const [tab, setTab] = useState<"subscribe" | "dashboard" | "merchant">("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  // Keyboard shortcuts
  const shortcuts = useKeyboardShortcuts({
    enabled: !!publicKey,
    shortcuts: [
      {
        key: "d",
        description: "Switch to Dashboard",
        action: () => setTab("dashboard"),
      },
      {
        key: "s",
        description: "Switch to Subscribe",
        action: () => setTab("subscribe"),
      },
      {
        key: "m",
        description: "Switch to Merchant",
        action: () => setTab("merchant"),
      },
      {
        key: "?",
        description: "Show keyboard shortcuts",
        action: () => setShowHelp((prev) => !prev),
      },
    ],
  });

  return (
    <div className="app-shell">
      {/* Header */}
      <div className="app-header">
        <div>
          <h1 className="app-header__title">⚡ FlowPay</h1>
          <p className="app-header__subtitle">
            Decentralized recurring payments on Stellar
            {!subscriberCountLoading && (
              <span style={{ marginLeft: "8px", opacity: 0.7 }}>
                • {subscriberCount} active subscriber{subscriberCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {publicKey && (
            <button
              className="btn-secondary theme-toggle"
              onClick={() => setShowHelp((prev) => !prev)}
              aria-label="Show keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <HelpIcon />
            </button>
          )}
          <button className="btn-secondary theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      {showHelp && publicKey && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Keyboard Shortcuts</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {shortcuts.map((shortcut) => (
                <div
                  key={shortcut.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <span>{shortcut.description}</span>
                  <kbd
                    style={{
                      padding: "4px 8px",
                      borderRadius: "4px",
                      backgroundColor: "var(--color-bg-secondary)",
                      border: "1px solid var(--color-border)",
                      fontFamily: "monospace",
                      fontSize: "14px",
                    }}
                  >
                    {shortcut.key}
                  </kbd>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "16px",
                }}
              >
                <span>Close modals</span>
                <kbd
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    backgroundColor: "var(--color-bg-secondary)",
                    border: "1px solid var(--color-border)",
                    fontFamily: "monospace",
                    fontSize: "14px",
                  }}
                >
                  Esc
                </kbd>
              </div>
            </div>
            <div style={{ marginTop: "16px", textAlign: "right" }}>
              <button className="btn-secondary" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contract ID error */}
      {!contractIdValid && contractIdError && (
        <div className="network-warning" role="alert">
          <span>❌</span>
          <span>{contractIdError}</span>
        </div>
      )}

      {/* RPC health warning */}
      {!rpcHealthy && rpcError && (
        <div className="network-warning" role="alert">
          <span>⚠️</span>
          <span>RPC endpoint unreachable: {rpcError}</span>
        </div>
      )}
      {publicKey && !networkMatch && (
        <div className="network-warning" role="alert">
          <span>⚠️</span>
          <span>
            Wallet is on <strong>{walletNetwork}</strong> — app expects a
            different network. Switch networks in Freighter to continue.
          </span>
        </div>
      )}

      {/* Freighter not installed — show install prompt */}
      {!freighterAvailable && !publicKey && (
        <div className="card connect-wallet">
          <p className="connect-wallet__hint">
            Freighter wallet is required to use FlowPay.
          </p>
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full connect-wallet__install-link"
          >
            Install Freighter
          </a>
        </div>
      )}

      {/* Freighter installed but not connected */}
      {freighterAvailable && !publicKey && (
        <ConnectWallet onConnect={connect} error={error} />
      )}

      {/* Connected */}
      {publicKey && (
        <>
          <WalletBar publicKey={publicKey} onDisconnect={disconnect} />

          {/* Tabs */}
          <TabBar
            tabs={["dashboard", "subscribe", "merchant"]}
            activeTab={tab}
            onTabChange={setTab}
          />

          {/* Content */}
          <div className="card">
            {tab === "subscribe" ? (
              <SubscribeForm
                userKey={publicKey}
                onSign={signAndSubmit}
                onSuccess={() => {
                  setTab("dashboard");
                  setRefresh((r) => r + 1);
                }}
              />
            ) : tab === "merchant" ? (
              <MerchantDashboard
                merchantKey={publicKey}
                refreshTrigger={refresh}
              />
            ) : (
              <Dashboard
                userKey={publicKey}
                onSign={signAndSubmit}
                refreshTrigger={refresh}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
