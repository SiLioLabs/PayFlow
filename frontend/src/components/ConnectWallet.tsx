import React from "react";

interface Props {
  onConnect: () => void;
  error: string | null;
}

function useFreighterAvailable(): boolean {
  return typeof window !== "undefined" && !!window.freighter;
}

export default function ConnectWallet({ onConnect, error }: Props) {
  const freighterAvailable = useFreighterAvailable();

  return (
    <div className="card connect-wallet">
      <p className="connect-wallet__hint">
        Connect your Freighter wallet to get started.
      </p>

      {freighterAvailable ? (
        <button onClick={onConnect} className="btn-primary w-full">
          Connect Wallet
        </button>
      ) : (
        <a
          href="https://freighter.app"
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
