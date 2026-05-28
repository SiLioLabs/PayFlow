import React, { useState } from "react";
import { buildCancelTx, buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCardSkeleton from "./Skeleton";
import SubscriptionCard from "./SubscriptionCard";
import SubscriptionHistory from "./SubscriptionHistory";
import PayPerUseForm from "./PayPerUseForm";
import ConfirmModal from "./ConfirmModal";
import IncreaseAllowanceModal from "./IncreaseAllowanceModal";
import AllowanceDisplay from "./AllowanceDisplay";
import ToastContainer from "./Toast";
import { useSubscription } from "../hooks/useSubscription";
import { usePolling } from "../hooks/usePolling";
import { useToast } from "../hooks/useToast";
import { useTransaction } from "../hooks/useTransaction";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
  announce: (message: string) => void;
}

export default function Dashboard({ userKey, onSign, refreshTrigger, announce }: Props) {
  const { subscription: sub, loading, refresh } = useSubscription(userKey, refreshTrigger);
  const { toasts, addToast, removeToast } = useToast();
  const cancelTx = useTransaction();
  const ppuTx = useTransaction();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showIncreaseAllowance, setShowIncreaseAllowance] = useState(false);
  const [allowanceRefresh, setAllowanceRefresh] = useState(0);

  usePolling({ callback: refresh, interval: 30000, enabled: !!sub?.active });

  async function performCancel() {
    setShowConfirm(false);
    announce("Transaction submitted");
    const hash = await cancelTx.submit(async () => {
      const xdr = await buildCancelTx(userKey);
      return onSign(xdr);
    });
    if (hash) {
      addToast(`Cancelled. tx: ${hash.slice(0, 12)}…`, "success");
      announce("Transaction confirmed");
      refresh();
    } else if (cancelTx.error) {
      const msg = `Error: ${friendlyError(cancelTx.error)}`;
      addToast(msg, "error");
      announce(msg);
    }
  }

  async function handlePayPerUse(stroops: bigint) {
    announce("Transaction submitted");
    const hash = await ppuTx.submit(async () => {
      const xdr = await buildPayPerUseTx(userKey, stroops);
      return onSign(xdr);
    });
    if (hash) {
      addToast(`Paid! tx: ${hash.slice(0, 12)}…`, "success");
      announce("Transaction confirmed");
    } else if (ppuTx.error) {
      const msg = `Error: ${friendlyError(ppuTx.error)}`;
      addToast(msg, "error");
      announce(msg);
    }
  }

  if (loading) return <SubscriptionCardSkeleton />;

  const cancelPending = cancelTx.status === "pending";
  const ppuPending = ppuTx.status === "pending";

  return (
    <div className="dashboard">
      {!sub ? (
        <div className="card">
          <p className="no-sub-text">No active subscription found.</p>
        </div>
      ) : (
        <>
          <SubscriptionCard
            subscription={sub}
            onCancel={() => setShowConfirm(true)}
          />

          {cancelPending && (
            <p className="status-text status-text--pending">Confirming cancellation…</p>
          )}

          {sub.active && (
            <>
              <div className="card allowance-card">
                <div className="allowance-card__row">
                  <AllowanceDisplay
                    userKey={userKey}
                    subscriptionAmount={BigInt(sub.amount)}
                    refreshTrigger={allowanceRefresh}
                  />
                  <button className="btn-secondary" onClick={() => setShowIncreaseAllowance(true)}>
                    Increase Allowance
                  </button>
                </div>
              </div>

              <SubscriptionHistory userKey={userKey} />
              <PayPerUseForm onPay={handlePayPerUse} loading={ppuPending} />
              {ppuPending && (
                <p className="status-text status-text--pending">Confirming payment…</p>
              )}
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

      {showIncreaseAllowance && sub?.active && (
        <IncreaseAllowanceModal
          userKey={userKey}
          subscriptionAmount={BigInt(sub.amount)}
          onSign={onSign}
          onClose={() => setShowIncreaseAllowance(false)}
          onSuccess={() => {
            setShowIncreaseAllowance(false);
            setAllowanceRefresh((value) => value + 1);
            refresh();
          }}
          announce={announce}
        />
      )}
    </div>
  );
}
