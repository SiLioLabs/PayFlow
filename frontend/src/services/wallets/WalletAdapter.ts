export interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  isInstalled(): Promise<boolean>;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, networkPassphrase?: string): Promise<string>;
}
