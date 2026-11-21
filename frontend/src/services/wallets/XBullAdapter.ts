import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    xBullSDK?: {
      connect: (params: { canRequestPublicKey: boolean; canRequestSign: boolean }) => Promise<void>;
      getPublicKey: () => Promise<string>;
      signTransaction: (params: { xdr: string; network: string }) => Promise<string>;
    };
  }
}

export class XBullAdapter implements WalletAdapter {
  id = "xbull";
  name = "xBull";
  icon = "🐂";

  async isInstalled(): Promise<boolean> {
    return !!window.xBullSDK;
  }

  async connect(): Promise<string> {
    if (!window.xBullSDK) {
      throw new Error("xBull wallet not found. Install it from xbull.app");
    }
    await window.xBullSDK.connect({ canRequestPublicKey: true, canRequestSign: true });
    return window.xBullSDK.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Basic disconnect
  }

  async signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
    if (!window.xBullSDK) throw new Error("xBull not available");
    // xBull uses 'testnet' or 'public' for network
    const networkName = networkPassphrase?.includes("Test SDF") ? "testnet" : "public";
    return window.xBullSDK.signTransaction({ xdr, network: networkName });
  }
}
