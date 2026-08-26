/**
 * TxQueuePanel — collapsible fixed-position panel showing the last 10 transactions.
 *
 * Subscribes to the txQueue singleton service and re-renders on every state
 * change.  Auto-opens when a new transaction is enqueued.
 *
 * Issue #658
 */
import React, { useEffect, useState, useCallback } from "react";
import { addListener, setPanelOpen, type TxEntry } from "../services/txQueue";
import { explorerTxUrl } from "../stellar";
import CopyButton from "./CopyButton";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TxEntry["status"], string> = {
  pending: "Pending",
  submitted: "Submitted",
  confirmed: "Confirmed",
  failed: "Failed",
};

const STATUS_CLASS: Record<TxEntry["status"], string> = {
  pending: "tx-status--pending",
  submitted: "tx-status--submitted",
  confirmed: "tx-status--confirmed",
  failed: "tx-status--failed",
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TxEntryRowProps {
  entry: TxEntry;
}

function TxEntryRow({ entry }: TxEntryRowProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    if (!entry.retry) return;
    setRetrying(true);
    try {
      await entry.retry();
    } finally {
      setRetrying(false);
    }
  }, [entry.retry]);

  return (
    <li className="tx-queue-entry" aria-label={`Transaction: ${entry.operation}`}>
      <div className="tx-queue-entry__header">
        <span className="tx-queue-entry__operation">{entry.operation}</span>
        <span
          className={`tx-queue-entry__status ${STATUS_CLASS[entry.status]}`}
          aria-label={`Status: ${STATUS_LABEL[entry.status]}`}
        >
          {STATUS_LABEL[entry.status]}
        </span>
      </div>

      <div className="tx-queue-entry__meta">
        <time className="tx-queue-entry__time text-muted text-sm" dateTime={entry.timestamp}>
          {formatTimestamp(entry.timestamp)}
        </time>

        {entry.hash && (
          <span className="tx-queue-entry__hash-row">
            <a
              href={explorerTxUrl(entry.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="tx-queue-entry__explorer-link text-sm"
              aria-label={`View transaction ${entry.hash} on Stellar.Expert`}
            >
              {truncateHash(entry.hash)}
            </a>
            <CopyButton text={entry.hash} ariaLabel={`Copy transaction hash ${entry.hash}`} />
          </span>
        )}
      </div>

      {entry.status === "failed" && (
        <div className="tx-queue-entry__error" role="alert">
          <span className="text-sm text-error">{entry.error ?? "Unknown error"}</span>
          {entry.retry && (
            <button
              className="btn-secondary tx-queue-entry__retry"
              onClick={handleRetry}
              disabled={retrying}
              aria-label={`Retry ${entry.operation}`}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TxQueuePanel() {
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Subscribe to queue; returns unsubscribe fn
    const unsub = addListener((newEntries, newOpen) => {
      setEntries(newEntries);
      setOpen(newOpen);
    });
    return unsub;
  }, []);

  const handleToggle = useCallback(() => {
    setPanelOpen(!open);
  }, [open]);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
  }, []);

  // Don't render if there are no transactions yet
  if (entries.length === 0) return null;

  const pendingCount = entries.filter(
    (e) => e.status === "pending" || e.status === "submitted"
  ).length;

  return (
    <section
      className={`tx-queue-panel${open ? " tx-queue-panel--open" : ""}`}
      aria-label="Transaction queue"
      aria-expanded={open}
    >
      {/* Header / toggle bar */}
      <button
        className="tx-queue-panel__toggle"
        onClick={handleToggle}
        aria-controls="tx-queue-list"
        aria-expanded={open}
        aria-label={open ? "Collapse transaction queue" : "Expand transaction queue"}
      >
        <span className="tx-queue-panel__title">
          Transactions
          {pendingCount > 0 && (
            <span className="tx-queue-panel__badge" aria-label={`${pendingCount} in progress`}>
              {pendingCount}
            </span>
          )}
        </span>
        <span className="tx-queue-panel__chevron" aria-hidden="true">
          {open ? "▾" : "▴"}
        </span>
      </button>

      {/* Entry list */}
      {open && (
        <div className="tx-queue-panel__body">
          <div className="tx-queue-panel__actions">
            <button
              className="btn-secondary tx-queue-panel__close"
              onClick={handleClose}
              aria-label="Close transaction queue panel"
            >
              Close
            </button>
          </div>
          <ul id="tx-queue-list" className="tx-queue-list" aria-label="Recent transactions">
            {entries.map((entry) => (
              <TxEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
