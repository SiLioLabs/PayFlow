/**
 * useWallet — connects to Freighter (Stellar browser wallet)
 * https://www.freighter.app/
 *
 * Persists the last-known public key in localStorage (key: "wallet_public_key").
 * On mount it silently re-validates the cached key with Freighter before
 * exposing it to callers, so the wallet appears connected across page reloads
 * without requiring the user to click "Connect" again.
 *
 * A `ready` (and `sessionRestored`) boolean is false until the re-validation attempt completes,
 * allowing callers to gate rendering on wallet readiness.
 */
import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, server } from "../stellar";
import { useLocalStorage } from "./useLocalStorage";

const STORAGE_KEY = "wallet_public_key";
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
  const [publicKey, setPublicKey] = useLocalStorage<string | null>(STORAGE_KEY, null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // `ready` (and `sessionRestored`) is false until the on-mount re-validation attempt completes.
  const [ready, setReady] = useState(false);

  // On mount: try to restore a previously cached public key.
  useEffect(() => {
    let mounted = true;

    async function revalidate() {
      // Read initial cached value directly from localStorage (not from state)
      let cached: string | null = null;
      try {
        const item = window.localStorage.getItem(STORAGE_KEY);
        cached = item ? JSON.parse(item) : null;
      } catch {
        cached = null;
      }

      if (!cached) {
        if (mounted) setReady(true);
        return;
      }

      setConnecting(true);

      // Poll for Freighter injection (extension may not yet be present).
      const freighter = await waitForFreighter(POLL_ATTEMPTS, POLL_INTERVAL_MS);

      if (!freighter) {
        // Freighter absent after all polls — clear stale cache.
        if (mounted) {
          setPublicKey(null);
          setConnecting(false);
          setReady(true);
        }
        return;
      }

      try {
        const connected = await freighter.isConnected();
        if (!connected) {
          if (mounted) {
            setPublicKey(null);
            setConnecting(false);
            setReady(true);
          }
          return;
        }

        const liveKey = await freighter.getPublicKey();
        if (liveKey === cached) {
          // Cache is still valid.
          if (mounted) setPublicKey(liveKey);
        } else {
          // Key changed — clear cache and disconnect.
          if (mounted) setPublicKey(null);
        }
      } catch {
        // Any error during re-validation: clear cache and stay disconnected.
        if (mounted) setPublicKey(null);
      } finally {
        if (mounted) {
          setConnecting(false);
          setReady(true);
        }
      }
    }

    revalidate();

    return () => {
      mounted = false;
    };
  }, [setPublicKey]); // Empty dependency array except setPublicKey (stable)

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
      setPublicKey(key);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, [setPublicKey]);

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
  }, [setPublicKey]);

  return { 
    publicKey, 
    connect, 
    signAndSubmit, 
    disconnect, 
    error, 
    connecting, 
    ready, 
    sessionRestored: ready // Alias for backward compatibility as per issue
  };
}
