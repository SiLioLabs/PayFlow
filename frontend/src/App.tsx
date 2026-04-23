import React, { useState } from "react";
import { useWallet } from "./hooks/useWallet";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";

export default function App() {
  const { publicKey, connect, signAndSubmit, error } = useWallet();
  const [tab, setTab] = useState<"subscribe" | "dashboard">("dashboard");
  const [refresh, setRefresh] = useState(0);

  return (
    <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: "var(--space-8)", textAlign: "center" }}>
        <h1 style={{ fontSize: "var(--text-3xl)", fontWeight: "var(--font-extrabold)", color: "var(--color-primary)" }}>⚡ FlowPay</h1>
        <p style={{ color: "var(--color-text-subtle)", marginTop: "var(--space-2)", fontSize: "var(--text-base)" }}>
          Decentralized recurring payments on Stellar
        </p>
      </div>

      {/* Wallet connect */}
      {!publicKey ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--color-text-muted)", marginBottom: "var(--space-4)", fontSize: "var(--text-base)" }}>
            Connect your Freighter wallet to get started.
          </p>
          <button
            onClick={connect}
            className="btn-primary"
            style={{ width: "100%" }}
          >
            Connect Wallet
          </button>
          {error && <p style={{ color: "var(--color-danger)", marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>{error}</p>}
        </div>
      ) : (
        <>
          {/* Connected bar */}
          <div
            className="card"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-5)", padding: "var(--space-3) var(--space-4)" }}
          >
            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-subtle)" }}>Connected</span>
            <span style={{ fontSize: "var(--text-sm)", fontFamily: "monospace", color: "var(--color-primary)" }}>
              {publicKey.slice(0, 6)}…{publicKey.slice(-4)}
            </span>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-5)" }}>
            {(["dashboard", "subscribe"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={tab === t ? "btn-primary" : "btn-secondary"}
                style={{ flex: 1 }}
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
                onSuccess={() => { setTab("dashboard"); setRefresh((r) => r + 1); }}
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
