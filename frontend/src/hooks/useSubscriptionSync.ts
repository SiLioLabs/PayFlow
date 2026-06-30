/**
 * useSubscriptionSync - Provides optimistic mutation capabilities for subscriptions.
 *
 * Combines useSubscription (remote state) with useTransaction (submission tracking).
 * Supports optimistic updates that revert on failure. Common mutations include
 * cancellation, pausing, resuming, and updating the daily limit.
 *
 * @param {string} userKey - Stellar public key of the subscriber
 * @param {number} [refreshTrigger] - Changing this value forces a data refresh
 * @returns {Object} Synced subscription state and mutation helpers
 * @returns {Subscription|null} returns.subscription - Locally-optimistic subscription data
 * @returns {boolean} returns.loading - True while the initial fetch is in progress
 * @returns {"idle"|"pending"|"success"|"failed"} returns.status - Transaction status from useTransaction
 * @returns {string|null} returns.error - Combined subscription or transaction error
 * @returns {Function} returns.mutate - Executes an action with optional optimistic update
 * @returns {Function} returns.refresh - Re-fetches subscription from the contract
 *
 * @example
 * const { subscription, loading, error, mutate, refresh } = useSubscriptionSync(publicKey);
 *
 * const handleCancel = async () => {
 *   await mutate(
 *     "cancel",
 *     async () => {
 *       const xdr = await buildCancelXdr();
 *       return wallet.signAndSubmit(xdr);
 *     },
 *     { status: "cancelled" }
 *   );
 * };
 */
import { useState, useCallback, useEffect } from "react";
import { useSubscription } from "./useSubscription";
import { useTransaction } from "./useTransaction";
import type { Subscription } from "../types";

export type MutationAction = 'cancel' | 'pause' | 'resume' | 'set_daily_limit';

export function useSubscriptionSync(userKey: string, refreshTrigger?: number) {
  const { subscription: remoteSubscription, loading, error: subError, refresh } = useSubscription(userKey, refreshTrigger);
  const { status, error: txError, submit } = useTransaction();
  
  const [localSubscription, setLocalSubscription] = useState<Subscription | null>(null);

  useEffect(() => {
    setLocalSubscription(remoteSubscription);
  }, [remoteSubscription]);

  const error = subError || txError;

  const mutate = useCallback(async (
    action: MutationAction,
    signAndSubmit: () => Promise<string>,
    optimisticUpdate?: Partial<Subscription>
  ) => {
    let previousState: Subscription | null = null;
    if (optimisticUpdate && localSubscription) {
      previousState = { ...localSubscription };
      setLocalSubscription({ ...localSubscription, ...optimisticUpdate });
    }

    try {
      await submit(signAndSubmit);
      refresh();
    } catch (e) {
      if (previousState) {
        setLocalSubscription(previousState);
      }
      throw e;
    }
  }, [localSubscription, submit, refresh]);

  return { subscription: localSubscription, loading, status, error, mutate, refresh };
}
