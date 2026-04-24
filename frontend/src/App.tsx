import React, { useState } from "react";
import { useWallet } from "./hooks/useWallet";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import TabBar from "./components/TabBar";

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
        <ConnectWallet onConnect={connect} error={error} />
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
          <TabBar
            tabs={["dashboard", "subscribe"]}
            activeTab={tab}
            onTabChange={setTab}
          />

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
