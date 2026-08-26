import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Server } from "@stellar/stellar-sdk/rpc";
import { RPC_URL } from "../stellar";

const POLL_INTERVAL_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CUSTOM_RPC_KEY = "flowpay_custom_rpc_url";

// Backoff: 30s → 60s → 120s (capped)
function nextInterval(failures: number): number {
  return Math.min(POLL_INTERVAL_MS * Math.pow(2, failures - 1), 120_000);
}

/** Normalise a URL: trim whitespace and remove a trailing slash. */
export function normalizeRpcUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Validate that a URL is a plausible HTTP/HTTPS endpoint. */
export function validateRpcUrl(url: string): { valid: boolean; error: string | null } {
  const trimmed = url.trim();
  if (!trimmed) return { valid: false, error: "URL is required." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Enter a valid URL (e.g. https://soroban-testnet.stellar.org)." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, error: "URL must use the https:// or http:// protocol." };
  }

  return { valid: true, error: null };
}

interface RpcHealthState {
  healthy: boolean;
  circuitOpen: boolean;
  error: string | null;
  /** The URL that is actively being polled. */
  activeRpcUrl: string;
  /** The user-supplied override URL (or null if using the default). */
  customRpcUrl: string | null;
  /** Persist a custom URL (or pass null to revert to the default). */
  setCustomRpcUrl: (url: string | null) => void;
}

const defaultUrl = (() => {
  try {
    const stored = window.localStorage.getItem(CUSTOM_RPC_KEY);
    return stored ? (JSON.parse(stored) as string) : null;
  } catch {
    return null;
  }
})();

const RpcHealthContext = createContext<RpcHealthState>({
  healthy: true,
  circuitOpen: false,
  error: null,
  activeRpcUrl: defaultUrl ?? RPC_URL,
  customRpcUrl: defaultUrl,
  setCustomRpcUrl: () => {},
});

export function useRpcHealthContext(): RpcHealthState {
  return useContext(RpcHealthContext);
}

export function RpcHealthProvider({ children }: { children: React.ReactNode }) {
  const [customRpcUrl, setCustomRpcUrlState] = useState<string | null>(() => {
    try {
      const stored = window.localStorage.getItem(CUSTOM_RPC_KEY);
      return stored ? (JSON.parse(stored) as string) : null;
    } catch {
      return null;
    }
  });

  const activeRpcUrl = customRpcUrl ?? RPC_URL;

  const [healthState, setHealthState] = useState<{
    healthy: boolean;
    circuitOpen: boolean;
    error: string | null;
  }>({ healthy: true, circuitOpen: false, error: null });

  const consecutiveFailures = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref to the current active URL so the async check closure sees the latest value.
  const activeUrlRef = useRef(activeRpcUrl);

  useEffect(() => {
    activeUrlRef.current = activeRpcUrl;
  }, [activeRpcUrl]);

  const setCustomRpcUrl = useCallback((url: string | null) => {
    try {
      if (url === null) {
        window.localStorage.removeItem(CUSTOM_RPC_KEY);
      } else {
        window.localStorage.setItem(CUSTOM_RPC_KEY, JSON.stringify(url));
      }
    } catch {
      // localStorage unavailable
    }
    setCustomRpcUrlState(url);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Reset circuit on URL change so the new endpoint gets a fresh chance.
    consecutiveFailures.current = 0;
    setHealthState({ healthy: true, circuitOpen: false, error: null });

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const urlForThisEffect = activeRpcUrl;

    async function check() {
      if (cancelled) return;
      const checkServer = new Server(urlForThisEffect);
      try {
        await checkServer.getHealth();
        if (cancelled) return;
        consecutiveFailures.current = 0;
        setHealthState({ healthy: true, circuitOpen: false, error: null });
        timerRef.current = setTimeout(check, POLL_INTERVAL_MS);
      } catch (e: unknown) {
        if (cancelled) return;
        consecutiveFailures.current += 1;
        const failures = consecutiveFailures.current;
        const circuitOpen = failures >= CIRCUIT_FAILURE_THRESHOLD;
        const error = e instanceof Error ? e.message : "RPC endpoint unreachable";
        setHealthState({ healthy: false, circuitOpen, error });
        timerRef.current = setTimeout(check, nextInterval(failures));
      }
    }

    check();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeRpcUrl]); // Re-run whenever the active URL changes

  const value: RpcHealthState = {
    ...healthState,
    activeRpcUrl,
    customRpcUrl,
    setCustomRpcUrl,
  };

  return <RpcHealthContext.Provider value={value}>{children}</RpcHealthContext.Provider>;
}
