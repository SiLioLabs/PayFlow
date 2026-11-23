import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useWallet, AVAILABLE_WALLETS } from "./hooks/useWallet";
import { useAccessibility } from "./hooks/useAccessibility";
import { useRpcHealthContext } from "./context/RpcHealthContext";
import { ToastProvider } from "./context/ToastContext";
import { useToast } from "./hooks/useToast";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import RpcSettings from "./components/RpcSettings";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useAdmin } from "./hooks/useAdmin";
import { useContractId } from "./hooks/useContractId";
import { useContractPaused } from "./hooks/useContractPaused";
import MerchantDashboard from "./components/MerchantDashboard";
import WalletSelectModal from "./components/WalletSelectModal";
import WalletBar from "./components/WalletBar";
import TabBar from "./components/TabBar";
import OfflineBanner from "./components/OfflineBanner";
import ContractPauseBanner from "./components/ContractPauseBanner";
import NetworkBadge from "./components/NetworkBadge";
import AdminDashboard from "./pages/AdminDashboard";
import type { WalletAdapter } from "./services/wallets/WalletAdapter";
import ConnectWallet from "./components/ConnectWallet";
import ShortcutHelpOverlay from "./components/ShortcutHelpOverlay";
import { ShortcutRegistryContext } from "./context/ShortcutRegistry";

type Tab = "dashboard" | "subscribe" | "merchant" | "admin";

