/**
 * SubscriptionCard — displays an active subscription with allowance health indicator
 * and trial period badge (Issue #666).
 *
 * Allowance health tiers (Issue #659):
 *  - allowance === 0          → red   "No allowance — charges will fail"
 *  - allowance < amount       → amber "Allowance too low"
 *  - allowance >= amount * 3  → green "Healthy"
 *  - query failed             → neutral "Unknown"
 *
 * Trial badge (Issue #666):
 *  - get_trial_end returns Some(ts) and ts > now → amber "Trial ends in X days"
 *  - get_trial_end returns None or ts <= now     → no badge, normal next-charge display
 *  - RPC error fetching trial end                → no badge, don't crash
 *
 * Clicking an amber/red/unknown allowance badge opens IncreaseAllowanceModal.
 */
import React, { useEffect, useState } from "react";
import CopyButton from "./CopyButton";
import NextChargeCountdown from "./NextChargeCountdown";
import IncreaseAllowanceModal from "./IncreaseAllowanceModal";
import ErrorRecovery from "./ErrorRecovery";
import SubscriptionHealthWidget from "./SubscriptionHealthWidget";
import { Subscription } from "../types";
import { BILLING_INTERVALS } from "../constants";
import {
  ChargeSimResult,
  getAllowance,
  getTrialEnd,
  buildCancelTx,
  isSubscriptionHealthy,
  subscriptionHasWarnings,
  SubscriptionHealth,
} from "../stellar";
import { useSubscriptionSync } from "../hooks/useSubscriptionSync";
import { usePauseResume } from "../hooks/usePauseResume";
import { useRegisterShortcuts } from "../context/ShortcutRegistry";
import { useResponsive } from "../hooks/useResponsive";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { useToast } from "../hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AllowanceHealth = "healthy" | "low" | "none" | "unknown";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatInterval(secs: number): string {
  const monthly = BILLING_INTERVALS[2].value;
  const weekly = BILLING_INTERVALS[1].value;
  const daily = BILLING_INTERVALS[0].value;
  if (secs >= monthly) return `${Math.round(secs / monthly)}mo`;
  if (secs >= weekly) return `${Math.round(secs / weekly)}w`;
  if (secs >= daily) return `${Math.round(secs / daily)}d`;
  return `${secs}s`;
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

  const exactDate = new Date(trialEndTimestamp * 1000).toLocaleString();

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
  const { mutate } = useSubscriptionSync(userKey);
  const { isMobile } = useResponsive();
  const { displayCurrentAmount } = useAmountDisplay();
  const { addToast } = useToast();
  const nextChargeTimestamp = last_charged + interval;
  const formattedAmount = displayCurrentAmount(amount);

  // ── Cancel state ───────────────────────────────────────────────────────────
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelStatus, setCancelStatus] = useState("");

  // ── Pause / resume via hook ────────────────────────────────────────────────
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const { pause, resume, pauseTx, resumeTx } = usePauseResume(userKey, onSign, onRefresh);

  // ── Allowance health state ─────────────────────────────────────────────────
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowanceLoading, setAllowanceLoading] = useState(true);
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);

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
            action: () => setShowCancelConfirm(true),
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

  const handleCancel = async () => {
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
      setShowCancelConfirm(false);
      onCancelled?.();
    } catch (e: unknown) {
      const msg = `Error: ${e instanceof Error ? e.message : String(e)}`;
      setCancelStatus(msg);
      addToast(msg, "error");
    } finally {
      setCancelLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      await pause();
      setShowPauseConfirm(false);
    } catch {
      // pauseTx.error holds the failure reason
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
  if (pauseTx.state === "pending") {
    derivedPauseStatus = "Pausing…";
  } else if (pauseTx.state === "success") {
    derivedPauseStatus = "Paused successfully.";
  } else if (pauseTx.state === "failed") {
    derivedPauseStatus = `Error: ${pauseTx.error || "Failed to pause"}`;
  } else if (resumeTx.state === "pending") {
    derivedPauseStatus = "Resuming…";
  } else if (resumeTx.state === "success") {
    derivedPauseStatus = "Resumed successfully.";
  } else if (resumeTx.state === "failed") {
    derivedPauseStatus = `Error: ${resumeTx.error || "Failed to resume"}`;
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
        <span className={`badge ${active ? "badge-active" : "badge-inactive"}`}>
          {active ? (isInTrial ? "Trial Active" : "Active") : "Cancelled"}
        </span>
      </div>

      {/* Trial period badge (Issue #666) — shown when trial is active */}
      {active && trialEndTimestamp !== null && (
        <div className="trial-badge-row" data-testid="trial-badge-row">
          <TrialBadge trialEndTimestamp={trialEndTimestamp} />
        </div>
      )}

      {/* Allowance health indicator — only shown for active subscriptions */}
      {active && (
        <div className="allowance-health-row">
          <span className="text-sm text-muted">Allowance:</span>
          <AllowanceHealthBadge
            health={health}
            loading={allowanceLoading}
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
        <StackedRow label="Amount" value={formattedAmount} isMobile={isMobile} />
        <StackedRow label="Interval" value={formatInterval(interval)} isMobile={isMobile} />
        <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
          <span className="subscription-row__label">
            {isInTrial ? "First charge" : "Next charge"}
          </span>
          <span className="subscription-row__value">
            {active && !paused ? (
              <NextChargeCountdown nextChargeTimestamp={nextChargeTimestamp} />
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {active && healthUnhealthy && (
        <p
          className="text-sm"
          data-testid="health-action-warning"
          role="status"
          style={{ color: "var(--color-danger-text)", marginBottom: "var(--space-3)" }}
        >
          {healthBlocksActions
            ? "Subscription is unhealthy. Pause and cancel remain available; pay and charge may fail."
            : "Subscription needs attention before the next charge."}
        </p>
      )}

      <div className="subscription-card__actions">
        {active && !paused && (
          <>
            <button
              onClick={() => setShowPauseConfirm(true)}
              className="btn-secondary pause-btn"
              title={healthUnhealthy ? "Subscription needs attention" : undefined}
            >
              Pause
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="btn-danger cancel-btn"
              aria-label="Cancel subscription"
              title={healthUnhealthy ? "Subscription needs attention" : undefined}
            >
              Cancel
            </button>
          </>
        )}
        {active && paused && (
          <>
            <button
              onClick={handleResume}
              disabled={resumeTx.state === "pending"}
              className="btn-primary resume-btn"
            >
              {resumeTx.state === "pending" ? "Resuming…" : "Resume"}
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="btn-danger cancel-btn"
              aria-label="Cancel subscription"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Pause confirm modal */}
      {showPauseConfirm && (
        <div className="modal-overlay" onClick={() => setShowPauseConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Pause subscription?</h3>
            <p>You won&apos;t be charged while paused. You can resume anytime.</p>
            <div className="modal-actions">
              <button onClick={() => setShowPauseConfirm(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handlePause}
                disabled={pauseTx.state === "pending"}
                className="btn-primary"
              >
                {pauseTx.state === "pending" ? "Pausing…" : "Pause"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm modal */}
      {showCancelConfirm && (
        <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Cancel subscription?</h3>
            <p>Are you sure you want to cancel your subscription? This cannot be undone.</p>
            <div className="modal-actions">
              <button onClick={() => setShowCancelConfirm(false)} className="btn-secondary">
                Back
              </button>
              <button onClick={handleCancel} disabled={cancelLoading} className="btn-danger">
                {cancelLoading ? "Cancelling…" : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Increase allowance modal — opened by clicking a warning badge */}
      {showAllowanceModal && (
        <IncreaseAllowanceModal
          userKey={userKey}
          subscriptionAmount={amountBigInt}
          onSign={onSign}
          onClose={() => setShowAllowanceModal(false)}
          onSuccess={() => {
            setShowAllowanceModal(false);
            // Re-fetch allowance after successful approval
            setAllowanceLoading(true);
            getAllowance(userKey)
              .then(setAllowance)
              .catch(() => setAllowance(null))
              .finally(() => setAllowanceLoading(false));
          }}
          announce={() => {}}
        />
      )}

      {/* Subscription Health Widget — only for active subscriptions */}
      {active && (
        <SubscriptionHealthWidget
          userKey={userKey}
          showSimulateCharge={showSimulateCharge}
          onHealthChange={handleHealthChange}
          onSimulateResult={onSimulateResult}
        />
      )}

      {(derivedPauseStatus || cancelStatus) && (
        <p
          className="form-status"
          style={{
            color:
              derivedPauseStatus.startsWith("Error") || cancelStatus.startsWith("Error")
                ? "var(--color-danger)"
                : "var(--color-success)",
          }}
        >
          {derivedPauseStatus || cancelStatus}
        </p>
      )}

      {(derivedPauseStatus.startsWith("Error") || cancelStatus.startsWith("Error")) && (
        <ErrorRecovery
          error={
            derivedPauseStatus.startsWith("Error") ? pauseTx.error || resumeTx.error : cancelStatus
          }
          health={subHealth}
          onIncreaseAllowance={
            subHealth && !subHealth.has_sufficient_allowance
              ? () => setShowAllowanceModal(true)
              : undefined
          }
        />
      )}
    </div>
  );
}
