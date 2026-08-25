import React from "react";
import Spinner from "./Spinner";

interface Props {
  onConnect: () => void;
  error: string | null;
  loading?: boolean;
}

export default function ConnectWallet({ onConnect, error, loading = false }: Props) {
  return (
    <div className="card connect-wallet">
      <p className="connect-wallet__hint">Connect a wallet to get started.</p>

      <button onClick={onConnect} className="btn-primary w-full" disabled={loading}>
        {loading ? <Spinner size="sm" /> : "Connect Wallet"}
      </button>

      {error && <p className="text-danger mt-2">{error}</p>}
    </div>
  );
}
