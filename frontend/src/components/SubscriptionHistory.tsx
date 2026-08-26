import React, { useMemo, useRef, useState } from "react";
import { useContractEvents } from "../hooks/useContractEvents";
import { ChargeEvent } from "../types";
import { STROOPS_PER_XLM } from "../constants";
import Spinner from "./Spinner";
import CopyButton from "./CopyButton";
import { ChargeHistorySkeleton } from "./Skeleton";

interface Props {
  userKey: string;
}

/** Number of charge events shown per page. */
const PAGE_SIZE = 20;

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

// ─── Filter state ─────────────────────────────────────────────────────────────

interface FilterState {
  startDate: string; // ISO date string "YYYY-MM-DD" or ""
  endDate: string;
  minXlm: string;
  maxXlm: string;
}

const EMPTY_FILTERS: FilterState = {
  startDate: "",
  endDate: "",
  minXlm: "",
  maxXlm: "",
};

function hasActiveFilters(f: FilterState): boolean {
  return !!(f.startDate || f.endDate || f.minXlm || f.maxXlm);
}

/**
 * Validates the filter combination and returns a user-facing error string
 * or null if everything is fine.
 */
function validateFilters(f: FilterState): string | null {
  if (f.startDate && f.endDate && f.startDate > f.endDate) {
    return "Start date must be on or before end date.";
  }
  const min = parseFloat(f.minXlm);
  const max = parseFloat(f.maxXlm);
  if (f.minXlm && f.maxXlm && !isNaN(min) && !isNaN(max) && min > max) {
    return "Min amount must be less than or equal to max amount.";
  }
  return null;
}

/**
 * Apply filter criteria to a sorted event array.
 * Amount filter values are XLM that we convert to stroops for comparison.
 */
