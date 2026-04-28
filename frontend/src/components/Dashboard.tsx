import React, { useState } from "react";
import { buildCancelTx, buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCardSkeleton from "./Skeleton";
import SubscriptionCard from "./SubscriptionCard";
import SubscriptionHistory from "./SubscriptionHistory";
import PayPerUseForm from "./PayPerUseForm";
import ConfirmModal from "./ConfirmModal";
import { useSubscription } from "../hooks/useSubscription";
import { usePolling } from "../hooks/usePolling";
import { useToast } from "../hooks/useToast";
import ToastContainer from "./Toast";

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

  const [ppuLoading, setPpuLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  usePolling({
    callback: refresh,
    interval: 30000,
    enabled: !!sub?.active,
  });

  async function performCancel() {
    setShowConfirm(false);
    try {
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      addToast(`Cancelled. tx: ${hash.slice(0, 12)}…`, "info");
      refresh();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      addToast(friendlyError(rawMessage), "error");
    }
  }

  function handleCancel() {
    setShowConfirm(true);
  }

  async function handlePayPerUse(stroops: bigint) {
    setPpuLoading(true);
    try {
      const xdr = await buildPayPerUseTx(userKey, stroops);
      const hash = await onSign(xdr);
      addToast(`Paid! tx: ${hash.slice(0, 12)}…`, "success");
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      addToast(friendlyError(rawMessage), "error");
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
            <>
              <SubscriptionHistory userKey={userKey} />
              <PayPerUseForm onPay={handlePayPerUse} loading={ppuLoading} />
            </>
          )}
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />

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