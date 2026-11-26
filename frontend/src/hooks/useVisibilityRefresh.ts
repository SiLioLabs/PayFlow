/**
 * useVisibilityRefresh — re-run a callback when the tab becomes visible or
 * the window regains focus, with a cooldown to prevent refresh storms.
 */
import { useEffect, useRef } from "react";

export const DEFAULT_VISIBILITY_COOLDOWN_MS = 5_000;

interface UseVisibilityRefreshOptions {
  cooldownMs?: number;
  enabled?: boolean;
}

export function useVisibilityRefresh(
  callback: () => void,
  options: UseVisibilityRefreshOptions = {}
): void {
  const { cooldownMs = DEFAULT_VISIBILITY_COOLDOWN_MS, enabled = true } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const lastRunRef = useRef<number>(-Infinity);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const trigger = () => {
      const now = Date.now();
      if (now - lastRunRef.current < cooldownMs) return;
      lastRunRef.current = now;
      callbackRef.current();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") trigger();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", trigger);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", trigger);
    };
  }, [cooldownMs, enabled]);
}
