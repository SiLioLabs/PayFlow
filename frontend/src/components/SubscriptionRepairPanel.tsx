/**
 * SubscriptionRepairPanel
 *
 * User-facing panel shown when a subscription's on-chain persistent storage
 * entry has been archived by Stellar's state-expiry (TTL) mechanism.
 *
 * Responsibilities:
 *  - Detect the archived state from a subscription query error or an explicit
 *    `isArchived` prop set by the parent after catching an RPC error.
 *  - Explain what happened in plain language.
 *  - Show the estimated XLM cost of restoring the entry.
 *  - Provide a "Restore Subscription" button that calls `extend_subscription_ttl`.
 *  - Handle edge cases: non-owner viewing the panel, contract itself archived,
 *    and restore transaction failures.
 */

import React, { useCallback, useEffect, useState } from "react";
import { buildExtendSubscriptionTtlTx, estimateExtendTtlFee, isArchivedError } from "../stellar";
import { useTransaction } from "../hooks/useTransaction";
import { useToast } from "../hooks/useToast";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM } from "../constants";
import Spinner from "./Spinner";
import ConfirmModal from "./ConfirmModal";
import ToastContainer from "./Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionRepairPanelProps {
  /** Public key of the currently connected wallet. */
  userKey: string;
  /**
   * Address of the subscriber whose entry needs to be restored.
   * Defaults to `userKey` when omitted (self-repair).
   */
  subscriberAddress?: string;
  /**
   * When true the parent already knows the subscription is archived.
   * When false/undefined the panel will check `subscriptionError` instead.
   */
  isArchived?: boolean;
  /**
   * The raw error caught by the parent when loading the subscription.
   * The panel will inspect this to decide whether to render.
   */
  subscriptionError?: string | null;
  /** Called after a successful restore so the parent can refresh its data. */
  onRestored?: () => void;
  /** Freighter / wallet sign callback — same signature as the rest of the app. */
  onSign: (xdr: string) => Promise<string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Approximate minimum ledger extensions bundled into a restore tx. */
const FALLBACK_RESTORE_FEE_STROOPS = 500_000n; // ~0.05 XLM — conservative estimate

