import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    walletConnect?: {
      connect: () => Promise<string>;
      disconnect: () => Promise<void>;
      signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
    };
  }
}

const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * WalletConnect bridge adapter for mobile Stellar wallets.
 *
 * The bridge provider is injected by the host page (e.g. a WalletConnect
 * wallet-kit bootstrap) under `window.walletConnect`. This keeps the adapter
 * dependency-free and consistent with the other injected-provider adapters.
 */
export class WalletConnectAdapter implements WalletAdapter {
  id = "walletconnect";
  name = "WalletConnect";
  icon = "🔗";
  installUrl = "https://walletconnect.com";
  installHint = "Use a WalletConnect-enabled Stellar wallet on mobile and scan the pairing request.";

  async isInstalled(): Promise<boolean> {
    return !!window.walletConnect;
  }

  async connect(): Promise<string> {
    if (!window.walletConnect) {
      throw new Error(
        "WalletConnect provider not found. Open PayFlow in a WalletConnect-enabled mobile wallet."
      );
    }
    return window.walletConnect.connect();
  }

  async disconnect(): Promise<void> {
    if (window.walletConnect) {
      await window.walletConnect.disconnect();
    }
  }

  async signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
    if (!window.walletConnect) throw new Error("WalletConnect not available");
    return window.walletConnect.signTransaction(
      xdr,
      networkPassphrase || DEFAULT_NETWORK_PASSPHRASE
    );
  }
}
