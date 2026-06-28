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
