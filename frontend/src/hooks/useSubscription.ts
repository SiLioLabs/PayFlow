/**
 * useSubscription - Fetches a single subscription record for a given user.
 *
 * Queries the PayFlow contract for a subscription tied to the provided public key.
 * Respects the RPC circuit breaker via useRpcHealthContext to avoid hammering a downed endpoint.
 * Re-reads contract state when the tab becomes visible or the window regains
 * focus, throttled by the visibility cooldown to avoid RPC bursts.
 *
 * @param {string} userKey - Stellar public key of the subscriber
 * @param {number} [refreshTrigger] - Increment to force a re-fetch from the network
 * @returns {Object} Subscription data and status
 * @returns {Subscription|null} returns.subscription - The subscription object, or null
 * @returns {boolean} returns.loading - True while fetching from the contract
 * @returns {string|null} returns.error - Error message if the fetch failed
 * @returns {Function} returns.refresh - Manually re-fetches the subscription
 *
 * @example
 * const { subscription, loading, error, refresh } = useSubscription(publicKey);
 *
 * if (loading) return <Spinner />;
 * if (error) return <div>{error}</div>;
 * if (!subscription) return <button onClick={refresh}>No subscription found</button>;
 *
 * return <SubscriptionCard subscription={subscription} />;
 */
import { useState, useCallback, useEffect } from "react";
import { getSubscription } from "../stellar";
import type { Subscription } from "../types";
import { useRpcHealthContext } from "../context/RpcHealthContext";
import { useVisibilityRefresh } from "./useVisibilityRefresh";
import { useVisibilityRefresh } from "./useVisibilityRefresh";

export function useSubscription(userKey: string, refreshTrigger?: number) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { circuitOpen } = useRpcHealthContext();

  const [prevUserKey, setPrevUserKey] = useState(userKey);
  if (userKey !== prevUserKey) {
    setPrevUserKey(userKey);
    setSubscription(null);
    setLoading(true);
    setError(null);
  }

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

  // Re-read contract state when the user returns to the tab, throttled by
  // the default 5s cooldown to avoid RPC bursts on rapid alt-tab.
  useVisibilityRefresh(refresh);

  // Re-read contract state when the user returns to the tab.


  useVisibilityRefresh(refresh);



  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  return { subscription, loading, error, refresh };
}
