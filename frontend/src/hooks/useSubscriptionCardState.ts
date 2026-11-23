import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildCancelTx,
  getAllowance,
  getPauseUntil,
  getTrialEnd,
  isSubscriptionHealthy,
  subscriptionHasWarnings,
} from "../stellar";
import type { SubscriptionHealth } from "../stellar";
import type { Subscription } from "../types";
import { usePauseResume } from "./usePauseResume";
import { useSubscriptionSync } from "./useSubscriptionSync";
import { useToast } from "./useToast";
import { computeAllowanceHealth } from "../components/SubscriptionStatusBadge";

interface UseSubscriptionCardStateOptions {
  subscription: Subscription;
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onRefresh: () => void;
  onCancelled?: () => void;
  onHealthChange?: (health: SubscriptionHealth | null) => void;
}

export function useSubscriptionCardState({
  subscription,
  userKey,
  onSign,
  onRefresh,
  onCancelled,
  onHealthChange,
}: UseSubscriptionCardStateOptions) {
  const { amount, active, paused } = subscription;
  const { mutate } = useSubscriptionSync(userKey);
  const { addToast } = useToast();
  const { pause, pauseUntil, resume, pauseTx, pauseUntilTx, resumeTx } = usePauseResume(
    userKey,
    onSign,
    onRefresh
  );

  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowanceLoading, setAllowanceLoading] = useState(true);
  const [trialEndTimestamp, setTrialEndTimestamp] = useState<number | null>(null);
  const [scheduledResumeAt, setScheduledResumeAt] = useState<number | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelStatus, setCancelStatus] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [subHealth, setSubHealth] = useState<SubscriptionHealth | null>(null);
  const pauseSubmittingRef = useRef(false);
  const cancelSubmittingRef = useRef(false);

  const refreshAllowance = useCallback(() => {
    setAllowanceLoading(true);
    getAllowance(userKey)
      .then(setAllowance)
      .catch(() => setAllowance(null))
      .finally(() => setAllowanceLoading(false));
  }, [userKey]);

  useEffect(() => {
    if (!active) return;
    refreshAllowance();
  }, [active, refreshAllowance]);

  useEffect(() => {
    if (!active) return;
    getTrialEnd(userKey)
      .then((timestamp) => {
        if (timestamp === null) {
          setTrialEndTimestamp(null);
          return;
        }
        const timestampSeconds = Number(timestamp);
        const nowSeconds = Math.floor(Date.now() / 1000);
        setTrialEndTimestamp(timestampSeconds > nowSeconds ? timestampSeconds : null);
      })
      .catch(() => setTrialEndTimestamp(null));
  }, [userKey, active]);

  useEffect(() => {
    if (!active || !paused) {
      setScheduledResumeAt(null);
      return;
    }

    let cancelled = false;
    getPauseUntil(userKey)
      .then((expiry) => {
        if (!cancelled) setScheduledResumeAt(expiry);
      })
      .catch(() => {
        if (!cancelled) setScheduledResumeAt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userKey, active, paused]);

  const handleCancel = async () => {
    if (cancelSubmittingRef.current) return false;
    cancelSubmittingRef.current = true;
    setCancelLoading(true);
    setCancelStatus("");
    try {
      await mutate(
        "cancel",
        async () => {
          const xdr = await buildCancelTx(userKey);
          return onSign(xdr);
        },
        { active: false }
      );
      setCancelStatus("Cancelled successfully.");
      setCancelError(null);
      onCancelled?.();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setCancelError(message);
      setCancelStatus(message);
      addToast(`Error: ${message}`, "error");
      return false;
    } finally {
      cancelSubmittingRef.current = false;
      setCancelLoading(false);
    }
  };

  const handlePause = async (expirySeconds: number | null): Promise<boolean> => {
    if (pauseSubmittingRef.current) return false;
    pauseSubmittingRef.current = true;
    try {
      if (expirySeconds !== null) {
        await pauseUntil(BigInt(expirySeconds));
        setScheduledResumeAt(expirySeconds);
      } else {
        await pause();
        setScheduledResumeAt(null);
      }
      return true;
    } catch {
      return false;
    } finally {
      pauseSubmittingRef.current = false;
    }
  };

  const handleResume = async () => {
    try {
      await resume();
    } catch {
      // The transaction hook retains the failure reason for the status display.
    }
  };

  const handleHealthChange = (health: SubscriptionHealth | null) => {
    setSubHealth(health);
    onHealthChange?.(health);
  };

  let pauseStatus = "";
  if (pauseTx.state === "pending" || pauseUntilTx.state === "pending") {
    pauseStatus = "Pausing…";
  } else if (pauseTx.state === "success") {
    pauseStatus = "Paused successfully.";
  } else if (pauseUntilTx.state === "success") {
    pauseStatus = scheduledResumeAt
      ? `Paused until ${new Date(scheduledResumeAt * 1000).toLocaleString()}.`
      : "Paused successfully.";
  } else if (pauseTx.state === "failed") {
    pauseStatus = pauseTx.error || "Failed to pause";
  } else if (pauseUntilTx.state === "failed") {
    pauseStatus = pauseUntilTx.error || "Failed to pause";
  } else if (resumeTx.state === "pending") {
    pauseStatus = "Resuming…";
  } else if (resumeTx.state === "success") {
    pauseStatus = "Resumed successfully.";
  } else if (resumeTx.state === "failed") {
    pauseStatus = resumeTx.error || "Failed to resume";
  }

  const hasPauseError =
    pauseTx.state === "failed" ||
    pauseUntilTx.state === "failed" ||
    resumeTx.state === "failed";
  const pauseError = pauseTx.error || pauseUntilTx.error || resumeTx.error;
  const healthUnhealthy = subHealth != null && subscriptionHasWarnings(subHealth);

  return {
    allowanceHealth: computeAllowanceHealth(allowance, BigInt(amount)),
    allowanceLoading,
    refreshAllowance,
    trialEndTimestamp,
    isInTrial: trialEndTimestamp !== null && trialEndTimestamp > Math.floor(Date.now() / 1000),
    scheduledResumeAt,
    cancelLoading,
    cancelStatus,
    cancelError,
    pauseTx,
    pauseUntilTx,
    resumeTx,
    pauseStatus,
    hasPauseError,
    pauseError,
    subHealth,
    healthUnhealthy,
    healthBlocksActions: subHealth != null && !isSubscriptionHealthy(subHealth),
    handleCancel,
    handlePause,
    handleResume,
    handleHealthChange,
  };
}
