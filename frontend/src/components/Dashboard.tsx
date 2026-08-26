import React, { useState, useRef, useCallback, lazy, Suspense } from "react";
import { buildPayPerUseTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCard from "./SubscriptionCard";
import SubscriptionCardSkeleton from "./Skeleton";
import ErrorBoundary from "./ErrorBoundary";
import ErrorRecovery from "./ErrorRecovery";

// Lazy-load SubscriptionHistory so it is excluded from the main chunk (Issue #445).
const SubscriptionHistory = lazy(() => import("./SubscriptionHistory"));
import PayPerUseForm from "./PayPerUseForm";
import DailyLimitCard from "./DailyLimitCard";
import DailyLimitModal from "./DailyLimitModal";
import IncreaseAllowanceModal from "./IncreaseAllowanceModal";
import AllowanceDisplay from "./AllowanceDisplay";
import ReferralPanel from "./ReferralPanel";
import ToastContainer from "./Toast";
import EventFeed from "./EventFeed";
import SubscriptionExport from "./SubscriptionExport";
import { useSubscriptionSync } from "../hooks/useSubscriptionSync";
import { usePolling } from "../hooks/usePolling";
import { useToast } from "../hooks/useToast";
import { useRpcHealth } from "../hooks/useRpcHealth";
import { useTransaction } from "../hooks/useTransaction";
import { useResponsive } from "../hooks/useResponsive";
import { useRegisterShortcuts } from "../context/ShortcutRegistry";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
  announce: (message: string) => void;
  onCancelled?: () => void;
  onPayPerUse?: (amount: bigint) => void;
  isPaused?: boolean;
}

export default function Dashboard({
  userKey,
  onSign,
  refreshTrigger,
  announce,
  onCancelled,
  onPayPerUse,
  isPaused = false,
}: Props) {
  const { subscription: sub, loading, refresh } = useSubscriptionSync(userKey, refreshTrigger);
  const { toasts, addToast, removeToast } = useToast();
  const { status: rpcStatus, latencyMs: rpcLatency, error: rpcError } = useRpcHealth();
  const { isMobile } = useResponsive();
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

  const handlePayPerUse = useCallback(
    async (stroops: bigint) => {
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
    },
    [userKey, onSign, announce, addToast, onPayPerUse, ppuTx]
  );

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
    <div className={`dashboard${isMobile ? " dashboard--mobile" : ""}`}>
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

              {/* Real-time contract event feed (Issue #46) */}
              <EventFeed
                address={userKey}
                eventName="charged"
                title="My Recent Charges"
                maxEvents={25}
              />

              {/* Subscription export (Issue #48) */}
              {sub && (
                <div className="card">
                  <div className="flex-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold">Export Subscription Data</h3>
                      <p className="text-sm text-muted">
                        Download your subscription details for accounting or reporting.
                      </p>
                    </div>
                  </div>
                  <SubscriptionExport
                    data={[
                      {
                        merchant: sub.merchant,
                        amount_stroops: sub.amount,
                        interval_seconds: sub.interval,
                        last_charged: sub.last_charged,
                        active: sub.active,
                        paused: sub.paused,
                        trial_duration: sub.trial_duration ?? 0,
                        label: sub.label ?? "",
                      },
                    ]}
                    filename={`subscription-${userKey.slice(0, 8)}`}
                    label="Export Subscription"
                  />
                </div>
              )}

              <PayPerUseForm
                ref={ppuInputRef}
                onPay={handlePayPerUse}
                loading={ppuPending}
                isPaused={isPaused}
              />
              {ppuPending && (
                <p className="status-text status-text--pending">Confirming payment…</p>
              )}
              <ErrorRecovery
                error={ppuTx.error}
                onIncreaseAllowance={() => setShowIncreaseAllowance(true)}
                onViewDailyLimit={() => setShowDailyLimit(true)}
                dailyLimit={sub.amount} // We don't have exactly the daily limit fetched, but could be fetched or omitted.
              />
              <ReferralPanel publicKey={userKey} />
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
