import React, { useState } from "react";
import { useWallet, AVAILABLE_WALLETS } from "./hooks/useWallet";
import { useAccessibility } from "./hooks/useAccessibility";
import { useNetworkCheck } from "./hooks/useNetworkCheck";
import { useAdmin } from "./hooks/useAdmin";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import MerchantDashboard from "./components/MerchantDashboard";
import WalletSelectModal from "./components/WalletSelectModal";
import WalletBar from "./components/WalletBar";
import TabBar from "./components/TabBar";
import AdminDashboard from "./pages/AdminDashboard";
import type { WalletAdapter } from "./services/wallets/WalletAdapter";

type Tab = "dashboard" | "subscribe" | "merchant" | "admin";

export default function App() {
  const { publicKey, connect, disconnect, signAndSubmit, error, connecting, activeAdapter } =
    useWallet();
  const { announcement, announce } = useAccessibility();
  const { networkMatch, walletNetwork } = useNetworkCheck();
  const { isAdmin } = useAdmin(publicKey);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [showWalletModal, setShowWalletModal] = useState(false);

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
      {/* ARIA live region for screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Header */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#a78bfa" }}>⚡ FlowPay</h1>
        <p style={{ color: "#64748b", marginTop: 6, fontSize: 14 }}>
          Decentralized recurring payments on Stellar
        </p>
      </div>

      {/* Network mismatch warning — preserves passphrase/network check from useNetworkCheck */}
      {publicKey && !networkMatch && (
        <div
          className="card"
          style={{ background: "#3b1f1f", marginBottom: 16, textAlign: "center" }}
        >
          <p style={{ color: "#f87171", fontSize: 13 }}>
            ⚠ Wallet is on <strong>{walletNetwork}</strong> — app expects a different network.
            Please switch your wallet network.
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
              />
            )}
            {tab === "dashboard" && (
              <Dashboard
                userKey={publicKey}
                onSign={signAndSubmit}
                refreshTrigger={refresh}
                announce={announce}
              />
            )}
            {tab === "merchant" && (
              <MerchantDashboard
                merchantKey={publicKey}
                onSign={signAndSubmit}
                refreshTrigger={refresh}
              />
            )}
            {tab === "admin" && isAdmin && (
              <AdminDashboard publicKey={publicKey} onSign={signAndSubmit} />
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
