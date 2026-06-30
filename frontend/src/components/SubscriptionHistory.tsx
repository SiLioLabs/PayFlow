import React, { useMemo, useRef, useState } from "react";
import { useContractEvents } from "../hooks/useContractEvents";
import { ChargeEvent } from "../types";
import { STROOPS_PER_XLM } from "../constants";
import Spinner from "./Spinner";
import CopyButton from "./CopyButton";

interface Props {
  userKey: string;
}

/** Number of charge events shown per page. */
const PAGE_SIZE = 20;

function formatAmount(stroops: string): string {
  const xlm = Number(stroops) / STROOPS_PER_XLM;
  return `${xlm.toFixed(2)} XLM`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

// ─── CSV export helper ────────────────────────────────────────────────────────

/** Wrap a cell value in double-quotes and escape any internal quotes. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Build a CSV string from charge events and trigger a browser download.
 * Columns: Date, Amount (XLM), TX Hash, Merchant
 */
function exportToCsv(events: ChargeEvent[]): void {
  const header = ["Date", "Amount (XLM)", "TX Hash", "Merchant"].map(csvCell).join(",");

  const rows = events.map((event) => {
    const date = event.date.toISOString().slice(0, 10); // YYYY-MM-DD, locale-independent
    const xlm = (Number(event.amount) / STROOPS_PER_XLM).toFixed(7);
    return [date, xlm, event.txHash, event.merchant].map(csvCell).join(",");
  });

  const csv = [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `payflow-charge-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  // Clean up the object URL after the download is triggered
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SubscriptionHistory({ userKey }: Props) {
  const { events: contractEvents, loading, error, refresh, loadMore, hasMore } = useContractEvents("charged", userKey);

  // Cache of the last successfully fetched events for stale-while-revalidate.
  const cachedEventsRef = useRef<ChargeEvent[]>([]);

  // Client-side pagination state.
  const [page, setPage] = useState(1);

  // Memoize the sorted event array — re-sorts only when the raw array reference changes.
  const allEvents = useMemo<ChargeEvent[]>(() => {
    const transformed = contractEvents
      .map((event) => {
        let merchant = "";
        let amount = "0";
        let timestamp = 0;

        try {
          const val = event.data as any;
          if (val?._value?.merchant) merchant = val._value.merchant.toString();
          if (val?._value?.amount) amount = val._value.amount.toString();
          if (val?._value?.charged_at) timestamp = Number(val._value.charged_at);

          // Fallback to event timestamp if charged_at is not available
          if (timestamp === 0 && event.timestamp) {
            timestamp = Math.floor(new Date(event.timestamp).getTime() / 1000);
          }
        } catch (e) {
          console.warn("Charge event parsing failed:", e);
        }

        return {
          date: new Date(timestamp * 1000),
          amount,
          txHash: event.txHash,
          merchant,
        };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    // Update stale-while-revalidate cache when we have fresh data.
    if (transformed.length > 0) {
      cachedEventsRef.current = transformed;
    }

    return transformed;
  }, [contractEvents]);

  // During a background refresh, show stale data from the ref.
  const displayEvents = allEvents.length > 0 ? allEvents : cachedEventsRef.current;

  const totalPages = Math.max(1, Math.ceil(displayEvents.length / PAGE_SIZE));

  // Keep page in bounds when data changes (e.g. after a refresh).
  const safePage = Math.min(page, totalPages);

  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pageEvents = displayEvents.slice(pageStart, pageEnd);

  // Loading state: only show full skeleton when we have no data at all.
  const hasData = displayEvents.length > 0;

  if (!hasData && loading) {
    return (
      <div className="card" aria-busy="true" aria-label="Loading charge history">
        <h3 className="subscription-card__title">Charge History</h3>
        <div style={{ padding: "var(--space-4) 0", textAlign: "center" }}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (!hasData && error) {
    return (
      <div className="card" role="alert" aria-live="assertive">
        <h3 className="subscription-card__title">Charge History</h3>
        <div className="error-state" style={{ padding: "var(--space-4) 0" }}>
          <p style={{ color: "var(--color-danger)", marginBottom: "var(--space-3)" }}>
            Unable to load charge history.
          </p>
          <button onClick={refresh} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="card">
        <h3 className="subscription-card__title">Charge History</h3>
        <p className="no-sub-text" style={{ padding: "var(--space-4) 0" }}>
          No charges yet. Your subscription billing history will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Header row: title + export button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-2)",
        }}
      >
        <h3 className="subscription-card__title" style={{ margin: 0 }}>
          Charge History
        </h3>
        <button
          className="btn-secondary"
          onClick={() => exportToCsv(displayEvents)}
          disabled={displayEvents.length === 0}
          aria-label="Export charge history as CSV"
          title="Download charge history as a CSV file"
        >
          Export CSV
        </button>
      </div>

      {/* Stale-while-revalidate: overlay spinner on top of existing list */}
      {loading && hasData && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            marginBottom: "var(--space-2)",
            opacity: 0.7,
          }}
          aria-live="polite"
          aria-label="Refreshing charge history"
        >
          <Spinner />
          <span style={{ fontSize: "0.8rem" }}>Refreshing…</span>
        </div>
      )}

      {/* Event list — at most PAGE_SIZE items mounted */}
      <div className="charge-history-list" role="list">
        {pageEvents.map((event, index) => (
          <div
            key={`${event.txHash}-${pageStart + index}`}
            className="charge-history-item"
            role="listitem"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              padding: "var(--space-3) 0",
              borderBottom:
                index < pageEvents.length - 1 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="subscription-row__value">{formatDate(event.date)}</span>
              <span className="subscription-row__value" style={{ fontWeight: 600 }}>
                {formatAmount(event.amount)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="merchant-row__address" style={{ fontSize: "0.875rem" }}>
                To: {truncateHash(event.merchant)}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="merchant-row__address"
                  style={{ fontSize: "0.875rem" }}
                  title={event.txHash}
                >
                  {truncateHash(event.txHash)}
                </a>
                <CopyButton text={event.txHash} />
              </div>
            </div>
          </div>
        ))}
      </div>
<<<<<<< HEAD
=======
<<<<<<< HEAD
=======
      {hasMore && (
        <div style={{ textAlign: "center", padding: "var(--space-4) 0" }}>
          <button onClick={loadMore} className="btn-secondary" disabled={loading}>
            Load more
          </button>
        </div>
      )}

>>>>>>> 6d2bb0bdee2f908481093df56db7a244c0dd0e50
>>>>>>> origin/master
      {/* Pagination controls */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "var(--space-4)",
            gap: "var(--space-2)",
          }}
        >
          <button
            className="btn-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            aria-label="Previous page"
          >
            Previous
          </button>

          <span data-testid="history-page-info" style={{ fontSize: "0.875rem" }}>
            Page {safePage} of {totalPages}
          </span>

          <button
            className="btn-secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
