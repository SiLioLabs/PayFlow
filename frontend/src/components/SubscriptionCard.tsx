/**
 * SubscriptionCard — displays an active subscription with allowance health indicator.
 *
 * Allowance health tiers (Issue #659):
 *  - allowance === 0          → red   "No allowance — charges will fail"
 *  - allowance < amount       → amber "Allowance too low"
 *  - allowance >= amount * 3  → green "Healthy"
 *  - query failed             → neutral "Unknown"
 *
 * Clicking an amber/red/unknown badge opens IncreaseAllowanceModal.
 */
import React, { useEffect, useState } from "react";
import CopyButton from "./CopyButton";
import NextChargeCountdown from "./NextChargeCountdown";
import IncreaseAllowanceModal from "./IncreaseAllowanceModal";
import ErrorRecovery from "./ErrorRecovery";
import SubscriptionHealthWidget from "./SubscriptionHealthWidget";
import { Subscription } from "../types";
import { BILLING_INTERVALS, STROOPS_PER_XLM } from "../constants";
import { getAllowance, buildCancelTx } from "../stellar";
import { useSubscriptionSync } from "../hooks/useSubscriptionSync";
import { usePauseResume } from "../hooks/usePauseResume";
import { useRegisterShortcuts } from "../context/ShortcutRegistry";
import { useResponsive } from "../hooks/useResponsive";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AllowanceHealth = "healthy" | "low" | "none" | "unknown";

interface SubscriptionCardProps {
  subscription: Subscription;
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onRefresh: () => void;
  onCancelled?: () => void;
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

function formatTrialStatus(
  trial_duration: number,
  last_charged: number
): { isInTrial: boolean; trialEndDate: string; trialDaysRemaining: number } {
  if (trial_duration === 0) {
    return { isInTrial: false, trialEndDate: "", trialDaysRemaining: 0 };
  }
  const trialEndTimestamp = last_charged + trial_duration;
  const now = Math.floor(Date.now() / 1000);
  const isInTrial = now < trialEndTimestamp;
  const trialEndDate = new Date(trialEndTimestamp * 1000).toLocaleDateString();
  const trialDaysRemaining = Math.max(
    0,
    Math.ceil((trialEndTimestamp - now) / (24 * 60 * 60))
  );

  return { isInTrial, trialEndDate, trialDaysRemaining };
}

/**
 * Compute the allowance health tier given the raw allowance and subscription
 * amount (both in stroops).
 */
export function computeAllowanceHealth(
  allowance: bigint | null,
  amount: bigint
): AllowanceHealth {
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
      {health === "none" ? "⚠ No allowance — charges will fail" : health === "low" ? "⚠ Allowance too low" : "? Allowance unknown"}
    </button>
  );
}

// ── SubscriptionCard ──────────────────────────────────────────────────────────

export default function SubscriptionCard({
  subscription,
  userKey,
  onSign,
  onRefresh,
  onCancelled,
}: SubscriptionCardProps) {
  const { merchant, amount, interval, last_charged, active, paused, trial_duration } = subscription;
  const { mutate } = useSubscriptionSync(userKey);
  const { isMobile } = useResponsive();
  const nextChargeTimestamp = last_charged + interval;
  const xlm = (Number(amount) / STROOPS_PER_XLM).toFixed(2);
  const { isInTrial } = formatTrialStatus(trial_duration || 0, last_charged);

  // ── Cancel state ───────────────────────────────────────────────────────────
  const [showCancelConfirm, setShowCancelConfirm] = React.useState(false);
  const [cancelLoading, setCancelLoading] = React.useState(false);
  const [cancelStatus, setCancelStatus] = React.useState("");

  // ── Pause / resume via hook ────────────────────────────────────────────────
  const [showPauseConfirm, setShowPauseConfirm] = React.useState(false);
  const { pause, resume, pauseTx, resumeTx } = usePauseResume(userKey, onSign, onRefresh);

  useRegisterShortcuts(
    active
      ? [
          {
            key: "x",
            description: "Cancel active subscription",
            action: () => {
              setShowCancelConfirm(true);
            },
          },
        ]
      : []
  );

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
      setCancelStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
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

  // ── Allowance health state ─────────────────────────────────────────────────
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowanceLoading, setAllowanceLoading] = useState(true);
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);

  const amountBigInt = BigInt(amount);
  const health = computeAllowanceHealth(allowance, amountBigInt);

  useEffect(() => {
    if (!active) return; // no point checking allowance on cancelled subs
    setAllowanceLoading(true);
    getAllowance(userKey)
      .then((val) => setAllowance(val))
      .catch(() => setAllowance(null)) // RPC error → "unknown" state
      .finally(() => setAllowanceLoading(false));
  }, [userKey, active]);

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
        <StackedRow label="Amount" value={`${xlm} XLM`} isMobile={isMobile} />
        <StackedRow label="Interval" value={formatInterval(interval)} isMobile={isMobile} />
        <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
          <span className="subscription-row__label">Next charge</span>
          <span className="subscription-row__value">
            {active && !paused ? (
              <NextChargeCountdown nextChargeTimestamp={nextChargeTimestamp} />
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      <div className="subscription-card__actions">
        {active && !paused && (
          <>
            <button
              onClick={() => setShowPauseConfirm(true)}
              className="btn-secondary pause-btn"
            >
              Pause
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
        <div
          className="modal-overlay"
          onClick={() => setShowPauseConfirm(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Pause subscription?</h3>
            <p>You won't be charged while paused. You can resume anytime.</p>
            <div className="modal-actions">
              <button
                onClick={() => setShowPauseConfirm(false)}
                className="btn-secondary"
              >
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

      {/* Subscription Health Widget */}
      <SubscriptionHealthWidget userKey={userKey} />

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
        <ErrorRecovery error={derivedPauseStatus.startsWith("Error") ? pauseTx.error || resumeTx.error : cancelStatus} />
      )}
    </div>
  );
}

function StackedRow({ label, value, isMobile }: { label: string; value: string; isMobile: boolean }) {
  return (
    <div className={`subscription-row${isMobile ? " subscription-row--stacked" : ""}`}>
      <span className="subscription-row__label">{label}</span>
      <span className="subscription-row__value">{value}</span>
    </div>
  );
}
