/*
 * Chunk size note (Issue #445):
 *   Before lazy-loading:
 *     main chunk included MerchantDashboard (~8 KB) and SubscriptionHistory
 *     (~7.5 KB) regardless of the active tab, delaying initial parse.
 *   After lazy-loading:
 *     MerchantDashboard is split into a dedicated "merchant" chunk via the
 *     Vite chunk comment below. SubscriptionHistory is split into its own
 *     dynamic chunk. The main entry chunk no longer contains either component.
 */
import React, { useState, useRef, lazy, Suspense } from "react";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useResponsive } from "./hooks/useResponsive";
import { useAccessibility } from "./hooks/useAccessibility";
import { useNetworkCheck } from "./hooks/useNetworkCheck";

import { useContractId } from "./hooks/useContractId";
import { useRpcHealth } from "./hooks/useRpcHealth";
import { useSubscriberCount } from "./hooks/useSubscriberCount";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useRegisterShortcuts } from "./context/ShortcutRegistry";
import { useAnalytics } from "./hooks/useAnalytics";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import OfflineBanner from "./components/OfflineBanner";
import AmountUnitToggle from "./components/AmountUnitToggle";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import SystemHealthCard from "./components/SystemHealthCard";
import TabBar from "./components/TabBar";
import ConnectWallet from "./components/ConnectWallet";
import WalletBar from "./components/WalletBar";
import ErrorBoundary from "./components/ErrorBoundary";
import TxQueuePanel from "./components/TxQueuePanel";
import SubscriptionCardSkeleton from "./components/Skeleton";
import ShortcutHelpOverlay from "./components/ShortcutHelpOverlay";
import WalletSelectModal from "./components/WalletSelectModal";
import { AVAILABLE_WALLETS } from "./hooks/useWallet";
import { WalletAdapter } from "./services/wallets/WalletAdapter";

import RpcSettings from "./components/RpcSettings";

