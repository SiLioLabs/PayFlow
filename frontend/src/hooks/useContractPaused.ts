/**
 * useContractPaused — polls the contract's pause state every 60 seconds.
 *
 * Returns `true` when the contract is confirmed paused, `false` when confirmed
 * active, and `false` on RPC errors (unknown state must not block the UI).
 *
 * The banner and disabled-button logic in the app only activates when the
 * contract is *confirmed* paused — never on a failed/uncertain fetch.
 */
import { useState, useEffect, useCallback } from "react";
import { usePolling } from "./usePolling";
import { getContractPaused } from "../stellar";

const POLL_INTERVAL_MS = 60_000;

export interface UseContractPausedResult {
  isPaused: boolean;
  /** True while the first fetch is in flight */
  loading: boolean;
}

export function useContractPaused(): UseContractPausedResult {
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const result = await getContractPaused();
      // null means RPC error — don't show banner, can't be sure it's paused
      setIsPaused(result === true);
    } catch {
      setIsPaused(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run immediately on mount
  useEffect(() => {
    check();
  }, [check]);

  // Then poll every 60 s for recovery
  usePolling({ callback: check, interval: POLL_INTERVAL_MS, enabled: true });

  return { isPaused, loading };
}
