import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, server } from "../stellar";
import { ensureMainnetConfirmed } from "../utils/network";
import { WalletAdapter } from "../services/wallets/WalletAdapter";
import { FreighterAdapter } from "../services/wallets/FreighterAdapter";
import { XBullAdapter } from "../services/wallets/XBullAdapter";
import { LobstrAdapter } from "../services/wallets/LobstrAdapter";
import { HanaAdapter } from "../services/wallets/HanaAdapter";

const STORAGE_KEY_PK = "pf_wallet_pk";
const STORAGE_KEY_ID = "pf_wallet_id";

export const AVAILABLE_WALLETS = [
  new FreighterAdapter(),
  new XBullAdapter(),
  new LobstrAdapter(),
  new HanaAdapter(),
];

export function useWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeAdapterId, setActiveAdapterId] = useState<string | null>(null);

  const activeAdapter = AVAILABLE_WALLETS.find((a) => a.id === activeAdapterId) || null;

  useEffect(() => {
    let mounted = true;

    async function revalidate() {
      const cachedPk = localStorage.getItem(STORAGE_KEY_PK);
      const cachedId = localStorage.getItem(STORAGE_KEY_ID) || "freighter"; // default to freighter if legacy

      if (!cachedPk) {
        if (mounted) setReady(true);
        return;
      }

      const adapter = AVAILABLE_WALLETS.find((a) => a.id === cachedId);
      if (!adapter) {
        localStorage.removeItem(STORAGE_KEY_PK);
        localStorage.removeItem(STORAGE_KEY_ID);
        if (mounted) setReady(true);
        return;
      }

      try {
        const isInstalled = await adapter.isInstalled();
        if (!isInstalled) {
          throw new Error("Wallet not installed");
        }

        // Some wallets require explicitly connecting again, others might just work.
        // For standard revalidation, we just assume it's still connected if we have the key,
        // or we try to connect quietly.
        const liveKey = await adapter.connect();

        if (mounted) {
          setPublicKey(liveKey);
          setActiveAdapterId(adapter.id);
          localStorage.setItem(STORAGE_KEY_PK, liveKey);
          localStorage.setItem(STORAGE_KEY_ID, adapter.id);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY_PK);
        localStorage.removeItem(STORAGE_KEY_ID);
      } finally {
        if (mounted) setReady(true);
      }
    }

    revalidate();

    return () => {
      mounted = false;
    };
  }, []);

  const connect = useCallback(async (adapter: WalletAdapter) => {
    setError(null);
    setConnecting(true);
    try {
      const isInstalled = await adapter.isInstalled();
      if (!isInstalled) {
        throw new Error(`${adapter.name} wallet not found. Please install it.`);
      }

      const key = await adapter.connect();
      localStorage.setItem(STORAGE_KEY_PK, key);
      localStorage.setItem(STORAGE_KEY_ID, adapter.id);
      setPublicKey(key);
      setActiveAdapterId(adapter.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const signAndSubmit = useCallback(
    async (xdr: string): Promise<string> => {
      if (!activeAdapter) throw new Error("No wallet connected");
      // Defense-in-depth mainnet gate for direct sign paths (e.g., SubscribeForm that bypasses useTransaction)
      if (!ensureMainnetConfirmed()) {
        throw new Error("Mainnet transaction cancelled");
      }
      const signed = await activeAdapter.signTransaction(xdr, NETWORK_PASSPHRASE);
      const tx = new Transaction(signed, NETWORK_PASSPHRASE);
      const result = await server.sendTransaction(tx);
      return result.hash;
    },
    [activeAdapter]
  );

  const disconnect = useCallback(async () => {
    if (activeAdapter) {
      try {
        await activeAdapter.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    localStorage.removeItem(STORAGE_KEY_PK);
    localStorage.removeItem(STORAGE_KEY_ID);
    setPublicKey(null);
    setActiveAdapterId(null);
    setError(null);
  }, [activeAdapter]);

  return {
    publicKey,
    connect,
    signAndSubmit,
    disconnect,
    error,
    connecting,
    ready,
    activeAdapter,
  };
}
