import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { server } from "../stellar";

const POLL_INTERVAL_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;

// Backoff: 30s → 60s → 120s (capped)
function nextInterval(failures: number): number {
  return Math.min(POLL_INTERVAL_MS * Math.pow(2, failures - 1), 120_000);
}

interface RpcHealthState {
  healthy: boolean;
  circuitOpen: boolean;
  error: string | null;
}

const RpcHealthContext = createContext<RpcHealthState>({
  healthy: true,
  circuitOpen: false,
  error: null,
});

export function useRpcHealthContext(): RpcHealthState {
  return useContext(RpcHealthContext);
}

export function RpcHealthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RpcHealthState>({
    healthy: true,
    circuitOpen: false,
    error: null,
  });

  const consecutiveFailures = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        await server.getHealth();
        if (cancelled) return;
        consecutiveFailures.current = 0;
        setState({ healthy: true, circuitOpen: false, error: null });
        timerRef.current = setTimeout(check, POLL_INTERVAL_MS);
      } catch (e: unknown) {
        if (cancelled) return;
        consecutiveFailures.current += 1;
        const failures = consecutiveFailures.current;
        const circuitOpen = failures >= CIRCUIT_FAILURE_THRESHOLD;
        const error = e instanceof Error ? e.message : "RPC endpoint unreachable";
        setState({ healthy: false, circuitOpen, error });
        timerRef.current = setTimeout(check, nextInterval(failures));
      }
    }

    check();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return <RpcHealthContext.Provider value={state}>{children}</RpcHealthContext.Provider>;
}
