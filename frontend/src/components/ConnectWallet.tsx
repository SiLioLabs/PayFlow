import React from "react";
import { useFreighterAvailable } from "../hooks/useFreighterAvailable";

interface Props {
  onConnect: () => void;
  error: string | null;
}

export default function ConnectWallet({ onConnect, error }: Props) {
  const { available, installUrl } = useFreighterAvailable();

  return (
    <div className="card connect-wallet">
      <p className="connect-wallet__hint">Connect your Freighter wallet to get started.</p>

      {available ? (
        <button onClick={onConnect} className="btn-primary w-full">
          Connect Wallet
        </button>
      ) : (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full connect-wallet__install-link"
        >
          Install Freighter
        </a>
      )}

      {error && <p className="text-error">{error}</p>}
    </div>
  );
}
