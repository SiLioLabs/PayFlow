import React, { useEffect, useState, useRef } from "react";
import { buildSetDailyLimitTx, getDailyLimit } from "../stellar";
import { formatXlm } from "../utils/format";
import { useToast } from "../hooks/useToast";
import ToastContainer from "./Toast";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onClose: () => void;
  onSuccess: () => void;
  announce: (message: string) => void;
}

export default function DailyLimitModal({ userKey, onSign, onClose, onSuccess, announce }: Props) {
  const [currentLimit, setCurrentLimit] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("0.0000000");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, true, onClose);

  useEffect(() => {
    async function loadLimit() {
      try {
        const limit = await getDailyLimit(userKey);
        setCurrentLimit(limit);
        if (limit !== null) {
          setAmount((Number(limit) / 10_000_000).toFixed(7));
        }
      } catch {
        setCurrentLimit(null);
      }
    }

    loadLimit();
  }, [userKey]);

  async function handleSubmit() {
    setError(null);
    if (!amount) {
      setError("Please enter a daily spending limit.");
      return;
    }

    const parsed = parseFloat(amount);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid positive XLM amount.");
      return;
    }

    setSubmitting(true);
    announce("Submitting daily limit transaction");

    try {
      const stroops = BigInt(Math.round(parsed * 10_000_000));
      const xdr = await buildSetDailyLimitTx(userKey, stroops);
      const hash = await onSign(xdr);
      addToast(`Daily limit updated! tx: ${hash.slice(0, 12)}…`, "success");
      announce("Daily spending limit updated");
      onSuccess();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to set daily limit.";
      setError(message);
      addToast(`Error: ${message}`, "error");
      announce(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-limit-title"
      >
        <h3 id="daily-limit-title">Daily Spending Limit</h3>
        <p>
          Set a daily cap for pay-per-use charges. This limit helps you control how much you can
          spend in a single day.
        </p>
        {currentLimit !== null && (
          <p>
            Current limit: <strong>{formatXlm(currentLimit)}</strong>
          </p>
        )}
        <label className="form-group">
          <span className="form-label">Daily limit (XLM)</span>
          <input
            type="number"
            min="0.0000001"
            step="0.0000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting}
          />
        </label>
        {error && <p className="text-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : "Save limit"}
          </button>
        </div>

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </div>
  );
}
