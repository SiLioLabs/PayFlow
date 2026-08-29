import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    hanaWallet?: {
      getPublicKey: () => Promise<string>;
      signTransaction: (xdr: string, network: string) => Promise<string>;
    };
  }
}

export class HanaAdapter implements WalletAdapter {
  id = "hana";
  name = "Hana";
  icon = "🌸";

  async isInstalled(): Promise<boolean> {
    return !!window.hanaWallet;
  }

  async connect(): Promise<string> {
    if (!window.hanaWallet) {
      throw new Error("Hana wallet not found. Install it from hanawallet.com");
    }
    return window.hanaWallet.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Basic disconnect
  }

  async signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
    if (!window.hanaWallet) throw new Error("Hana not available");
    const networkName = networkPassphrase?.includes("Test SDF") ? "testnet" : "mainnet";
    return window.hanaWallet.signTransaction(xdr, networkName);
  }
}
