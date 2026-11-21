export interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  /** Link shown when the wallet is unavailable, so users can install/configure it. */
  installUrl?: string;
  /** Short instruction displayed alongside the install link. */
  installHint?: string;
  isInstalled(): Promise<boolean>;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, networkPassphrase?: string): Promise<string>;
}