function AppInner() {
  const { publicKey, connect, disconnect, signAndSubmit, error, connecting, connectionStatus, activeAdapter } =
    useWallet();
  const { announcement, announce } = useAccessibility();
  const { healthy, circuitOpen } = useRpcHealthContext();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [showRpcSettings, setShowRpcSettings] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const shortcutRegistry = useContext(ShortcutRegistryContext);

  const isRpcFailing = !healthy || circuitOpen;
  const {
    isOnline,
    networkMatch,
    walletNetwork,
    isMainnet,
    requiresMainnetConfirm,
    confirmMainnet,
  } = useNetworkStatus();
  const { valid: isContractIdValid, error: contractIdError } = useContractId();
  const { isAdmin } = useAdmin(publicKey);
  const { isPaused, status: contractStatus } = useContractPaused();
  const { notifications, unreadCount, markAllRead, clearNotifications } = useToast();
  const [showWalletModal, setShowWalletModal] = useState(false);
  const wasOnline = useRef(isOnline);
  const closeShortcutHelp = useCallback(() => setShowShortcutHelp(false), []);

  // Announce connectivity changes via the ARIA live region (issue: disable
  // mutating CTAs while offline + announce status).
  useEffect(() => {
    if (wasOnline.current === isOnline) return;
    wasOnline.current = isOnline;
    announce(
      isOnline
        ? "Back online. Wallet actions are available again."
        : "You are offline. Wallet actions are unavailable."
    );
  }, [isOnline, announce]);

  // Combine configuration and network validation into a single actionable gate
  let gatePassed = true;
  let gateError: string | null = null;

  if (!isContractIdValid) {
    gatePassed = false;
    gateError = contractIdError;
  } else if (publicKey && !networkMatch) {
    gatePassed = false;
    gateError = `Wallet is on "${walletNetwork}" — app expects a different network. Please switch your wallet network to match "${import.meta.env.VITE_NETWORK_PASSPHRASE || "testnet"}".`;
  }

  useEffect(() => {
    if (gateError) {
      announce?.(`Configuration Warning: ${gateError}`);
    }
  }, [gateError, announce]);

  async function handleSelectWallet(adapter: WalletAdapter) {
    setShowWalletModal(false);
    await connect(adapter);
  }

  // Admin tab is only included when the connected wallet is the contract admin
  const visibleTabs: readonly Tab[] = isAdmin
    ? (["dashboard", "subscribe", "merchant", "admin"] as const)
    : (["dashboard", "subscribe", "merchant"] as const);

  return (
    <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 16px" }}>
      {/* Contract pause banner — rendered first so it takes precedence over
          everything else, including toasts (see index.css stacking rules). */}
      <ContractPauseBanner paused={isPaused} contractStatus={contractStatus} />

      {/* ARIA live region for screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <OfflineBanner visible={!isOnline} />

      {/* Header — NetworkBadge is persistent in shell so users always see Testnet/Mainnet */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#a78bfa" }}>⚡ FlowPay</h1>
        <p style={{ color: "#64748b", marginTop: 6, fontSize: 14 }}>
          Decentralized recurring payments on Stellar
        </p>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
          <NetworkBadge />
        </div>
      </div>

      {/* Actionable gate warning banner */}
      {gateError && (
        <div
          className="card"
          style={{ background: "var(--color-danger-bg)", marginBottom: 16, textAlign: "center" }}
          data-testid="gate-warning"
        >
          <p style={{ color: "var(--color-danger-text)", fontSize: 13 }}>
            ⚠ <strong>Configuration/Network Gate Warning:</strong> {gateError}
          </p>
        </div>
      )}

      {/* RPC Failure Banner */}
      {isRpcFailing && (
        <div
          role="alert"
          data-testid="rpc-failure-banner"
          className="card"
          style={{
            background: "var(--color-danger-bg, #451a1a)",
            color: "var(--color-danger-text, #f87171)",
            border: "1px solid var(--color-danger, #ef4444)",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
          }}
        >
          <span style={{ fontSize: 13 }}>
            ⚠️ RPC endpoint is unreachable. Try a different endpoint.
          </span>
          <button
            className="btn-secondary"
            onClick={() => setShowRpcSettings(true)}
            data-testid="rpc-failure-banner-change-btn"
            aria-label="Try a different RPC endpoint"
            style={{ fontSize: 12, padding: "4px 8px", whiteSpace: "nowrap" }}
          >
            Try a different endpoint
          </button>
        </div>
      )}

      {/* Mainnet safety gate — require explicit confirmation once per session when passphrase is mainnet */}
      {isMainnet && requiresMainnetConfirm && (
        <div
          className="card"
          style={{
            background: "var(--color-warning-bg)",
            borderColor: "var(--color-warning)",
            marginBottom: 16,
          }}
        >
          <p style={{ color: "var(--color-warning-text)", fontSize: 13, fontWeight: 600 }}>
            ⚠ Mainnet mode — real funds at risk. Please confirm you intend to use Mainnet before
            continuing.
          </p>
          <button
            onClick={confirmMainnet}
            className="btn-primary"
            style={{ marginTop: 12 }}
            data-testid="confirm-mainnet-btn"
          >
            I understand, continue on Mainnet
          </button>
        </div>
      )}

      {showRpcSettings && <RpcSettings onClose={() => setShowRpcSettings(false)} />}

      {/* Wallet connect */}
      {!publicKey ? (
        <ConnectWallet
          onConnect={() => setShowWalletModal(true)}
          error={error}
          loading={connecting}
        />
      ) : (
        <>
          {/* Connected bar — shows adapter name/icon, address, disconnect */}
          <WalletBar
            publicKey={publicKey}
            activeAdapter={activeAdapter}
            onDisconnect={disconnect}
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkAllRead={markAllRead}
            onClearNotifications={clearNotifications}
          />

          {/* Tab navigation — admin tab only visible to contract admin */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TabBar tabs={visibleTabs} activeTab={tab} onTabChange={setTab} />
            </div>
            <button
              type="button"
              className="btn-secondary"
              aria-label="Show keyboard shortcuts"
              title="Keyboard shortcuts"
              onClick={() => setShowShortcutHelp(true)}
            >
              ?
            </button>
          </div>

          {/* Content */}
          <div className="card" style={{ marginTop: 20 }}>
            <div
              role="tabpanel"
              id="panel-subscribe"
              aria-labelledby="tab-subscribe"
              hidden={tab !== "subscribe"}
            >
              {tab === "subscribe" && (
                <SubscribeForm
                  userKey={publicKey}
                  onSign={signAndSubmit}
                  onSuccess={() => {
                    setTab("dashboard");
                    setRefresh((r) => r + 1);
                  }}
                  isPaused={!gatePassed}
                  announce={announce}
                  isOffline={!isOnline}
                />
              )}
            </div>
            <div
              role="tabpanel"
              id="panel-dashboard"
              aria-labelledby="tab-dashboard"
              hidden={tab !== "dashboard"}
            >
              {tab === "dashboard" && (
                <Dashboard
                  userKey={publicKey}
                  onSign={signAndSubmit}
                  refreshTrigger={refresh}
                  announce={announce}
                  isPaused={!gatePassed}
                  isOffline={!isOnline}
                />
              )}
            </div>
            <div
              role="tabpanel"
              id="panel-merchant"
              aria-labelledby="tab-merchant"
              hidden={tab !== "merchant"}
            >
              {tab === "merchant" && (
                <MerchantDashboard
                  merchantKey={publicKey}
                  onSign={signAndSubmit}
                  refreshTrigger={refresh}
                  isPaused={isPaused}
                />
              )}
            </div>
            {isAdmin && (
              <div
                role="tabpanel"
                id="panel-admin"
                aria-labelledby="tab-admin"
                hidden={tab !== "admin"}
              >
                {tab === "admin" && (
                  <AdminDashboard
                    publicKey={publicKey}
                    onSign={signAndSubmit}
                    gatePassed={gatePassed}
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Wallet selector modal — rendered at root so it overlays everything */}
      {showWalletModal && (
        <WalletSelectModal
          adapters={AVAILABLE_WALLETS}
          onSelect={handleSelectWallet}
          onClose={() => setShowWalletModal(false)}
          connectionStatus={connectionStatus}
          error={error}
        />
      )}
      {showShortcutHelp && (
        <ShortcutHelpOverlay
          shortcuts={shortcutRegistry?.shortcuts ?? []}
          onClose={closeShortcutHelp}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
