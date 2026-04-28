import React, { useState } from "react";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useResponsive } from "./hooks/useResponsive";
import { useAccessibility } from "./hooks/useAccessibility";
import { useFreighterAvailable } from "./hooks/useFreighterAvailable";
import { useNetworkCheck } from "./hooks/useNetworkCheck";
import { useContractId } from "./hooks/useContractId";
import { useRpcHealth } from "./hooks/useRpcHealth";
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

export default function App() {
  const { publicKey, connect, signAndSubmit, disconnect, error } = useWallet();
  const { theme, toggle } = useTheme();
  const { available: freighterAvailable, installUrl } = useFreighterAvailable();
  const { networkMatch, walletNetwork } = useNetworkCheck();
  const { valid: contractIdValid, error: contractIdError } = useContractId();
  const { healthy: rpcHealthy, error: rpcError } = useRpcHealth();
  const { isMobile } = useResponsive();
  const { announcement, announce } = useAccessibility();
  const [tab, setTab] = useLocalStorage<"subscribe" | "dashboard" | "merchant">("flowpay_tab", "dashboard");
  const [refresh, setRefresh] = useState(0);

  return (
    <div className={`app-shell${isMobile ? " app-shell--mobile" : ""}`}>
      {/* ARIA live region for screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Header */}
      <div className="app-header">
        <div>
          <h1 className="app-header__title">⚡ FlowPay</h1>
          <p className="app-header__subtitle">Decentralized recurring payments on Stellar</p>
        </div>
        <button className="btn-secondary theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

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
                announce={announce}
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
                announce={announce}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
