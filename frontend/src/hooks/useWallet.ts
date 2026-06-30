/**
 * useWallet - Connects to Freighter (Stellar browser wallet) and manages wallet state.
 *
 * Persists the last-known public key in localStorage ("pf_wallet_pk") so the wallet
 * appears connected across page reloads. On mount, it re-validates the cached key
 * before exposing it through the return value.
 *
 * @returns {Object} Wallet state and control methods
 * @returns {string|null} returns.publicKey - The connected account's public key, or null
 * @returns {Function} returns.connect - Connects the Freighter wallet
 * @returns {Function} returns.signAndSubmit - Signs a transaction XDR and submits it
 * @returns {Function} returns.disconnect - Disconnects the wallet and clears localStorage
 * @returns {string|null} returns.error - Connection or signing error message
 * @returns {boolean} returns.connecting - True while connecting is in progress
 * @returns {boolean} returns.ready - False until initial Freighter re-validation completes
 *
 * @example
 * const { publicKey, connect, disconnect, signAndSubmit, error, connecting, ready } = useWallet();
 *
 * if (!ready) return <Spinner />;
 * if (!publicKey) return <button onClick={connect}>Connect Wallet</button>;
 *
 * return (
 *   <div>
 *     <span>{publicKey}</span>
 *     <button onClick={disconnect}>Disconnect</button>
 *   </div>
 * );
 */
import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, server } from "../stellar";

const STORAGE_KEY = "pf_wallet_pk";
const POLL_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 300;

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

/** Poll for window.freighter up to `maxAttempts` times with `intervalMs` gaps. */
async function waitForFreighter(
  maxAttempts: number,
  intervalMs: number
): Promise<typeof window.freighter | undefined> {
  for (let i = 0; i < maxAttempts; i++) {
    if (window.freighter) return window.freighter;
    if (i < maxAttempts - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return undefined;
}

export function useWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // `ready` is false until the on-mount re-validation attempt completes.
  const [ready, setReady] = useState(false);

  // On mount: try to restore a previously cached public key.
  useEffect(() => {
    let mounted = true;

    async function revalidate() {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (!cached) {
        if (mounted) setReady(true);
        return;
      }

      // Poll for Freighter injection (extension may not yet be present).
      const freighter = await waitForFreighter(POLL_ATTEMPTS, POLL_INTERVAL_MS);

      if (!freighter) {
        // Freighter absent after all polls — clear stale cache.
        localStorage.removeItem(STORAGE_KEY);
        if (mounted) setReady(true);
        return;
      }

      try {
        const connected = await freighter.isConnected();
        if (!connected) {
          localStorage.removeItem(STORAGE_KEY);
          if (mounted) setReady(true);
          return;
        }

        const liveKey = await freighter.getPublicKey();
        if (liveKey === cached) {
          // Cache is still valid.
          if (mounted) setPublicKey(liveKey);
        } else {
          // Key changed — update the cache with the current key.
          localStorage.setItem(STORAGE_KEY, liveKey);
          if (mounted) setPublicKey(liveKey);
        }
      } catch {
        // Any error during re-validation: clear cache and stay disconnected.
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        if (mounted) setReady(true);
      }
    }

    revalidate();

    return () => {
      mounted = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.freighter) {
      setError("Freighter wallet not found. Install it from freighter.app");
      return;
    }
    setConnecting(true);
    try {
      const connected = await window.freighter.isConnected();
      if (!connected) {
        setError("Please unlock Freighter and allow access.");
        return;
      }
      const key = await window.freighter.getPublicKey();
      localStorage.setItem(STORAGE_KEY, key);
      setPublicKey(key);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
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
    localStorage.removeItem(STORAGE_KEY);
    setPublicKey(null);
    setError(null);
  }, []);

  return { publicKey, connect, signAndSubmit, disconnect, error, connecting, ready };
}
