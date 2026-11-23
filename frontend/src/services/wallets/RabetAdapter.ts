import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    rabet?: {
      connect: () => Promise<void>;
      getPublicKey: () => Promise<string>;
      signTransaction: (params: { xdr: string; network: string }) => Promise<string>;
    };
  }
}

export class RabetAdapter implements WalletAdapter {
  id = "rabet";
  name = "Rabet";
  icon = "🟣";
  installUrl = "https://rabet.io";
  installHint = "Install Rabet for a browser-based Stellar wallet.";

  async isInstalled(): Promise<boolean> {
    return !!window.rabet;
  }

  async connect(): Promise<string> {
    if (!window.rabet) {
      throw new Error("Rabet wallet not found. Install it from rabet.io");
    }
    await window.rabet.connect();
    return window.rabet.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Rabet has no formal disconnect API; the host app clears its wallet state.
  }

  async signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
    if (!window.rabet) throw new Error("Rabet not available");
    const network = networkPassphrase?.includes("Test SDF") ? "testnet" : "public";
    return window.rabet.signTransaction({ xdr, network });
  }
}
