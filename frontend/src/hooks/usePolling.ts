/**
 * usePolling - Runs a callback repeatedly on a fixed interval.
 *
 * Uses `setInterval` to invoke the callback. Supports pausing via `enabled`.
 * The callback reference is kept fresh using `useRef` to avoid stale closures.
 *
 * @param {Object} options - Polling configuration
 * @param {Function} options.callback - Function to invoke on each tick
 * @param {number} options.interval - Milliseconds between invocations
 * @param {boolean} [options.enabled=true] - Set to false to pause polling
 *
 * @example
 * usePolling({
 *   callback: () => fetchData(),
 *   interval: 5000,
 *   enabled: isActive,
 * });
 */
import { useEffect, useRef } from "react";

interface UsePollingOptions {
  callback: () => void;
  interval: number;
  enabled?: boolean;
}

export function usePolling({ callback, interval, enabled = true }: UsePollingOptions) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => callbackRef.current(), interval);
    return () => clearInterval(id);
  }, [interval, enabled]);
}
