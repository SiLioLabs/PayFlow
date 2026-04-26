import React, { useState } from "react";
import { buildCancelTx, buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCardSkeleton from "./Skeleton";
import SubscriptionCard from "./SubscriptionCard";
import PayPerUseForm from "./PayPerUseForm";
import ConfirmModal from "./ConfirmModal";
import { useSubscription } from "../hooks/useSubscription";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
}

export default function Dashboard({ userKey, onSign, refreshTrigger }: Props) {
  const {
    subscription: sub,
    loading,
    refresh,
  } = useSubscription(userKey, refreshTrigger);

  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [ppuLoading, setPpuLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function performCancel() {
    setShowConfirm(false);
    setActionStatus(null);
    try {
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      setActionStatus(`Cancelled. tx: ${hash.slice(0, 12)}…`);
      refresh();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      setActionStatus(`Error: ${friendlyError(rawMessage)}`);
    }
  }

  function handleCancel() {
    setShowConfirm(true);
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

  return (
    <div className="dashboard">
      {!sub ? (
        <div className="card">
          <p className="no-sub-text">No active subscription found.</p>
        </div>
      ) : (
        <>
          <SubscriptionCard subscription={sub} onCancel={handleCancel} />

          {sub.active && (
            <PayPerUseForm onPay={handlePayPerUse} loading={ppuLoading} />
          )}
        </>
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

      {showConfirm && (
        <ConfirmModal
          message="Are you sure you want to cancel your subscription? This cannot be undone."
          onConfirm={performCancel}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}