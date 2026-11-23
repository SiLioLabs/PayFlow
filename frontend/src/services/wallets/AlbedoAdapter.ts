import { WalletAdapter } from "./WalletAdapter";

declare global {
  interface Window {
    albedo?: {
      getPublicKey: () => Promise<string>;
      signTransaction: (params: {
        xdr: string;
        networkPassphrase: string;
      }) => Promise<string>;
    };
  }
}

const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export class AlbedoAdapter implements WalletAdapter {
  id = "albedo";
  name = "Albedo";
  icon = "🔷";
  installUrl = "https://albedo.link";
  installHint = "Install Albedo to sign with a hardware-backed Stellar key.";

  async isInstalled(): Promise<boolean> {
    return !!window.albedo;
  }

  async connect(): Promise<string> {
    if (!window.albedo) {
      throw new Error("Albedo wallet not found. Install it from albedo.link");
    }
    return window.albedo.getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Albedo has no persistent session to clear; the host app owns wallet state.
  }

  async signTransaction(xdr: string, networkPassphrase?: string): Promise<string> {
    if (!window.albedo) throw new Error("Albedo not available");
    return window.albedo.signTransaction({
      xdr,
      networkPassphrase: networkPassphrase || DEFAULT_NETWORK_PASSPHRASE,
    });
  }
}
