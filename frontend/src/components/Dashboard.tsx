import React, { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
import {
  buildPayPerUseTx,
  getDailyLimit,
  getDailySpent,
  getDayStart,
  ChargeSimResult,
  chargeSimBlocksPay,
  payBlockedReason,
  payWarningReason,
  subscriptionHealthBlocksPay,
  SubscriptionHealth,
} from "../stellar";
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
  /** When true, wallet mutations are disabled because the browser is offline. */
  isOffline?: boolean;
}

export default function Dashboard({
  userKey,
  onSign,
  refreshTrigger,
  announce,
  onCancelled,
  onPayPerUse,
  isPaused = false,
  isOffline = false,
}: Props) {
  const { subscription: sub, loading, refresh } = useSubscriptionSync(userKey, refreshTrigger);
  const { toasts, addToast, removeToast } = useToast();
  const { status: rpcStatus, latencyMs: rpcLatency, error: rpcError } = useRpcHealth();
  const { isMobile } = useResponsive();
  const ppuTx = useTransaction();
  const [subHealth, setSubHealth] = useState<SubscriptionHealth | null>(null);
  const [simResult, setSimResult] = useState<ChargeSimResult | null>(null);
  const [showDailyLimit, setShowDailyLimit] = useState(false);
  const [showIncreaseAllowance, setShowIncreaseAllowance] = useState(false);
  const [allowanceRefresh, setAllowanceRefresh] = useState(0);
  const [dailyLimitRefresh, setDailyLimitRefresh] = useState(0);
  const ppuInputRef = useRef<HTMLInputElement>(null);
  const [dailyLimit, setDailyLimit] = useState<bigint | null>(null);
  const [dailySpent, setDailySpent] = useState<bigint | null>(null);
  const [dayStart, setDayStart] = useState<bigint | null>(null);
  const [dailyLimitLoading, setDailyLimitLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadLimitForForm() {
      if (!sub?.active) return;
      setDailyLimitLoading(true);
      try {
        const [limit, spent, start] = await Promise.all([
          getDailyLimit(userKey),
          getDailySpent(userKey),
          getDayStart(userKey),
        ]);
        if (!cancelled) {
          setDailyLimit(limit);
          setDailySpent(spent);
          setDayStart(start);
        }
      } catch {
        if (!cancelled) {
          setDailyLimit(null);
          setDailySpent(null);
          setDayStart(null);
        }
      } finally {
        if (!cancelled) setDailyLimitLoading(false);
      }
    }
    loadLimitForForm();
    return () => {
      cancelled = true;
    };
  }, [userKey, sub?.active, dailyLimitRefresh, ppuTx.status]);

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
      if (isOffline) {
        announce("You're offline. Wallet actions are unavailable.");
        return;
      }
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
    [userKey, onSign, announce, addToast, onPayPerUse, ppuTx, isOffline]
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
            showSimulateCharge={sub.active}
            onHealthChange={setSubHealth}
            onSimulateResult={setSimResult}
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
                        subscriber: userKey,
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
                disabled={
                  isOffline ||
                  subscriptionHealthBlocksPay(subHealth) ||
                  chargeSimBlocksPay(simResult)
                }
                disabledReason={
                  isOffline
                    ? "You're offline. Wallet actions are unavailable."
                    : (payBlockedReason(subHealth, simResult) ?? undefined)
                }
                warningReason={payWarningReason(subHealth, simResult) ?? undefined}
                dailyLimit={dailyLimit}
                dailySpent={dailySpent}
                dayActive={dayStart !== null}
                isLimitLoading={dailyLimitLoading}
              />
              {ppuPending && (
                <p className="status-text status-text--pending">Confirming payment…</p>
              )}
              <ErrorRecovery
                error={ppuTx.error}
                onIncreaseAllowance={() => setShowIncreaseAllowance(true)}
                onViewDailyLimit={() => setShowDailyLimit(true)}
                dailyLimit={sub.amount}
                health={subHealth}
                simulateResult={simResult}
              />
              <ReferralPanel publicKey={userKey} />
            </>
          )}
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} isPaused={isPaused} />

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
