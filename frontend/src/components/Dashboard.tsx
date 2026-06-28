import React, { useState, useRef, useCallback, lazy, Suspense } from "react";
import { buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCard from "./SubscriptionCard";
import SubscriptionCardSkeleton from "./Skeleton";
import ErrorBoundary from "./ErrorBoundary";

// Lazy-load SubscriptionHistory so it is excluded from the main chunk (Issue #445).
const SubscriptionHistory = lazy(() => import("./SubscriptionHistory"));
import PayPerUseForm from "./PayPerUseForm";
import DailyLimitCard from "./DailyLimitCard";
import DailyLimitModal from "./DailyLimitModal";
import IncreaseAllowanceModal from "./IncreaseAllowanceModal";
import AllowanceDisplay from "./AllowanceDisplay";
import ToastContainer from "./Toast";
import { useSubscriptionSync } from "../hooks/useSubscriptionSync";
import { usePolling } from "../hooks/usePolling";
import { useToast } from "../hooks/useToast";
import { useRpcHealth } from "../hooks/useRpcHealth";
import { useTransaction } from "../hooks/useTransaction";
import { useRegisterShortcuts } from "../context/ShortcutRegistry";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
  announce: (message: string) => void;
  onCancelled?: () => void;
  onPayPerUse?: (amount: bigint) => void;
}

export default function Dashboard({ userKey, onSign, refreshTrigger, announce, onCancelled, onPayPerUse }: Props) {
  const { subscription: sub, loading, refresh } = useSubscriptionSync(userKey, refreshTrigger);
  const { toasts, addToast, removeToast } = useToast();
  const { status: rpcStatus, latencyMs: rpcLatency, error: rpcError } = useRpcHealth();
  const ppuTx = useTransaction();
  const [showDailyLimit, setShowDailyLimit] = useState(false);
  const [showIncreaseAllowance, setShowIncreaseAllowance] = useState(false);
  const [allowanceRefresh, setAllowanceRefresh] = useState(0);
  const [dailyLimitRefresh, setDailyLimitRefresh] = useState(0);
  const ppuInputRef = useRef<HTMLInputElement>(null);

  usePolling({ callback: refresh, interval: 30000, enabled: !!sub?.active });

  useRegisterShortcuts(
    sub?.active
      ? [
          {
            key: "p",
            description: "Focus pay-per-use amount input",
            action: () => {
              ppuInputRef.current?.focus();
            },
          },
        ]
      : []
  );

  const handlePayPerUse = useCallback(async (stroops: bigint) => {
    announce("Transaction submitted");
    try {
      const hash = await ppuTx.submit(async () => {
        const xdr = await buildPayPerUseTx(userKey, stroops);
        return onSign(xdr);
      });
      addToast("Paid!", "success", hash);
      announce("Transaction confirmed");
      onPayPerUse?.(stroops);
    } catch (e: unknown) {
      const msg = `Error: ${friendlyError(e instanceof Error ? e.message : String(e))}`;
      addToast(msg, "error");
      announce(msg);
    }
  }, [userKey, onSign, announce, addToast, onPayPerUse, ppuTx]);

  if (loading)
    return (
      <>
        {rpcStatus === "degraded" && (
          <div className="network-warning network-warning--degraded" role="alert">
            <span>⚠️</span>
            <span>RPC connection degraded: Latency is high ({rpcLatency}ms)</span>
          </div>
        )}
        {rpcStatus === "unreachable" && rpcError && (
          <div className="network-warning" role="alert">
            <span>⚠️</span>
            <span>RPC endpoint unreachable: {rpcError}</span>
          </div>
        )}
        <SubscriptionCardSkeleton />
      </>
    );

  const ppuPending = ppuTx.status === "pending";

  return (
    <div className="dashboard">
      {rpcStatus === "degraded" && (
        <div className="network-warning network-warning--degraded" role="alert">
          <span>⚠️</span>
          <span>RPC connection degraded: Latency is high ({rpcLatency}ms)</span>
        </div>
      )}
      {rpcStatus === "unreachable" && rpcError && (
        <div className="network-warning" role="alert">
          <span>⚠️</span>
          <span>RPC endpoint unreachable: {rpcError}</span>
        </div>
      )}
      {!sub ? (
        <div className="card">
          <p className="no-sub-text">No active subscription found.</p>
        </div>
      ) : (
        <>
          <SubscriptionCard
            subscription={sub}
            userKey={userKey}
            onSign={onSign}
            onRefresh={refresh}
            onCancelled={onCancelled}
          />

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
                <DailyLimitCard
                  userKey={userKey}
                  refreshTrigger={dailyLimitRefresh}
                  onOpen={() => setShowDailyLimit(true)}
                />

              </div>

              <ErrorBoundary>
                <Suspense fallback={<SubscriptionCardSkeleton />}>
                  <SubscriptionHistory userKey={userKey} />
                </Suspense>
              </ErrorBoundary>
              <PayPerUseForm ref={ppuInputRef} onPay={handlePayPerUse} loading={ppuPending} />
              {ppuPending && (
                <p className="status-text status-text--pending">Confirming payment…</p>
              )}
            </>
          )}
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {showDailyLimit && sub?.active && (
        <DailyLimitModal
          userKey={userKey}
          onSign={onSign}
          onClose={() => setShowDailyLimit(false)}
          onSuccess={() => {
            setShowDailyLimit(false);
            setDailyLimitRefresh((value) => value + 1);
          }}
          announce={announce}
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
