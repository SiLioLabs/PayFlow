import React, { useState, useEffect } from "react";
import React, { useEffect, useRef, useState } from "react";
import { useWallet, AVAILABLE_WALLETS } from "./hooks/useWallet";
import { useAccessibility } from "./hooks/useAccessibility";
import { useRpcHealthContext } from "./context/RpcHealthContext";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import RpcSettings from "./components/RpcSettings";
import { useNetworkCheck } from "./hooks/useNetworkCheck";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useAdmin } from "./hooks/useAdmin";
import { useContractId } from "./hooks/useContractId";
import { useContractPaused } from "./hooks/useContractPaused";
import { useToast } from "./hooks/useToast";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import MerchantDashboard from "./components/MerchantDashboard";
import WalletSelectModal from "./components/WalletSelectModal";
import WalletBar from "./components/WalletBar";
import TabBar from "./components/TabBar";
import OfflineBanner from "./components/OfflineBanner";
import ContractPauseBanner from "./components/ContractPauseBanner";
import NetworkBadge from "./components/NetworkBadge";
import AdminDashboard from "./pages/AdminDashboard";
import ContractPauseBanner from "./components/ContractPauseBanner";
import type { WalletAdapter } from "./services/wallets/WalletAdapter";

type Tab = "dashboard" | "subscribe" | "merchant" | "admin";

export default function App() {
  const { publicKey, connect, disconnect, signAndSubmit, error, connecting, activeAdapter } =
    useWallet();
  const { announcement, announce } = useAccessibility();
  const { healthy, circuitOpen } = useRpcHealthContext();
  const [tab, setTab] = useState<"subscribe" | "dashboard">("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [showRpcSettings, setShowRpcSettings] = useState(false);

  const isRpcFailing = !healthy || circuitOpen;
  const { networkMatch, walletNetwork } = useNetworkCheck();
  const { valid: isContractIdValid, error: contractIdError } = useContractId();
  const isOnline = useNetworkStatus();
  const { isAdmin } = useAdmin(publicKey);
  const { networkMatch, walletNetwork, isMainnet, requiresMainnetConfirm, confirmMainnet } =
    useNetworkCheck();
  const { isAdmin } = useAdmin(publicKey);
  const { isPaused } = useContractPaused();
  // Dashboard/SubscribeForm/MerchantDashboard/admin panels each keep their own
  // useToast() instance (and their own tests mock them independently), so
  // centralizing every toast call site into one shared instance is out of
  // scope here. This App-level instance exists solely to drive the header's
  // NotificationCenter (issue #864).
  const { notifications, unreadCount, markAllRead, clearNotifications } = useToast();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const wasOnline = useRef(isOnline);

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
      <ContractPauseBanner paused={isPaused} />

      {/* ARIA live region for screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <OfflineBanner visible={!isOnline} />

      {/* Header */}
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
      {/* Contract pause banner — shown at root level so it's always visible */}
      <ContractPauseBanner paused={isPaused} />
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
      {/* Mainnet safety gate — require explicit confirmation once per session when passphrase is mainnet */}
      {isMainnet && requiresMainnetConfirm && (
        <div
          className="card"
          style={{ background: "#3b1f1f", borderColor: "#7f1d1d", marginBottom: 16 }}
        >
          <p style={{ color: "#fbbf24", fontSize: 13, fontWeight: 600 }}>
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

      {/* Network mismatch warning — preserves passphrase/network check from useNetworkCheck */}
      {publicKey && !networkMatch && (
        <div
          className="card"
          style={{ background: "#3b1f1f", marginBottom: 16, textAlign: "center" }}
          data-testid="gate-warning"
        >
          <p style={{ color: "#f87171", fontSize: 13 }}>
            ⚠ <strong>Configuration/Network Gate Warning:</strong> {gateError}
          </p>
        </div>
      )}

      {/* Wallet connect */}
      {!publicKey ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ color: "#94a3b8", marginBottom: 16, fontSize: 14 }}>
            Connect a wallet to get started.
          </p>
          <button
            onClick={() => setShowWalletModal(true)}
            disabled={connecting}
            style={{ background: "#7c3aed", color: "#fff" }}
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
          {error && (
            <p role="alert" style={{ color: "#f87171", marginTop: 12, fontSize: 13 }}>
              {error}
            </p>
          )}
        </div>
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
          <TabBar tabs={visibleTabs} activeTab={tab} onTabChange={setTab} />

          {/* Content */}
          <div className="card" style={{ marginTop: 20 }}>
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
                isPaused={isPaused}
              />
            )}
            {tab === "dashboard" && (
              <Dashboard
                userKey={publicKey}
                onSign={signAndSubmit}
                refreshTrigger={refresh}
                announce={announce}
                isPaused={!gatePassed}
                isOffline={!isOnline}
                isPaused={isPaused}
              />
            )}
            {tab === "merchant" && (
              <MerchantDashboard
                merchantKey={publicKey}
                onSign={signAndSubmit}
                refreshTrigger={refresh}
                isPaused={isPaused}
              />
            )}
            {tab === "admin" && isAdmin && (
              <AdminDashboard
                publicKey={publicKey}
                onSign={signAndSubmit}
                gatePassed={gatePassed}
              />
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
        />
      )}
    </div>
  );
}
