import React, { useState } from "react";
import { useWallet } from "./hooks/useWallet";
import SubscribeForm from "./components/SubscribeForm";
import Dashboard from "./components/Dashboard";
import TabBar from "./components/TabBar";
import ConnectWallet from "./components/ConnectWallet";

// ✅ FIX: Add missing import
import WalletBar from "./components/WalletBar";

export default function App() {
  const { publicKey, connect, signAndSubmit, disconnect, error } = useWallet();
  const [tab, setTab] = useState<"subscribe" | "dashboard">("dashboard");
  const [refresh, setRefresh] = useState(0);

  return (
    <div className="app-shell">
      {/* Header */}
      <div className="app-header">
        <h1 className="app-header__title">⚡ FlowPay</h1>
        <p className="app-header__subtitle">
          Decentralized recurring payments on Stellar
        </p>
      </div>

      {/* Wallet connect */}
      {!publicKey ? (
        <ConnectWallet onConnect={connect} error={error} />
      ) : (
        <>
          <WalletBar publicKey={publicKey} onDisconnect={disconnect} />

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
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}