function applyFilters(events: ChargeEvent[], f: FilterState): ChargeEvent[] {
  const minStroops = f.minXlm !== "" ? parseFloat(f.minXlm) * STROOPS_PER_XLM : null;
  const maxStroops = f.maxXlm !== "" ? parseFloat(f.maxXlm) * STROOPS_PER_XLM : null;

  // Convert date strings to midnight UTC timestamps for comparison
  const startTs = f.startDate ? new Date(f.startDate + "T00:00:00").getTime() : null;
  const endTs = f.endDate ? new Date(f.endDate + "T23:59:59.999").getTime() : null;

  return events.filter((event) => {
    const ts = event.date.getTime();
    if (startTs !== null && ts < startTs) return false;
    if (endTs !== null && ts > endTs) return false;

    const amount = Number(event.amount);
    if (minStroops !== null && !isNaN(minStroops) && amount < minStroops) return false;
    if (maxStroops !== null && !isNaN(maxStroops) && amount > maxStroops) return false;

    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SubscriptionHistory({ userKey }: Props) {
  const {
    events: contractEvents,
    loading,
    error,
    refresh,
    loadMore,
    hasMore,
  } = useContractEvents("charged", userKey);

  // Cache of the last successfully fetched events for stale-while-revalidate.
  const cachedEventsRef = useRef<ChargeEvent[]>([]);

  // Client-side pagination state.
  const [page, setPage] = useState(1);

  // Filter state — persists while component is mounted.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const filterError = validateFilters(filters);

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

  // Apply filters (only when there are no validation errors)
  const filteredEvents = useMemo<ChargeEvent[]>(() => {
    if (filterError || !hasActiveFilters(filters)) return displayEvents;
    return applyFilters(displayEvents, filters);
  }, [displayEvents, filters, filterError]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));

  // Keep page in bounds when data or filters change.
  const safePage = Math.min(page, totalPages);

  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pageEvents = filteredEvents.slice(pageStart, pageEnd);

  // Loading state: only show full skeleton when we have no data at all.
  const hasData = displayEvents.length > 0;

  function handleFilterChange(key: keyof FilterState, value: string) {
    setPage(1); // reset to page 1 on any filter change
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }

  if (!hasData && loading) {
    return (
      <div className="card" aria-busy="true">
        <h3 className="subscription-card__title" style={{ marginBottom: "var(--space-4)" }}>
          Charge History
        </h3>
        <p className="sr-only">Loading charge history</p>
        <div className="charge-history-list" role="list">
          <ChargeHistorySkeleton />
          <ChargeHistorySkeleton />
          <ChargeHistorySkeleton />
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
          onClick={() => exportToCsv(filteredEvents)}
          disabled={filteredEvents.length === 0}
          aria-label="Export charge history as CSV"
          title="Download charge history as a CSV file"
        >
          Export CSV
        </button>
      </div>

      {/* ── Filter panel ───────────────────────────────────────────────────── */}
      <div
        className="history-filters"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          padding: "var(--space-3)",
          marginBottom: "var(--space-3)",
          background: "var(--color-bg-secondary)",
          borderRadius: "var(--radius-md, 8px)",
          border: "1px solid var(--color-border)",
        }}
        aria-label="Filter charge history"
      >
        {/* Date range */}
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}
        >
          <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>
            From
            <input
              type="date"
              data-testid="filter-start-date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange("startDate", e.target.value)}
              style={{
                marginLeft: "var(--space-1)",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text)",
                fontSize: "0.8rem",
              }}
              aria-label="Filter start date"
            />
          </label>
          <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>
            To
            <input
              type="date"
              data-testid="filter-end-date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange("endDate", e.target.value)}
              style={{
                marginLeft: "var(--space-1)",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text)",
                fontSize: "0.8rem",
              }}
              aria-label="Filter end date"
            />
          </label>
        </div>

        {/* Amount range */}
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}
        >
          <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>
            Min XLM
            <input
              type="number"
              data-testid="filter-min-xlm"
              min="0"
              step="0.01"
              placeholder="0"
              value={filters.minXlm}
              onChange={(e) => handleFilterChange("minXlm", e.target.value)}
              style={{
                marginLeft: "var(--space-1)",
                width: "80px",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text)",
                fontSize: "0.8rem",
              }}
              aria-label="Filter minimum amount in XLM"
            />
          </label>
          <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>
            Max XLM
            <input
              type="number"
              data-testid="filter-max-xlm"
              min="0"
              step="0.01"
              placeholder="∞"
              value={filters.maxXlm}
              onChange={(e) => handleFilterChange("maxXlm", e.target.value)}
              style={{
                marginLeft: "var(--space-1)",
                width: "80px",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text)",
                fontSize: "0.8rem",
              }}
              aria-label="Filter maximum amount in XLM"
            />
          </label>
        </div>

        {/* Clear filters button */}
        {hasActiveFilters(filters) && (
          <button
            className="btn-secondary"
            data-testid="clear-filters"
            onClick={clearFilters}
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Validation error */}
      {filterError && (
        <p
          role="alert"
          data-testid="filter-error"
          style={{
            color: "var(--color-danger)",
            fontSize: "0.85rem",
            marginBottom: "var(--space-2)",
          }}
        >
          {filterError}
        </p>
      )}

      {/* Results count */}
      {hasActiveFilters(filters) && !filterError && (
        <p
          data-testid="filter-results-count"
          style={{
            fontSize: "0.8rem",
            color: "var(--color-text-muted, var(--color-text))",
            marginBottom: "var(--space-2)",
            opacity: 0.75,
          }}
          aria-live="polite"
        >
          Showing {filteredEvents.length} of {displayEvents.length} charge
          {displayEvents.length !== 1 ? "s" : ""}
        </p>
      )}

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

      {/* Empty state after filtering */}
      {filteredEvents.length === 0 && hasActiveFilters(filters) && !filterError && (
        <div
          data-testid="filter-empty-state"
          style={{ padding: "var(--space-4) 0", textAlign: "center" }}
        >
          <p className="no-sub-text">No charges match the current filters.</p>
          <button
            className="btn-secondary"
            onClick={clearFilters}
            style={{ marginTop: "var(--space-2)" }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Event list — at most PAGE_SIZE items mounted */}
      {filteredEvents.length > 0 && (
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
                  {`${(Number(event.amount) / STROOPS_PER_XLM).toFixed(2)} XLM`}
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
      )}

      {hasMore && (
        <div style={{ textAlign: "center", padding: "var(--space-4) 0" }}>
          <button onClick={loadMore} className="btn-secondary" disabled={loading}>
            Load more
          </button>
        </div>
      )}

      {/* Pagination controls */}
      {totalPages > 1 && filteredEvents.length > 0 && (
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