// ── Helpers ───────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: bigint): string {
  return (Number(stroops) / STROOPS_PER_XLM).toFixed(7).replace(/\.?0+$/, "");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SubscriptionRepairPanel({
  userKey,
  subscriberAddress,
  isArchived: isArchivedProp,
  subscriptionError,
  onRestored,
  onSign,
}: SubscriptionRepairPanelProps) {
  const target = subscriberAddress ?? userKey;
  const isOwner = userKey === target;

  // Determine whether the archived state is active
  const archivedFromError = subscriptionError != null ? isArchivedError(subscriptionError) : false;
  const archived = isArchivedProp ?? archivedFromError;

  const tx = useTransaction();
  const { toasts, addToast, removeToast } = useToast();

  const [estimatedFee, setEstimatedFee] = useState<bigint | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch fee estimate once we know we're in the archived state
  useEffect(() => {
    if (!archived || !userKey) return;

    let cancelled = false;

    async function fetchFee() {
      setFeeLoading(true);
      try {
        const fee = await estimateExtendTtlFee(userKey, target);
        if (!cancelled) setEstimatedFee(fee);
      } catch {
        // Non-critical — we fall back to the static estimate
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    }

    fetchFee();

    return () => {
      cancelled = true;
    };
  }, [archived, userKey, target]);

  const displayFee = estimatedFee ?? FALLBACK_RESTORE_FEE_STROOPS;

  const handleRestore = useCallback(async () => {
    setShowConfirm(false);

    try {
      await tx.submit(async () => {
        const xdr = await buildExtendSubscriptionTtlTx(userKey, target);
        return onSign(xdr);
      });
      addToast("Subscription restored successfully.", "success");
      onRestored?.();
    } catch (e: unknown) {
      const msg = friendlyError(e instanceof Error ? e.message : String(e));
      addToast(`Restore failed: ${msg}`, "error");
    }
  }, [tx, userKey, target, onSign, onRestored, addToast]);

  // Only render when there is an archived state to handle
  if (!archived) return null;

  const isPending = tx.status === "pending";
  const isSuccess = tx.status === "success";

  return (
    <section
      className="subscription-repair-panel"
      aria-labelledby="ttl-repair-heading"
      aria-live="polite"
    >
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* ── Header ── */}
      <div className="subscription-repair-panel__icon" aria-hidden="true">
        🗃️
      </div>

      <h3 id="ttl-repair-heading" className="subscription-repair-panel__title">
        Subscription Archived
      </h3>

      <p className="subscription-repair-panel__description">
        Your subscription data has been archived by the Stellar network. This happens when an
        on-chain storage entry is not accessed for an extended period — the data still exists but
        must be restored before it can be used again.
      </p>

      {/* ── Owner vs. observer ── */}
      {!isOwner && (
        <div className="network-warning" role="alert" aria-label="Ownership notice">
          <span aria-hidden="true">⚠️</span>
          <span>
            You are viewing a subscription that belongs to a different address. Only the
            subscription owner can initiate a restore.
          </span>
        </div>
      )}

      {/* ── Success state ── */}
      {isSuccess && (
        <div
          className="subscription-repair-panel__success"
          role="status"
          aria-label="Restore successful"
          style={{ background: "var(--color-success-bg)", color: "var(--color-success-text)" }}
        >
          <strong>✓ Subscription restored</strong>
          <p className="text-sm mb-0 mt-1">
            Your subscription data is active again. Refresh the page if the dashboard does not
            update automatically.
          </p>
          {tx.hash && (
            <p className="text-xs mt-1 text-muted">
              Transaction: <code className="text-xs">{tx.hash.slice(0, 12)}…</code>
            </p>
          )}
        </div>
      )}

      {/* ── Restore section ── */}
      {!isSuccess && (
        <div className="subscription-repair-panel__restore">
          {/* Fee estimate */}
          <div
            className="subscription-repair-panel__fee"
            aria-label={`Estimated restore cost: ${stroopsToXlm(displayFee)} XLM`}
          >
            <span className="subscription-repair-panel__fee-label">Estimated cost</span>
            {feeLoading ? (
              <span className="subscription-repair-panel__fee-value">
                <Spinner size="sm" />
                <span className="sr-only">Calculating fee…</span>
              </span>
            ) : (
              <span className="subscription-repair-panel__fee-value">
                ≈ {stroopsToXlm(displayFee)} XLM
                <span className="text-muted text-xs ml-1">(network fee)</span>
              </span>
            )}
          </div>

          {/* Transaction error */}
          {tx.error && (
            <div
              className="subscription-repair-panel__error"
              role="alert"
              aria-label="Restore error"
            >
              <span aria-hidden="true">✕</span>
              <span>{friendlyError(tx.error)}</span>
            </div>
          )}

          {/* Restore button */}
          <button
            type="button"
            className="btn-primary subscription-repair-panel__restore-btn"
            onClick={() => setShowConfirm(true)}
            disabled={!isOwner || isPending}
            aria-disabled={!isOwner || isPending}
            aria-label="Restore subscription"
            aria-busy={isPending}
          >
            {isPending ? (
              <span className="flex gap-2 items-center">
                <Spinner size="sm" />
                Restoring…
              </span>
            ) : (
              "Restore Subscription"
            )}
          </button>

          {!isOwner && (
            <p className="text-sm text-muted mt-2" role="note">
              Only the subscription owner can restore this entry.
            </p>
          )}
        </div>
      )}

      {/* ── Help text ── */}
      <details className="subscription-repair-panel__details mt-4">
        <summary className="text-sm font-medium cursor-pointer">Why does this happen?</summary>
        <div className="text-sm text-muted mt-2">
          <p>
            The Stellar network enforces a time-to-live (TTL) on persistent contract storage. If
            your subscription entry is not accessed for a long time, the network marks it as
            archived to reclaim ledger space.
          </p>
          <p className="mt-2">
            Restoring the entry pays a small network fee to extend its TTL. Your subscription
            settings (amount, merchant, interval) are preserved exactly as they were.
          </p>
          <p className="mt-2">
            If the contract itself is archived (not just your subscription), contact the service
            operator — that requires a separate restore step that only the contract admin can
            perform.
          </p>
        </div>
      </details>

      {/* ── Confirmation modal ── */}
      {showConfirm && (
        <ConfirmModal
          message={`Restore archived subscription for ${target.slice(0, 8)}…${target.slice(-6)}? This submits an on-chain transaction (≈ ${stroopsToXlm(displayFee)} XLM).`}
          onConfirm={handleRestore}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  );
}
