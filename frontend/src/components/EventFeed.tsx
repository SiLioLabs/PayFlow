/**
 * EventFeed — real-time contract event stream.
 *
 * Uses the useContractEvents hook to poll for on-chain events and displays
 * them as a live, scrollable feed. Supports multiple event types, polling
 * refresh, and manual "Load more" pagination.
 *
 * Intended for embedding in the subscriber Dashboard and MerchantDashboard.
 */
import React, { useCallback } from "react";
import { useContractEvents } from "../hooks/useContractEvents";
import type { ContractEvent } from "../stellar";
import { explorerTxUrl } from "../stellar";

// Human-readable labels for known event names.
const EVENT_LABELS: Record<string, string> = {
  subscribed: "Subscribed",
  charged: "Charged",
  cancelled: "Cancelled",
  paused: "Paused",
  resumed: "Resumed",
  upgrade: "Upgraded",
  upgrade_proposed: "Upgrade Proposed",
  admin_transferred: "Admin Transferred",
  pay_per_use: "Pay-per-use",
  daily_limit_set: "Daily Limit Set",
  daily_limit_removed: "Daily Limit Removed",
  merchant_withdrawal: "Merchant Withdrawal",
  fee_set: "Fee Set",
  fee_cleared: "Fee Cleared",
  batch_charge_complete: "Batch Charge Complete",
};

// Badge colours keyed by event name.
function eventBadgeClass(eventName: string): string {
  switch (eventName) {
    case "subscribed":
    case "resumed":
      return "badge-active";
    case "cancelled":
    case "paused":
      return "badge-inactive";
    case "charged":
    case "pay_per_use":
    case "merchant_withdrawal":
      return "badge-charged";
    case "upgrade":
    case "upgrade_proposed":
    case "admin_transferred":
      return "badge-warning";
    default:
      return "badge-skipped";
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortHash(hash: string): string {
  if (!hash || hash.length < 10) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

interface EventRowProps {
  event: ContractEvent;
}

function EventRow({ event }: EventRowProps) {
  const label = EVENT_LABELS[event.eventName] ?? event.eventName;
  const badgeClass = eventBadgeClass(event.eventName);
  const txUrl = event.txHash ? explorerTxUrl(event.txHash) : null;

  return (
    <div className="event-feed__row" role="listitem">
      <div className="event-feed__row-header">
        <span className={`badge ${badgeClass}`}>{label}</span>
        <span className="event-feed__timestamp text-xs text-muted">
          {formatTimestamp(event.timestamp)}
        </span>
      </div>
      <div className="event-feed__row-meta">
        {event.address && (
          <span className="event-feed__address text-mono text-xs text-muted">
            {event.address.length > 20
              ? `${event.address.slice(0, 8)}…${event.address.slice(-6)}`
              : event.address}
          </span>
        )}
        {txUrl && (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="event-feed__tx-link text-xs"
            title={event.txHash}
          >
            {shortHash(event.txHash)}↗
          </a>
        )}
        <span className="event-feed__ledger text-xs text-subtle">Ledger {event.ledger}</span>
      </div>
    </div>
  );
}

interface EventFeedProps {
  /** Filter events to this address (user or merchant pubkey). */
  address?: string;
  /** Maximum number of events to show at once. Defaults to 50. */
  maxEvents?: number;
  /** If provided, only show events matching this name. */
  eventName?: string;
  /** Optional heading override. */
  title?: string;
}

export default function EventFeed({
  address,
  maxEvents = 50,
  eventName = "charged",
  title = "Live Event Feed",
}: EventFeedProps) {
  const { events, loading, error, refresh, loadMore, hasMore } = useContractEvents(
    eventName,
    address,
    maxEvents
  );

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="event-feed card">
      <div className="event-feed__header">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-xs text-muted">
            Polling live — {events.length} event{events.length !== 1 ? "s" : ""} loaded
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={handleRefresh}
          disabled={loading}
          aria-label="Refresh events"
          type="button"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p
          className="event-feed__error text-sm"
          style={{ color: "var(--color-danger)" }}
          role="alert"
        >
          {error}
        </p>
      )}

      {!loading && events.length === 0 && !error && (
        <p className="text-muted text-sm event-feed__empty">
          No events found yet. Activity will appear here as it happens on-chain.
        </p>
      )}

      {events.length > 0 && (
        <div className="event-feed__list" role="list" aria-label="Contract events">
          {events.map((event, i) => (
            <EventRow
              key={`${event.txHash || event.ledger}-${event.eventName}-${i}`}
              event={event}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="event-feed__load-more">
          <button
            className="btn-secondary w-full"
            onClick={loadMore}
            disabled={loading}
            type="button"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
