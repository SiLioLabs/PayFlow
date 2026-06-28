import { useState, useCallback, useEffect } from "react";
import { getSubscription } from "../stellar";
import type { Subscription } from "../types";
import { useRpcHealthContext } from "../context/RpcHealthContext";

export function useSubscription(userKey: string, refreshTrigger?: number) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { circuitOpen } = useRpcHealthContext();

  const refresh = useCallback(async () => {
    if (circuitOpen) {
      setError("RPC unavailable");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getSubscription(userKey);
      setSubscription(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setSubscription(null);
    } finally {
      setLoading(false);
    }
  }, [userKey, circuitOpen]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  return { subscription, loading, error, refresh };
}
