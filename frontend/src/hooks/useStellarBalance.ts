import { useState, useEffect, useRef } from "react";
import { getBalance } from "../stellar";

interface CacheEntry {
  balance: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<string>>();

export interface UseStellarBalanceResult {
  balance: string;
  loading: boolean;
  stale: boolean;
  error: string | null;
}

export function useStellarBalance(address: string, staleAfterMs = 10000): UseStellarBalanceResult {
  const minFetchIntervalMs = 5000;
  
  const lastKnownBalance = useRef<string>("0");

  const [state, setState] = useState<UseStellarBalanceResult>(() => {
    const cached = cache.get(address);
    if (cached) {
      lastKnownBalance.current = cached.balance;
      const isStale = Date.now() - cached.timestamp > staleAfterMs;
      return {
        balance: cached.balance,
        loading: isStale, // if stale, we consider it "loading" a fresh value
        stale: isStale,
        error: null,
      };
    }
    return {
      balance: "0",
      loading: true,
      stale: false,
      error: null,
    };
  });

  useEffect(() => {
    if (!address) return;

    let isMounted = true;

    const fetchBalance = async () => {
      const now = Date.now();
      const cached = cache.get(address);

      if (cached) {
        lastKnownBalance.current = cached.balance;
        const timeSinceFetch = now - cached.timestamp;
        
        if (timeSinceFetch < minFetchIntervalMs) {
          setState({
            balance: cached.balance,
            loading: false,
            stale: false,
            error: null,
          });
          return;
        }

        const isStale = timeSinceFetch > staleAfterMs;
        if (!isStale) {
          setState({
            balance: cached.balance,
            loading: false,
            stale: false,
            error: null,
          });
          return;
        }

        setState((prev) => ({
          ...prev,
          balance: cached.balance,
          loading: true,
          stale: true,
        }));
      } else {
        setState({
          balance: "0",
          loading: true,
          stale: false,
          error: null,
        });
      }

      try {
        let fetchPromise = inFlightRequests.get(address);
        if (!fetchPromise) {
          fetchPromise = getBalance(address).finally(() => {
            inFlightRequests.delete(address);
          });
          inFlightRequests.set(address, fetchPromise);
        }

        const newBalance = await fetchPromise;

        if (isMounted) {
          lastKnownBalance.current = newBalance;
          cache.set(address, { balance: newBalance, timestamp: Date.now() });
          
          setState({
            balance: newBalance,
            loading: false,
            stale: false,
            error: null,
          });
        }
      } catch (err) {
        if (isMounted) {
          setState((prev) => ({
            ...prev,
            loading: false,
            stale: false,
            error: err instanceof Error ? err.message : "Failed to fetch balance",
          }));
        }
      }
    };

    fetchBalance();

    return () => {
      isMounted = false;
    };
  }, [address, staleAfterMs]);

  return state;
}
