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
import { useAccessibility } from "../hooks/useAccessibility";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
  announce: (message: string) => void;
}

export default function Dashboard({ userKey, onSign, refreshTrigger, announce }: Props) {
  const {
    subscription: sub,
    loading,
    refresh,
  } = useSubscription(userKey, refreshTrigger);

  const [ppuLoading, setPpuLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { announce } = useAccessibility();

  usePolling({
    callback: refresh,
    interval: 30000,
    enabled: !!sub?.active,
  });

  async function performCancel() {
    setShowConfirm(false);
    setActionStatus(null);
    announce("Transaction submitted");
    try {
      announce("Transaction submitted");
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      const msg = `Cancelled. tx: ${hash.slice(0, 12)}…`;
      setActionStatus(msg);
      announce("Transaction confirmed");
      refresh();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const msg = `Error: ${friendlyError(rawMessage)}`;
      setActionStatus(msg);
      announce(msg);
    }
  }

  function handleCancel() {
    setShowConfirm(true);
  }

  async function handlePayPerUse(stroops: bigint) {
    setPpuLoading(true);
    announce("Transaction submitted");
    try {
      announce("Transaction submitted");
      const xdr = await buildPayPerUseTx(userKey, stroops);
      const hash = await onSign(xdr);
      const msg = `Paid! tx: ${hash.slice(0, 12)}…`;
      setActionStatus(msg);
      announce("Transaction confirmed");
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const msg = `Error: ${friendlyError(rawMessage)}`;
      setActionStatus(msg);
      announce(msg);
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