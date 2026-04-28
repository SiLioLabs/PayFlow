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
