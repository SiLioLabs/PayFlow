import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, server } from "../stellar";
import { ensureMainnetConfirmed } from "../utils/network";
import { WalletAdapter } from "../services/wallets/WalletAdapter";
import { FreighterAdapter } from "../services/wallets/FreighterAdapter";
import { XBullAdapter } from "../services/wallets/XBullAdapter";
import { LobstrAdapter } from "../services/wallets/LobstrAdapter";
import { HanaAdapter } from "../services/wallets/HanaAdapter";
import { useWalletStatus } from "./useWalletStatus";

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
  const [ready, setReady] = useState(false);
  const [activeAdapterId, setActiveAdapterId] = useState<string | null>(null);
  const walletStatus = useWalletStatus();
  const { setConnected, reset, setConnecting, setError } = walletStatus;

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
          setConnected();
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
  }, [setConnected]);

  useEffect(() => {
    if (!activeAdapter?.getCurrentAccount) return;

    let active = true;
    let checking = false;
    const syncAccount = async () => {
      if (checking) return;
      checking = true;
      try {
        const account = await activeAdapter.getCurrentAccount!();
        if (!active) return;

        if (!account) {
          localStorage.removeItem(STORAGE_KEY_PK);
          localStorage.removeItem(STORAGE_KEY_ID);
          setPublicKey(null);
          setActiveAdapterId(null);
          reset();
          return;
        }

        if (publicKey !== account) {
          localStorage.setItem(STORAGE_KEY_PK, account);
          setPublicKey(account);
          setConnected();
        }
      } catch {
        // A transient extension/RPC failure should not disconnect the wallet.
      } finally {
        checking = false;
      }
    };

    const interval = window.setInterval(syncAccount, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeAdapter, publicKey, reset, setConnected]);

  const connect = useCallback(
    async (adapter: WalletAdapter) => {
      setConnecting();
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
        setConnected();
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : "Failed to connect wallet";
        setError(errorMsg);
      }
    },
    [setConnecting, setConnected, setError]
  );

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
    reset();
  }, [activeAdapter, reset]);

  return {
    publicKey,
    connect,
    signAndSubmit,
    disconnect,
    error: walletStatus.error,
    connecting: walletStatus.status === "connecting",
    connectionStatus: walletStatus.status,
    ready,
    activeAdapter,
  };
}
