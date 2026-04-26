import { useEffect } from "react";

interface UsePollingOptions {
  callback: () => void | Promise<void>;
  interval: number;
  enabled?: boolean;
}

export function usePolling({ callback, interval, enabled = true }: UsePollingOptions) {
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(() => {
      callback();
    }, interval);

    return () => clearInterval(id);
  }, [callback, interval, enabled]);
}