// Lazy-loaded components — split into separate chunks to keep the main bundle lean.
// MerchantDashboard gets a dedicated Vite chunk name for easier bundle analysis.
const MerchantDashboard = lazy(
  () => import(/* @vite-chunk-name: "merchant" */ "./components/MerchantDashboard")
);

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function TabErrorFallback({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="error-boundary">
      <div className="card error-boundary__card">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-danger)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="error-boundary__icon"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <h2 className="text-xl font-semibold mb-2">{title} encountered an error</h2>
        <p className="text-muted text-sm mb-6">Try again to continue.</p>
        <button className="btn-primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { publicKey, connect, signAndSubmit, disconnect, error, connecting, activeAdapter } = useWallet();
  const { theme, toggle } = useTheme();

  const { networkMatch, walletNetwork } = useNetworkCheck();
  const { valid: contractIdValid, error: contractIdError } = useContractId();
  const {
    circuitOpen: rpcCircuitOpen,
    status: rpcStatus,
    latencyMs: rpcLatency,
    error: rpcError,
  } = useRpcHealth();
  const { isMobile } = useResponsive();
  const { announcement, announce } = useAccessibility();
  const { count: subscriberCount, loading: subscriberCountLoading } = useSubscriberCount();
  const [tab, setTab] = useLocalStorage<"subscribe" | "dashboard" | "merchant" | "admin">(
    "flowpay_tab",
    "dashboard"
  );
  const [refresh, setRefresh] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showRpcSettings, setShowRpcSettings] = useState(false);
  const { isOptedIn: analyticsEnabled, setOptIn: setAnalyticsOptIn, track } = useAnalytics();
  const isOnline = useNetworkStatus();

  const subscribeErrorBoundaryRef = useRef<ErrorBoundary>(null);
  const dashboardErrorBoundaryRef = useRef<ErrorBoundary>(null);
  const merchantErrorBoundaryRef = useRef<ErrorBoundary>(null);
  const adminErrorBoundaryRef = useRef<ErrorBoundary>(null);

  // Global keyboard shortcuts
  useRegisterShortcuts([
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
      key: "a",
      description: "Switch to Admin",
      action: () => setTab("admin"),
    },
    {
      key: "?",
      description: "Show keyboard shortcuts",
      action: () => setShowHelp((prev) => !prev),
    },
  ]);

  const shortcuts = useKeyboardShortcuts({
    enabled: !!publicKey,
  });

  async function handleConnectWallet(adapter: WalletAdapter) {
    setShowWalletModal(false);
    await connect(adapter);
    track({ type: "wallet_connected" });
  }


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
          <p className="app-header__subtitle">
            Decentralized recurring payments on Stellar
            {!subscriberCountLoading && (
              <span style={{ marginLeft: "8px", opacity: 0.7 }}>
                • {subscriberCount} active subscriber{subscriberCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* Amount unit toggle — switches all amount displays between XLM and STROOP */}
          <AmountUnitToggle />
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
          <button
            className="btn-secondary theme-toggle"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      {showHelp && publicKey && (
        <ShortcutHelpOverlay shortcuts={shortcuts} onClose={() => setShowHelp(false)} />
      )}

      {/* Offline banner — shown when navigator.onLine is false */}
      <OfflineBanner visible={!isOnline} />

      {/* Contract ID error */}
      {!contractIdValid && contractIdError && (
        <div className="network-warning" role="alert">
          <span>❌</span>
          <span>{contractIdError}</span>
        </div>
      )}

      {/* RPC health warning */}
      {rpcStatus === "degraded" && (
        <div className="network-warning network-warning--degraded" role="alert">
          <span>⚠️</span>
          <span>RPC connection degraded: Latency is high ({rpcLatency}ms)</span>
        </div>
      )}
      {rpcStatus === "unreachable" && rpcError && (
        <div className="network-warning" role="alert">
          <span>{rpcCircuitOpen ? "🔴" : "⚠️"}</span>
          <span>
            {rpcCircuitOpen
              ? `RPC circuit open — all requests blocked: ${rpcError}`
              : `RPC endpoint unreachable: ${rpcError}`}
            {" "}
            <button
              className="btn-secondary"
              style={{ marginLeft: "8px", fontSize: "12px", padding: "2px 10px" }}
              onClick={() => setShowRpcSettings(true)}
              data-testid="rpc-failure-banner-change-btn"
              aria-label="Try a different RPC endpoint"
            >
              Try a different endpoint
            </button>
          </span>
        </div>
      )}
      {showRpcSettings && <RpcSettings onClose={() => setShowRpcSettings(false)} />}
      {publicKey && !networkMatch && (
        <div className="network-warning" role="alert">
          <span>⚠️</span>
          <span>
            Wallet is on <strong>{walletNetwork}</strong> — app expects a different network. Switch
            networks in Freighter to continue.
          </span>
        </div>
      )}

      {/* Not connected */}
      {!publicKey && (
        <>
          <div className="card connect-wallet">
            <p className="connect-wallet__hint">
              Help improve FlowPay with optional anonymous usage analytics.
            </p>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
              <button
                className={`btn-secondary${analyticsEnabled ? " active" : ""}`}
                onClick={() => setAnalyticsOptIn(true)}
                type="button"
              >
                Opt in
              </button>
              <button
                className={`btn-secondary${!analyticsEnabled ? " active" : ""}`}
                onClick={() => setAnalyticsOptIn(false)}
                type="button"
              >
                Keep disabled
              </button>
            </div>
          </div>
          <ConnectWallet onConnect={() => setShowWalletModal(true)} error={error} loading={connecting} />
        </>
      )}

      {showWalletModal && (
        <WalletSelectModal
          adapters={AVAILABLE_WALLETS}
          onSelect={handleConnectWallet}
          onClose={() => setShowWalletModal(false)}
        />
      )}

      {/* Connected */}
      {publicKey && (
        <>
          <WalletBar publicKey={publicKey} activeAdapter={activeAdapter} onDisconnect={disconnect} />


          {/* Tabs */}
          <TabBar
            tabs={["dashboard", "subscribe", "merchant", "admin"]}
            activeTab={tab}
            onTabChange={setTab}
          />

          {/* Content */}
          <div className="card">
            {tab === "subscribe" ? (
              <ErrorBoundary
                ref={subscribeErrorBoundaryRef}
                fallback={
                  <TabErrorFallback
                    title="Subscribe Form"
                    onRetry={() => subscribeErrorBoundaryRef.current?.reset()}
                  />
                }
              >
                <SubscribeForm
                  userKey={publicKey}
                  onSign={signAndSubmit}
                  onSubscribed={() => track({ type: "subscription_created" })}
                  onSuccess={() => {
                    setTab("dashboard");
                    setRefresh((r) => r + 1);
                  }}
                  announce={announce}
                />
              </ErrorBoundary>
            ) : tab === "merchant" ? (
              <ErrorBoundary
                ref={merchantErrorBoundaryRef}
                fallback={
                  <TabErrorFallback
                    title="Merchant Dashboard"
                    onRetry={() => merchantErrorBoundaryRef.current?.reset()}
                  />
                }
              >
                <Suspense fallback={<SubscriptionCardSkeleton />}>
                  <MerchantDashboard
                    merchantKey={publicKey}
                    onSign={signAndSubmit}
                    refreshTrigger={refresh}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : tab === "admin" ? (
              <ErrorBoundary
                ref={adminErrorBoundaryRef}
                fallback={
                  <TabErrorFallback
                    title="Admin Dashboard"
                    onRetry={() => adminErrorBoundaryRef.current?.reset()}
                  />
                }
              >
                <>
                  <SystemHealthCard callerKey={publicKey} />
                  <AdminDashboard publicKey={publicKey} onSign={signAndSubmit} />
                </>
              </ErrorBoundary>
            ) : (
              <ErrorBoundary
                ref={dashboardErrorBoundaryRef}
                fallback={
                  <TabErrorFallback
                    title="Dashboard"
                    onRetry={() => dashboardErrorBoundaryRef.current?.reset()}
                  />
                }
              >
                <Dashboard
                  userKey={publicKey}
                  onSign={signAndSubmit}
                  refreshTrigger={refresh}
                  announce={announce}
                  onCancelled={() => track({ type: "subscription_cancelled" })}
                  onPayPerUse={(amount) =>
                    track({ type: "pay_per_use", payload: { amountStroops: amount } })
                  }
                />
              </ErrorBoundary>
            )}
          </div>
        </>
      )}

      {/* Fixed transaction queue panel — visible whenever there is at least one tx */}
      <TxQueuePanel />
    </div>
  );
}
