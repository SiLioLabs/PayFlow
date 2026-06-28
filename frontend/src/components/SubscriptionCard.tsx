import React from "react";
import CopyButton from "./CopyButton";
import NextChargeCountdown from "./NextChargeCountdown";
import { Subscription } from "../types";
import { BILLING_INTERVALS, STROOPS_PER_XLM } from "../constants";

import { useSubscriptionSync } from "../hooks/useSubscriptionSync";

interface SubscriptionCardProps {
  subscription: Subscription;
  onSign: (xdr: string) => Promise<string>;
  onRefresh: () => void;
  onCancelled?: () => void;
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

export default function SubscriptionCard({
  subscription,
  userKey,
  onSign,
  onRefresh,
  onCancelled,
}: SubscriptionCardProps & { userKey: string }) {
  const { mutate } = useSubscriptionSync(userKey);
  const { merchant, amount, interval, last_charged, active, paused, trial_duration } = subscription;
  const nextChargeTimestamp = last_charged + interval;
  const xlm = (Number(amount) / STROOPS_PER_XLM).toFixed(2);
  const { isInTrial } = formatTrialStatus(trial_duration || 0, last_charged);

  const [showPauseConfirm, setShowPauseConfirm] = React.useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = React.useState(false);
  const [cancelLoading, setCancelLoading] = React.useState(false);
  const [pauseLoading, setPauseLoading] = React.useState(false);
  const [resumeLoading, setResumeLoading] = React.useState(false);
  const [pauseStatus, setPauseStatus] = React.useState("");
  const [cancelStatus, setCancelStatus] = React.useState("");

  const handleCancel = async () => {
    setCancelLoading(true);
    setCancelStatus("");
    try {
      await mutate('cancel', async () => {
        const { buildCancelTx } = await import("../stellar");
        const xdr = await buildCancelTx(userKey);
        return onSign(xdr);
      }, { active: false });
      setCancelStatus("Cancelled successfully.");
      setShowCancelConfirm(false);
      onCancelled?.();
    } catch (e: any) {
      setCancelStatus(`Error: ${e.message}`);
    } finally {
      setCancelLoading(false);
    }
  };

  const handlePause = async () => {
    setPauseLoading(true);
    setPauseStatus("");
    try {
      await mutate('pause', async () => {
        const { buildPauseTx } = await import("../stellar");
        const xdr = await buildPauseTx(userKey);
        return onSign(xdr);
      }, { paused: true });
      
      setPauseStatus("Paused successfully.");
      setShowPauseConfirm(false);
    } catch (e: any) {
      setPauseStatus(`Error: ${e.message}`);
    } finally {
      setPauseLoading(false);
    }
  };

  const handleResume = async () => {
    setResumeLoading(true);
    setPauseStatus("");
    try {
      await mutate('resume', async () => {
        const { buildResumeTx } = await import("../stellar");
        const xdr = await buildResumeTx(userKey);
        return onSign(xdr);
      }, { paused: false });
      
      setPauseStatus("Resumed successfully.");
    } catch (e: any) {
      setPauseStatus(`Error: ${e.message}`);
    } finally {
      setResumeLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="subscription-card__header">
        <div>
          <h2 className="subscription-card__title">Your Subscription</h2>
          {subscription.label && (
            <p className="subscription-card__label">{subscription.label}</p>
          )}
        </div>
        <span className={`badge ${active ? "badge-active" : "badge-inactive"}`}>
          {active ? (isInTrial ? "Trial Active" : "Active") : "Cancelled"}
        </span>
      </div>

      <div className="subscription-rows">
        <div className="subscription-row">
          <span className="subscription-row__label">Merchant</span>
          <div className="merchant-row">
            <span className="merchant-row__address">
              {`${merchant.slice(0, 8)}…${merchant.slice(-6)}`}
            </span>
            <CopyButton text={merchant} ariaLabel="Copy merchant address" />
          </div>
        </div>
        <Row label="Amount" value={`${xlm} XLM`} />
        <Row label="Interval" value={formatInterval(interval)} />
        <div className="subscription-row">
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
            <button onClick={() => setShowPauseConfirm(true)} className="btn-secondary pause-btn">
              Pause
            </button>
            <button onClick={() => setShowCancelConfirm(true)} className="btn-danger cancel-btn" aria-label="Cancel subscription">
              Cancel
            </button>
          </>
        )}
        {active && paused && (
          <>
            <button onClick={handleResume} disabled={resumeLoading} className="btn-primary resume-btn">
              {resumeLoading ? "Resuming…" : "Resume"}
            </button>
            <button onClick={() => setShowCancelConfirm(true)} className="btn-danger cancel-btn" aria-label="Cancel subscription">
              Cancel
            </button>
          </>
        )}
      </div>

      {showPauseConfirm && (
        <div className="modal-overlay" onClick={() => setShowPauseConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Pause subscription?</h3>
            <p>You won't be charged while paused. You can resume anytime.</p>
            <div className="modal-actions">
              <button onClick={() => setShowPauseConfirm(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handlePause} disabled={pauseLoading} className="btn-primary">
                {pauseLoading ? "Pausing…" : "Pause"}
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

      {(pauseStatus || cancelStatus) && (
        <p
          className="form-status"
          style={{
            color: (pauseStatus.startsWith("Error") || cancelStatus.startsWith("Error")) ? "var(--color-danger)" : "var(--color-success)",
          }}
        >
          {pauseStatus || cancelStatus}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="subscription-row">
      <span className="subscription-row__label">{label}</span>
      <span className="subscription-row__value">{value}</span>
    </div>
  );
}
