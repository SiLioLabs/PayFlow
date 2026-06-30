/**
 * useRpcHealth - Monitors the health and latency of the configured Stellar RPC endpoint.
 *
 * Implements exponential backoff and a circuit-breaker pattern. After 3 consecutive
 * failures, the circuit opens and dependent hooks (e.g., useTransaction) will reject
 * immediately without making network calls.
 *
 * @returns {Object} RPC health metrics
 * @returns {boolean} returns.healthy - True when the last check succeeded
 * @returns {boolean} returns.circuitOpen - True after 3+ consecutive failures
 * @returns {"healthy"|"degraded"|"unreachable"} returns.status - Overall status classification
 * @returns {number|null} returns.latencyMs - Round-trip time in milliseconds, or null
 * @returns {string|null} returns.error - Error message from the last failed check
 *
 * @example
 * const { healthy, circuitOpen, status, latencyMs } = useRpcHealth();
 *
 * return (
 *   <StatusBar>
 *     <Badge color={healthy ? "green" : "red"}>{status}</Badge>
 *     <span>{latencyMs ? `${latencyMs}ms` : "—"}</span>
 *   </StatusBar>
 * );
 */
import { useState, useEffect, useRef } from "react";
import { server } from "../stellar";

const POLL_INTERVAL_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;

function nextInterval(failures: number): number {
  return Math.min(POLL_INTERVAL_MS * Math.pow(2, failures - 1), 120_000);
}

export type RpcStatus = "healthy" | "degraded" | "unreachable";

export interface UseRpcHealthResult {
  healthy: boolean;
  circuitOpen: boolean;
  status: RpcStatus;
  latencyMs: number | null;
  error: string | null;
}

export function useRpcHealth(): UseRpcHealthResult {
  const [healthy, setHealthy] = useState(true);
  const [circuitOpen, setCircuitOpen] = useState(false);
  const [status, setStatus] = useState<RpcStatus>("healthy");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consecutiveFailures = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let currentDelay = 2000;

    async function check() {
      const startTime = performance.now();
      try {
        await server.getHealth();
        if (cancelled) return;
        const latency = Math.round(performance.now() - startTime);
        consecutiveFailures.current = 0;
        currentDelay = 2000;
        setHealthy(true);
        setCircuitOpen(false);
        setLatencyMs(latency);
        setStatus(latency > 2000 ? "degraded" : "healthy");
        setError(null);
        timerRef.current = setTimeout(check, 60000);
      } catch (e: unknown) {
        if (cancelled) return;
        consecutiveFailures.current += 1;
        const failures = consecutiveFailures.current;
        const errMsg = e instanceof Error ? e.message : "RPC endpoint unreachable";
        setHealthy(false);
        setCircuitOpen(failures >= CIRCUIT_FAILURE_THRESHOLD);
        setStatus("unreachable");
        setLatencyMs(null);
        setError(errMsg);
        const delayToUse = currentDelay;
        currentDelay = Math.min(currentDelay * 2, 30000);
        timerRef.current = setTimeout(check, delayToUse);
      }
    }

    check();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { healthy, circuitOpen, status, latencyMs, error };
}
