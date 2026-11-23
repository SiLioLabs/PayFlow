/**
 * usePolling - Runs a callback repeatedly on a fixed interval.
 *
 * Also fires the callback on tab refocus / visibility change (cooldown-throttled)
 * unless refreshOnVisibility is false. Timers are unaffected.
 */
import { useEffect, useRef } from "react";
import { useVisibilityRefresh } from "./useVisibilityRefresh";

interface UsePollingOptions {
  callback: () => void;
  interval: number;
  enabled?: boolean;
  refreshOnVisibility?: boolean;
}

export function usePolling({
  callback,
  interval,
  enabled = true,
  refreshOnVisibility = true,
}: UsePollingOptions) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useVisibilityRefresh(
    () => callbackRef.current(),
    { enabled: enabled && refreshOnVisibility }
  );

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => callbackRef.current(), interval);
    return () => clearInterval(id);
  }, [interval, enabled]);
}
