import React, { useState } from "react";
import CopyButton from "./CopyButton";
import NextChargeCountdown from "./NextChargeCountdown";
import SubscriptionActions from "./SubscriptionActions";
import SubscriptionCardModals from "./SubscriptionCardModals";
import SubscriptionCardStatus from "./SubscriptionCardStatus";
import SubscriptionHealthWidget from "./SubscriptionHealthWidget";
import {
  AllowanceHealthBadge,
  SubscriptionStatusBadge,
  TrialBadge,
} from "./SubscriptionStatusBadge";
import { BILLING_INTERVALS } from "../constants";
import { useResponsive } from "../hooks/useResponsive";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { useSubscriptionCardState } from "../hooks/useSubscriptionCardState";
import { useToast } from "../hooks/useToast";
import type { ChargeSimResult, SubscriptionHealth } from "../stellar";
import type { Subscription } from "../types";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { formatDateTime } from "../utils/format";

// ── Types ─────────────────────────────────────────────────────────────────────

export { computeAllowanceHealth, TrialBadge } from "./SubscriptionStatusBadge";
export type { AllowanceHealth } from "./SubscriptionStatusBadge";

interface SubscriptionCardProps {
  subscription: Subscription;
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onRefresh: () => void;
  onCancelled?: () => void;
  showSimulateCharge?: boolean;
  onHealthChange?: (health: SubscriptionHealth | null) => void;
  onSimulateResult?: (result: ChargeSimResult | null) => void;
}

