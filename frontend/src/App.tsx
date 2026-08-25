import React, { useState } from "react";
import { useWallet, AVAILABLE_WALLETS } from "./hooks/useWallet";
import { useAccessibility } from "./hooks/useAccessibility";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";

export default function App() {
  const { publicKey, connect, signAndSubmit, error } = useWallet();
  const { announcement, announce } = useAccessibility();
  const [tab, setTab] = useState<"subscribe" | "dashboard">("dashboard");
  const [refresh, setRefresh] = useState(0);

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

      {/* Wallet connect */}
      {!publicKey ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ color: "#94a3b8", marginBottom: 16, fontSize: 14 }}>
            Connect your Freighter wallet to get started.
          </p>
          <button
            onClick={() => connect(AVAILABLE_WALLETS[0])}
            style={{ background: "#7c3aed", color: "#fff" }}
          >
            Connect Wallet
          </button>
          {error && <p style={{ color: "#f87171", marginTop: 12, fontSize: 13 }}>{error}</p>}
        </div>
      ) : (
        <>
          {/* Connected bar */}
          <div
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
              padding: "12px 16px",
            }}
          >
            <span style={{ fontSize: 13, color: "#64748b" }}>Connected</span>
            <span style={{ fontSize: 13, fontFamily: "monospace", color: "#a78bfa" }}>
              {publicKey.slice(0, 6)}…{publicKey.slice(-4)}
            </span>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {(["dashboard", "subscribe"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  background: tab === t ? "#7c3aed" : "#1e1e2e",
                  color: tab === t ? "#fff" : "#94a3b8",
                  border: "1px solid #2d2d3f",
                }}
              >
                {t === "dashboard" ? "Dashboard" : "Subscribe"}
              </button>
            ))}
          </div>

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
