export interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  isInstalled(): Promise<boolean>;
  connect(): Promise<string>;
  getCurrentAccount?(): Promise<string | null>;
  getNetwork?(): Promise<{ network: string; networkPassphrase: string }>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, networkPassphrase?: string): Promise<string>;
}
