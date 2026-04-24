import React, { useEffect, useState, useCallback } from "react";
import { getSubscription, buildCancelTx, buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCardSkeleton from "./Skeleton";
import { useSubscription } from "../hooks/useSubscription";

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
  const { subscription: sub, loading, refresh: load } = useSubscription(userKey, refreshTrigger);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [ppuLoading, setPpuLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSubscription(userKey);
      setSub(data);
    } catch {
      setSub(null);
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  async function handleCancel() {
    setActionStatus(null);
    try {
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      setActionStatus(`Cancelled. tx: ${hash.slice(0, 12)}…`);
      load();
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
        /* Dynamic: color is error/success state-driven — inline color is intentional */
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
