import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    lobstr?: {
      isConnected: () => boolean;
      getPublicKey: () => Promise<string>;
      signTransaction: (xdr: string) => Promise<string>;
    };
  }
}

export class LobstrAdapter implements WalletAdapter {
  id = "lobstr";
  name = "Lobstr";
  icon = "🦞";

  async isInstalled(): Promise<boolean> {
    return !!window.lobstr;
  }

  async connect(): Promise<string> {
    if (!window.lobstr) {
      throw new Error("Lobstr wallet not found. Install it from lobstr.co");
    }
    return window.lobstr.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Basic disconnect
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!window.lobstr) throw new Error("Lobstr not available");

    return window.lobstr.signTransaction(xdr);
  }
}