function formatInterval(secs: number): string {
  const monthly = BILLING_INTERVALS[2].value;
  const weekly = BILLING_INTERVALS[1].value;
  const daily = BILLING_INTERVALS[0].value;
  if (secs >= monthly) return `${Math.round(secs / monthly)}mo`;
  if (secs >= weekly) return `${Math.round(secs / weekly)}w`;
  if (secs >= daily) return `${Math.round(secs / daily)}d`;
  return `${secs}s`;
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * Compute the allowance health tier given the raw allowance and subscription
 * amount (both in stroops).
 */
export function computeAllowanceHealth(allowance: bigint | null, amount: bigint): AllowanceHealth {
  if (allowance === null) return "unknown";
  if (allowance === 0n) return "none";
  if (allowance < amount) return "low";
  if (amount > 0n && allowance >= amount * 3n) return "healthy";
  // allowance >= amount but < 3x — still considered "low" (not enough for 3 charges)
  return "low";
}

// ── AllowanceHealthBadge ──────────────────────────────────────────────────────

interface AllowanceHealthBadgeProps {
  health: AllowanceHealth;
  loading: boolean;
  onClick: () => void;
}

function AllowanceHealthBadge({ health, loading, onClick }: AllowanceHealthBadgeProps) {
  if (loading) {
    return (
      <span
        className="allowance-health-badge allowance-health-badge--unknown"
        aria-label="Checking allowance…"
      >
        Checking…
      </span>
    );
  }

  if (health === "healthy") {
    return (
      <span
        className="allowance-health-badge allowance-health-badge--healthy"
        aria-label="Allowance is healthy"
        data-testid="allowance-badge-healthy"
      >
        ✓ Healthy
      </span>
    );
  }

  // Clickable badges for actionable states
  const label =
    health === "none"
      ? "No allowance — charges will fail"
      : health === "low"
        ? "Allowance too low"
        : "Allowance unknown";

  const className =
    health === "none"
      ? "allowance-health-badge allowance-health-badge--none"
      : health === "low"
        ? "allowance-health-badge allowance-health-badge--low"
        : "allowance-health-badge allowance-health-badge--unknown";

  return (
    <button
      className={className}
      onClick={onClick}
      aria-label={`${label}. Click to increase allowance.`}
      data-testid={`allowance-badge-${health}`}
    >
      {health === "none"
        ? "⚠ No allowance — charges will fail"
        : health === "low"
          ? "⚠ Allowance too low"
          : "? Allowance unknown"}
    </button>
  );
}

// ── TrialBadge ────────────────────────────────────────────────────────────────

interface TrialBadgeProps {
  /** Unix timestamp (seconds) when the trial ends, or null if not in trial. */
  trialEndTimestamp: number | null;
}

/**
 * Renders an amber "Trial ends in X days" badge when a trial is active.
 * Shows "Trial ends today" when fewer than 1 full day remains.
 * Returns null (no badge) when not in a trial.
 */
export function TrialBadge({ trialEndTimestamp }: TrialBadgeProps) {
  if (trialEndTimestamp === null) return null;

  const nowSecs = Math.floor(Date.now() / 1000);
  if (trialEndTimestamp <= nowSecs) return null; // trial already ended

  const daysRemaining = Math.ceil((trialEndTimestamp - nowSecs) / (24 * 60 * 60));
  const label =
    daysRemaining <= 1
      ? "Trial ends today"
      : `Trial ends in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;

  const exactDate = formatDateTime(new Date(trialEndTimestamp * 1000));

  return (
    <span
      className="trial-badge"
      aria-label={`Trial period active. ${label}`}
      data-testid="trial-badge"
      title={exactDate}
    >
      🎁 {label}
    </span>
  );
}

// ── SubscriptionCard ──────────────────────────────────────────────────────────

function StackedRow({
  label,
  value,
  isMobile,
}: {
  label: string;
  value: string;
  isMobile: boolean;
}) {
  return (
    <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
      <span className="subscription-row__label">{label}</span>
      <span className="subscription-row__value">{value}</span>
    </div>
  );
}

export default function SubscriptionCard({
  subscription,
  userKey,
  onSign,
  onRefresh,
  onCancelled,
  showSimulateCharge = false,
  onHealthChange,
  onSimulateResult,
}: SubscriptionCardProps) {
  const { merchant, amount, interval, last_charged, active, paused } = subscription;
  const { isMobile } = useResponsive();
  const { displayCurrentAmount } = useAmountDisplay();
  const { addToast } = useToast();
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const cardState = useSubscriptionCardState({
    subscription,
    userKey,
    onSign,
    onRefresh,
    onCancelled,
    onHealthChange,
  });

  const pauseFailed = cardState.hasPauseError;
  const status = pauseFailed
    ? cardState.pauseStatus
    : cardState.cancelStatus || cardState.pauseStatus;
  const amountBigInt = BigInt(amount);
  const health = computeAllowanceHealth(allowance, amountBigInt);

  // ── Trial period state (Issue #666) ───────────────────────────────────────
  /** Unix timestamp (seconds) when trial ends, or null if no active trial. */
  const [trialEndTimestamp, setTrialEndTimestamp] = useState<number | null>(null);

  useRegisterShortcuts(
    active
      ? [
          {
            key: "x",
            description: "Cancel active subscription",
            action: () => openCancelDialog(null),
          },
        ]
      : []
  );

  // Fetch allowance on mount / when user changes
  useEffect(() => {
    if (!active) return;
    setAllowanceLoading(true);
    getAllowance(userKey)
      .then((val) => setAllowance(val))
      .catch(() => setAllowance(null)) // RPC error → "unknown" state
      .finally(() => setAllowanceLoading(false));
  }, [userKey, active]);

  // Fetch trial end timestamp on mount / when user changes (Issue #666)
  useEffect(() => {
    if (!active) return;
    getTrialEnd(userKey)
      .then((ts) => {
        if (ts === null) {
          setTrialEndTimestamp(null);
          return;
        }
        const tsSeconds = Number(ts);
        const nowSecs = Math.floor(Date.now() / 1000);
        // Only show badge when trial is still active
        setTrialEndTimestamp(tsSeconds > nowSecs ? tsSeconds : null);
      })
      .catch(() => setTrialEndTimestamp(null)); // RPC error → hide badge, don't crash
  }, [userKey, active]);

  useEffect(() => {
    if (!active || !paused) {
      setScheduledResumeAt(null);
      return;
    }
    let cancelled = false;
    getPauseUntil(userKey)
      .then((expiry) => {
        if (!cancelled) setScheduledResumeAt(expiry);
      })
      .catch(() => {
        if (!cancelled) setScheduledResumeAt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userKey, active, paused]);

  const handleCancel = async () => {
    // Guard against a double-submit: cancelLoading only reflects the previous
    // render, so without this latch two rapid clicks would sign twice.
    if (cancelSubmittingRef.current) return;
    cancelSubmittingRef.current = true;
    setCancelLoading(true);
    setCancelStatus("");
    try {
      await mutate(
        "cancel",
        async () => {
          const xdr = await buildCancelTx(userKey);
          return onSign(xdr);
        },
        { active: false }
      );
      setCancelStatus("Cancelled successfully.");
      setCancelError(null);
      setShowCancelConfirm(false);
      onCancelled?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCancelError(msg);
      setCancelStatus(msg);
      addToast(`Error: ${msg}`, "error");
    } finally {
      cancelSubmittingRef.current = false;
      setCancelLoading(false);
    }
  };

  const handlePause = async () => {
    // Guard against a double-submit from a fast double click / Enter repeat.
    if (pauseSubmittingRef.current) return;
    pauseSubmittingRef.current = true;
    try {
      if (pauseMode === "until") {
        if (!pauseUntilInput) {
          setPauseValidationError("Choose a resume date and time.");
          return;
        }
        const expirySeconds = Math.floor(new Date(pauseUntilInput).getTime() / 1000);
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(expirySeconds) || expirySeconds <= nowSeconds) {
          setPauseValidationError(friendlyError("error(contract, #27)"));
          return;
        }
        setPauseValidationError(null);
        try {
          await pauseUntil(BigInt(expirySeconds));
          setScheduledResumeAt(expirySeconds);
          setShowPauseConfirm(false);
        } catch {
          // pauseUntilTx.error holds the failure reason
        }
        return;
      }

      try {
        await pause();
        setScheduledResumeAt(null);
        setShowPauseConfirm(false);
      } catch {
        // pauseTx.error holds the failure reason
      }
    } finally {
      pauseSubmittingRef.current = false;
    }
  };

  const handleResume = async () => {
    try {
      await resume();
    } catch {
      // resumeTx.error holds the failure reason
    }
  };

  let derivedPauseStatus = "";
  if (pauseTx.state === "pending" || pauseUntilTx.state === "pending") {
    derivedPauseStatus = "Pausing…";
  } else if (pauseTx.state === "success") {
    derivedPauseStatus = "Paused successfully.";
  } else if (pauseUntilTx.state === "success") {
    derivedPauseStatus = scheduledResumeAt
      ? `Paused until ${formatDateTime(new Date(scheduledResumeAt * 1000))}.`
      : "Paused successfully.";
  } else if (pauseTx.state === "failed") {
    derivedPauseStatus = pauseTx.error || "Failed to pause";
  } else if (pauseUntilTx.state === "failed") {
    derivedPauseStatus = pauseUntilTx.error || "Failed to pause";
  } else if (resumeTx.state === "pending") {
    derivedPauseStatus = "Resuming…";
  } else if (resumeTx.state === "success") {
    derivedPauseStatus = "Resumed successfully.";
  } else if (resumeTx.state === "failed") {
    derivedPauseStatus = resumeTx.error || "Failed to resume";
  }

  const isInTrial = trialEndTimestamp !== null && trialEndTimestamp > Math.floor(Date.now() / 1000);

  const [subHealth, setSubHealth] = useState<SubscriptionHealth | null>(null);

  const handleHealthChange = (next: SubscriptionHealth | null) => {
    setSubHealth(next);
    onHealthChange?.(next);
  };

  const healthUnhealthy = subHealth != null && subscriptionHasWarnings(subHealth);
  const healthBlocksActions = subHealth != null && !isSubscriptionHealthy(subHealth);

  return (
    <div className={`card${isMobile ? " card--mobile" : ""}`}>
      <div className="subscription-card__header">
        <div>
          <h2 className="subscription-card__title">Your Subscription</h2>
          {subscription.label && <p className="subscription-card__label">{subscription.label}</p>}
        </div>
        <SubscriptionStatusBadge
          active={active}
          paused={paused}
          isInTrial={cardState.isInTrial}
        />
      </div>

      {active && cardState.trialEndTimestamp !== null && (
        <div className="trial-badge-row" data-testid="trial-badge-row">
          <TrialBadge trialEndTimestamp={cardState.trialEndTimestamp} />
        </div>
      )}

      {active && (
        <div className="allowance-health-row">
          <span className="text-sm text-muted">Allowance:</span>
          <AllowanceHealthBadge
            health={cardState.allowanceHealth}
            loading={cardState.allowanceLoading}
            onClick={() => setShowAllowanceModal(true)}
          />
        </div>
      )}

      <div className={`subscription-rows${isMobile ? " subscription-rows--mobile" : ""}`}>
        <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
          <span className="subscription-row__label">Merchant</span>
          <div className="merchant-row">
            <span className="merchant-row__address">
              {`${merchant.slice(0, 8)}…${merchant.slice(-6)}`}
            </span>
            <CopyButton text={merchant} ariaLabel="Copy merchant address" />
          </div>
        </div>
        <StackedRow
          label="Amount"
          value={displayCurrentAmount(amount)}
          isMobile={isMobile}
        />
        <StackedRow label="Interval" value={formatInterval(interval)} isMobile={isMobile} />
        <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
          <span className="subscription-row__label">
            {paused || cardState.scheduledResumeAt
              ? "Status"
              : cardState.isInTrial
                ? "First charge"
                : "Next charge"}
          </span>
          <span className="subscription-row__value">
            {active ? (
              paused || cardState.scheduledResumeAt ? (
                cardState.scheduledResumeAt ? (
                  <span data-testid="scheduled-resume">
                    Auto-resumes{" "}
                    <span data-testid="auto-resume-date">
                      {new Date(cardState.scheduledResumeAt * 1000).toLocaleString()}
                    </span>
                  </span>
                ) : (
                  <span className="badge badge-warning" aria-label="Subscription is paused">
                    Paused
                  </span>
                )
              ) : (
                <NextChargeCountdown nextChargeTimestamp={last_charged + interval} />
              )
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {active && cardState.healthUnhealthy && (
        <p
          className="text-sm"
          data-testid="health-action-warning"
          role="status"
          style={{ color: "var(--color-danger-text)", marginBottom: "var(--space-3)" }}
        >
          {cardState.healthBlocksActions
            ? "Subscription is unhealthy. Pause and cancel remain available; pay and charge may fail."
            : "Subscription needs attention before the next charge."}
        </p>
      )}

      <SubscriptionActions
        active={active}
        paused={paused}
        healthUnhealthy={cardState.healthUnhealthy}
        pausePending={cardState.pauseTx.state === "pending"}
        pauseUntilPending={cardState.pauseUntilTx.state === "pending"}
        resumePending={cardState.resumeTx.state === "pending"}
        cancelLoading={cardState.cancelLoading}
        onPause={cardState.handlePause}
        onResume={cardState.handleResume}
        onCancel={cardState.handleCancel}
        onTransfer={() => setShowTransferModal(true)}
      />

      <SubscriptionCardModals
        userKey={userKey}
        amount={BigInt(amount)}
        onSign={onSign}
        showAllowanceModal={showAllowanceModal}
        showTransferModal={showTransferModal}
        onCloseAllowance={() => setShowAllowanceModal(false)}
        onAllowanceSuccess={() => {
          setShowAllowanceModal(false);
          cardState.refreshAllowance();
        }}
        onCloseTransfer={() => setShowTransferModal(false)}
        onTransferSuccess={() => {
          setShowTransferModal(false);
          addToast("Subscription transferred successfully.", "success");
          onRefresh();
        }}
      />

      {active && (
        <SubscriptionHealthWidget
          userKey={userKey}
          showSimulateCharge={showSimulateCharge}
          onHealthChange={cardState.handleHealthChange}
          onSimulateResult={onSimulateResult}
        />
      )}

      <SubscriptionCardStatus
        status={status}
        isError={pauseFailed || cardState.cancelError !== null}
        error={pauseFailed ? cardState.pauseError : cardState.cancelError}
        health={cardState.subHealth}
        onIncreaseAllowance={() => setShowAllowanceModal(true)}
      />
    </div>
  );
}
