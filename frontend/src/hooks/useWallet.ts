/**
 * useWallet — connects to Freighter (Stellar browser wallet)
 * https://www.freighter.app/
 */
import { useState, useCallback } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, server } from "../stellar";

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

export function useWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.freighter) {
      setError("Freighter wallet not found. Install it from freighter.app");
      return;
    }
    try {
      const connected = await window.freighter.isConnected();
      if (!connected) {
        setError("Please unlock Freighter and allow access.");
        return;
      }
      const key = await window.freighter.getPublicKey();
      setPublicKey(key);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    }
  }, []);

  const signAndSubmit = useCallback(async (xdr: string): Promise<string> => {
    if (!window.freighter) throw new Error("Freighter not available");
    const signed = await window.freighter.signTransaction(xdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    const tx = new Transaction(signed, NETWORK_PASSPHRASE);
    const result = await server.sendTransaction(tx);
    return result.hash;
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setError(null);
  }, []);

  return { publicKey, connect, signAndSubmit, disconnect, error };
}
