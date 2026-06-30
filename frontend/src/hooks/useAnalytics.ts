import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AnalyticsEvent =
  | { type: "subscription_created"; payload?: undefined }
  | { type: "subscription_cancelled"; payload?: undefined }
  | { type: "pay_per_use"; payload: { amountStroops: bigint } }
  | { type: "daily_limit_set"; payload: { limitStroops: bigint } }
  | { type: "daily_limit_removed"; payload?: undefined }
  | { type: "wallet_connected"; payload?: undefined };

const ANALYTICS_OPT_IN_KEY = "flowpay_analytics_opt_in";

function readOptInPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ANALYTICS_OPT_IN_KEY) === "true";
}

export function useAnalytics() {
  const [isOptedIn, setIsOptedIn] = useState<boolean>(() => readOptInPreference());
  const queue = useRef<AnalyticsEvent[]>([]);
  const timerId = useRef<any>(null);

  const setOptIn = useCallback((enabled: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ANALYTICS_OPT_IN_KEY, String(enabled));
    }
    setIsOptedIn(enabled);
  }, []);

  const flushQueue = useCallback(() => {
    if (timerId.current) {
      clearTimeout(timerId.current);
      timerId.current = null;
    }

    if (queue.current.length === 0) return;

    const eventsToFlush = [...queue.current];
    queue.current = [];

    const url = import.meta.env.VITE_ANALYTICS_URL;
    if (!url) {
      return;
    }

    // Custom replacer to handle BigInt serialization
    const replacer = (_key: string, value: any) =>
      typeof value === "bigint" ? value.toString() : value;

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventsToFlush, replacer),
    }).catch((err) => {
      console.error("Failed to flush analytics queue:", err);
    });
  }, []);

  const track = useCallback(
    (event: AnalyticsEvent) => {
      if (!isOptedIn || typeof window === "undefined") return;

      const payload = {
        event: event.type,
        payload: event.payload ?? {},
        metadata: event.payload ?? {}, // for backward compatibility in events
        timestamp: new Date().toISOString(),
      };

      // Keep this privacy-first: local event only, no automatic network transport.
      window.dispatchEvent(new CustomEvent("flowpay-analytics", { detail: payload }));

      // Queue the event for batching
      queue.current.push(event);

      // Flush check: 10 events
      if (queue.current.length >= 10) {
        flushQueue();
      } else if (!timerId.current) {
        // Start 5 second timer if it's the first event in the new batch
        timerId.current = setTimeout(() => {
          flushQueue();
        }, 5000);
      }
    },
    [isOptedIn, flushQueue]
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushQueue();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timerId.current) {
        clearTimeout(timerId.current);
        timerId.current = null;
      }
    };
  }, [flushQueue]);

  return useMemo(
    () => ({
      isOptedIn,
      setOptIn,
      track,
    }),
    [isOptedIn, setOptIn, track]
  );
}
