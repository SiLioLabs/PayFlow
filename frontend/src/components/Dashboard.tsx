import React, { useEffect, useState, useCallback } from "react";
import { buildCancelTx, buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCardSkeleton from "./Skeleton";
import { useSubscription } from "../hooks/useSubscription";
import SubscriptionCard from "./SubscriptionCard";
import PayPerUseForm from "./PayPerUseForm";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
}

function formatInterval(secs: number): string {
  if (secs >= 2_592_000) return `${Math.round(secs / 2_592_000)}mo`;
  if (secs >= 604_800) return `${Math.round(secs / 604_800)}w`;
  if (secs >= 86_400) return `${Math.round(secs / 86_400)}d`;
  return `${secs}s`;
}

export default function Dashboard({ userKey, onSign, refreshTrigger }: Props) {
  const { subscription: sub, loading, refresh } =
    useSubscription(userKey, refreshTrigger);

  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [ppuLoading, setPpuLoading] = useState(false);

  // Optional manual refresh wrapper (NO name conflict anymore)
  const reload = useCallback(async () => {
    await refresh();
  }, [refresh]);

  useEffect(() => {
    reload();
  }, [reload, refreshTrigger]);

  async function handleCancel() {
    setActionStatus(null);
    try {
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      setActionStatus(`Cancelled. tx: ${hash.slice(0, 12)}…`);
      reload();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      setActionStatus(`Error: ${friendlyError(rawMessage)}`);
    }
  }

  async function handlePayPerUse(stroops: bigint) {
    setActionStatus(null);
    setPpuLoading(true);
    try {
      const xdr = await buildPayPerUseTx(userKey, stroops);
      const hash = await onSign(xdr);
      setActionStatus(`Paid! tx: ${hash.slice(0, 12)}…`);
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      setActionStatus(`Error: ${friendlyError(rawMessage)}`);
    } finally {
      setPpuLoading(false);
    }
  }

  if (loading) return <SubscriptionCardSkeleton />;

  if (!sub) {
    return (
      <div className="card">
        <p className="no-sub-text">No active subscription found.</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <SubscriptionCard subscription={sub} onCancel={handleCancel} />

      {sub.active && (
        <PayPerUseForm onPay={handlePayPerUse} loading={ppuLoading} />
      )}

      {actionStatus && (
        <p
          className="action-status"
          style={{
            color: actionStatus.startsWith("Error")
              ? "var(--color-danger)"
              : "var(--color-success)",
          }}
        >
          {actionStatus}
        </p>
      )}
    </div>
  );
}