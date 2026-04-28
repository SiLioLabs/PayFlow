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
  const { announce } = useAccessibility();

  usePolling({
    callback: refresh,
    interval: 30000,
    enabled: !!sub?.active,
  });

  async function performCancel() {
    setShowConfirm(false);
    setActionStatus(null);
    try {
      announce("Transaction submitted");
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      announce("Transaction confirmed");
      setActionStatus(`Cancelled. tx: ${hash.slice(0, 12)}…`);
      refresh();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const friendlyMsg = friendlyError(rawMessage);
      announce(`Error: ${friendlyMsg}`);
      setActionStatus(`Error: ${friendlyMsg}`);
    }
  }

  function handleCancel() {
    setShowConfirm(true);
  }

  async function handlePayPerUse(stroops: bigint) {
    setActionStatus(null);
    setPpuLoading(true);
    try {
      announce("Transaction submitted");
      const xdr = await buildPayPerUseTx(userKey, stroops);
      const hash = await onSign(xdr);
      announce("Transaction confirmed");
      setActionStatus(`Paid! tx: ${hash.slice(0, 12)}…`);
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const friendlyMsg = friendlyError(rawMessage);
      announce(`Error: ${friendlyMsg}`);
      setActionStatus(`Error: ${friendlyMsg}`);
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