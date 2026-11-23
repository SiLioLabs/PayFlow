import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>;
      getPublicKey: () => Promise<string>;
      getNetwork: () => Promise<{ network: string; networkPassphrase: string }>;
      signTransaction: (xdr: string, opts: { networkPassphrase: string }) => Promise<string>;
    };
  }
}

export class FreighterAdapter implements WalletAdapter {
  id = "freighter";
  name = "Freighter";
  icon = "🚢";

  async isInstalled(): Promise<boolean> {
    return !!window.freighter;
  }

  async connect(): Promise<string> {
    if (!window.freighter) {
      throw new Error("Freighter wallet not found. Install it from freighter.app");
    }
    const connected = await window.freighter.isConnected();
    if (!connected) {
      throw new Error("Please unlock Freighter and allow access.");
    }
    return window.freighter.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't have a formal disconnect API, but we clear our state.
  }

  async signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
    if (!window.freighter) throw new Error("Freighter not available");
    return window.freighter.signTransaction(xdr, {
      networkPassphrase: networkPassphrase || "Test SDF Network ; September 2015",
    });
  }
}
