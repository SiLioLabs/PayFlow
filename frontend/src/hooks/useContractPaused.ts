/**
 * useContractPaused — polls the contract's pause state every 60 seconds.
 *
 * Exposes three meaningful states:
 *   - "paused"  : Contract was successfully queried and is actively paused.
 *   - "active"  : Contract was successfully queried and is not paused.
 *   - "unknown" : The application could not reliably determine the contract
 *                 state (RPC failure, network failure, timeout, null result,
 *                 or any unexpected error).
 *
 * IMPORTANT: "unknown" must never be treated as "active" by consumers.
 * Gates must disable or visibly flag actions when the state is "unknown".
 */
import { useState, useEffect, useCallback } from "react";
import { usePolling } from "./usePolling";
import { getContractPaused } from "../stellar";

const POLL_INTERVAL_MS = 60_000;

/** Three-state enum for the contract's pause status. */
export type ContractPausedStatus = "paused" | "active" | "unknown";

export interface UseContractPausedResult {
  /**
   * Three-state contract pause status:
   * - "paused"  : confirmed paused
   * - "active"  : confirmed active
   * - "unknown" : state could not be reliably determined
   */
  status: ContractPausedStatus;
  /**
   * Convenience boolean: true only when status === "paused".
   * Prefer `status` for new code; `isPaused` is kept for backward-compatibility
   * with existing consumers that only gate on the paused condition.
   */
  isPaused: boolean;
  /** True while the first fetch is in flight */
  loading: boolean;
}

export function useContractPaused(): UseContractPausedResult {
  const [status, setStatus] = useState<ContractPausedStatus>("unknown");
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const result = await getContractPaused();
      if (result === true) {
        // Contract successfully reported as paused
        setStatus("paused");
      } else if (result === false) {
        // Contract successfully reported as active
        setStatus("active");
      } else {
        // null means the RPC layer returned an indeterminate result
        setStatus("unknown");
      }
    } catch {
      // Any transport/RPC/network exception → unknown, never active
      setStatus("unknown");
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

  return {
    status,
    isPaused: status === "paused",
    loading,
  };
}
