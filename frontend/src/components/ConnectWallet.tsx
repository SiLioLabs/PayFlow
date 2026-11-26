import React from "react";
import ThemeToggle from "./ThemeToggle";
import Spinner from "./Spinner";

interface Props {
  onConnect: () => void;
  error: string | null;
  loading?: boolean;
}

export default function ConnectWallet({ onConnect, error, loading = false }: Props) {
  return (
    <div className="card connect-wallet">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <p className="connect-wallet__hint" style={{ margin: 0 }}>Connect a wallet to get started.</p>
        <ThemeToggle />
      </div>

      <button
        onClick={onConnect}
        className="btn-primary w-full"
        disabled={loading}
        aria-label={loading ? "Connecting…" : undefined}
      >
        {loading ? <Spinner size="sm" /> : "Connect Wallet"}
      </button>

      {error && (
        <p role="alert" className="text-danger mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
