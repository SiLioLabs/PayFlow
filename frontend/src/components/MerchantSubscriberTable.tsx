/**
 * MerchantSubscriberTable — sortable, filterable table of merchant subscribers.
 *
 * Columns: Subscriber Address | Amount (XLM) | Interval | Last Charged | Next Charge | Status
 * Sortable: Amount (asc/desc), Next Charge (asc/desc)
 * Filterable: All | Active | Overdue
 *
 * "Active"  = next charge is in the future (subscription is running normally)
 * "Overdue" = next charge is in the past (charge missed / effectively paused)
 *
 * Issue #660
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCancelAndRefundTx,
  calculateProratedRefund,
  type MerchantSubscriber,
} from "../stellar";
import { formatAddress, formatXlm } from "../utils/format";
import { debounce } from "../utils/debounce";
import { friendlyError } from "../utils/errors";
import { SECONDS_PER_DAY, SECONDS_PER_WEEK, SECONDS_PER_MONTH } from "../constants";
import CopyButton from "./CopyButton";
import ConfirmModal from "./ConfirmModal";
import { useVirtualList } from "../hooks/useVirtualList";

const ROW_HEIGHT = 56;
const CONTAINER_HEIGHT = 480;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SortField = "amount" | "nextCharge";
export type SortDir = "asc" | "desc";
export type StatusFilter = "all" | "active" | "overdue";

export interface SortState {
  field: SortField;
  dir: SortDir;
}

export interface MerchantSubscriberTableProps {
  subscribers: MerchantSubscriber[];
  debounceMs?: number;
  /** Connected merchant wallet. Refund actions are disabled when it does not match the row. */
  merchantKey?: string | null;
  onSign?: (xdr: string) => Promise<string>;
  onRefunded?: (sub: MerchantSubscriber, hash: string) => void;
  isPaused?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(unixSec: number): string {
  if (!unixSec) return "—";
  return formatDateTimeShort(new Date(unixSec * 1000));
}

/**
 * Human-readable interval label. Buckets are derived from the shared
 * SECONDS_PER_* constants so the table stays in sync with BILLING_INTERVALS.
 */
export function formatInterval(secs: number): string {
  if (secs >= SECONDS_PER_MONTH) return `${Math.round(secs / SECONDS_PER_MONTH)}mo`;
  if (secs >= SECONDS_PER_WEEK) return `${Math.round(secs / SECONDS_PER_WEEK)}w`;
  if (secs >= SECONDS_PER_DAY) return `${Math.round(secs / SECONDS_PER_DAY)}d`;
  return `${secs}s`;
}

export function deriveStatus(nextChargeAt: number): "active" | "overdue" {
  const now = Math.floor(Date.now() / 1000);
  return nextChargeAt >= now ? "active" : "overdue";
}

function parseStroops(amount: string): bigint {
  try {
    return BigInt(amount || "0");
  } catch {
    return 0n;
  }
}

export function calculateRefundPreview(
  sub: MerchantSubscriber,
  nowSec: number = Math.floor(Date.now() / 1000)
): bigint {
  return calculateProratedRefund(
    parseStroops(sub.amount),
    sub.interval,
    sub.lastCharged,
    nowSec
  );
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ field, sort }: { field: SortField; sort: SortState }) {
  if (sort.field !== field) {
    return (
      <span className="sort-icon sort-icon--inactive" aria-hidden="true">
        ⇅
      </span>
    );
  }
  return (
    <span className="sort-icon sort-icon--active" aria-hidden="true">
      {sort.dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantSubscriberTable({
  subscribers,
  debounceMs = 150,
  merchantKey,
  onSign,
  onRefunded,
  isPaused = false,
}: MerchantSubscriberTableProps) {
  const [sort, setSort] = useState<SortState>({ field: "nextCharge", dir: "asc" });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [appliedFilter, setAppliedFilter] = useState<StatusFilter>("all");
  const [refundTarget, setRefundTarget] = useState<MerchantSubscriber | null>(null);
  const [refunded, setRefunded] = useState<Set<string>>(() => new Set());
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Debounced filter setter so a burst of filter changes produces a single settled render
  const debouncedSetAppliedFilter = useMemo(
    () =>
      debounce((nextFilter: StatusFilter) => {
        setAppliedFilter(nextFilter);
      }, debounceMs),
    [debounceMs]
  );

  useEffect(() => {
    return () => {
      debouncedSetAppliedFilter.cancel();
    };
  }, [debouncedSetAppliedFilter]);

  const handleFilterClick = (nextFilter: StatusFilter) => {
    setFilter(nextFilter);
    if (debounceMs <= 0) {
      debouncedSetAppliedFilter.cancel();
      setAppliedFilter(nextFilter);
    } else {
      debouncedSetAppliedFilter(nextFilter);
    }
  };

  // Reset scrollTop of the scroll container whenever items, sort, or filter changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [subscribers, sort, appliedFilter]);

  // Drop local refund markers for subscribers removed by a parent refresh.
  useEffect(() => {
    const current = new Set(subscribers.map((s) => s.subscriber));
    setRefunded((prev) => {
      const next = new Set([...prev].filter((address) => current.has(address)));
      return next.size === prev.size ? prev : next;
    });
  }, [subscribers]);

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (appliedFilter === "all") return subscribers;
    return subscribers.filter((s) => deriveStatus(s.nextChargeAt) === appliedFilter);
  }, [subscribers, appliedFilter]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sort.field === "amount") {
        // amounts are string stroops — compare as BigInt
        const aAmt = BigInt(a.amount || "0");
        const bAmt = BigInt(b.amount || "0");
        if (aAmt < bAmt) cmp = -1;
        else if (aAmt > bAmt) cmp = 1;
      } else {
        // nextCharge as unix seconds
        cmp = a.nextChargeAt - b.nextChargeAt;
      }
      // Secondary sort by subscriber address for stability
      if (cmp === 0) cmp = a.subscriber.localeCompare(b.subscriber);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sort]);

  // ── Virtualize the sorted/filtered rows so large lists stay smooth ──────────
  const { visibleItems, totalHeight, offsetY, onScroll } = useVirtualList(
    sorted,
    ROW_HEIGHT,
    CONTAINER_HEIGHT
  );
  const bottomSpacerHeight = Math.max(
    totalHeight - offsetY - visibleItems.length * ROW_HEIGHT,
    0
  );

  // ── Sort toggle ───────────────────────────────────────────────────────────
  function toggleSort(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
  }

  function walletMatches(sub: MerchantSubscriber): boolean {
    return Boolean(merchantKey) && (!sub.merchant || sub.merchant === merchantKey);
  }

  function openRefund(sub: MerchantSubscriber) {
    if (!merchantKey || !onSign || refunded.has(sub.subscriber)) return;
    if (!walletMatches(sub)) {
      setRefundError("Connected wallet is not this subscription's merchant (error 38).");
      return;
    }
    setRefundError(null);
    setRefundTarget(sub);
  }

  async function handleConfirmRefund() {
    const target = refundTarget;
    if (!target || !merchantKey || !onSign || refunding) return;

    if (!walletMatches(target)) {
      setRefundError("Connected wallet is not this subscription's merchant (error 38).");
      return;
    }
    const preview = calculateRefundPreview(target);
    if (preview <= 0n) {
      setRefundError("Nothing left to refund in the current period (error 39).");
      return;
    }

    setRefunding(true);
    setRefundError(null);
    try {
      const xdr = await buildCancelAndRefundTx(merchantKey, target.subscriber);
      const hash = await onSign(xdr);
      setRefunded((prev) => new Set(prev).add(target.subscriber));
      setRefundTarget(null);
      onRefunded?.(target, hash);
    } catch (err) {
      setRefundError(`Refund failed: ${friendlyError(err instanceof Error ? err.message : String(err))}`);
    } finally {
      setRefunding(false);
    }
  }

  // ── Filter counts ─────────────────────────────────────────────────────────
  const activeCount = useMemo(
    () => subscribers.filter((s) => deriveStatus(s.nextChargeAt) === "active").length,
    [subscribers]
  );
  const overdueCount = useMemo(
    () => subscribers.filter((s) => deriveStatus(s.nextChargeAt) === "overdue").length,
    [subscribers]
  );

  // ── Empty state ───────────────────────────────────────────────────────────
  if (subscribers.length === 0) {
    return (
      <div className="mst-empty" data-testid="mst-empty-state">
        <p className="text-muted">
          No subscribers yet. Share your merchant address to get started.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mst-wrapper">
        {/* Filter tabs */}
      <div className="mst-filters" role="group" aria-label="Filter subscribers by status">
        {(["all", "active", "overdue"] as StatusFilter[]).map((f) => {
          const label =
            f === "all"
              ? `All (${subscribers.length})`
              : f === "active"
                ? `Active (${activeCount})`
                : `Overdue (${overdueCount})`;
          return (
            <button
              key={f}
              className={`mst-filter-btn${filter === f ? " mst-filter-btn--active" : ""}`}
              onClick={() => handleFilterClick(f)}
              aria-pressed={filter === f}
              aria-label={`Show ${label} subscribers`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {refundError && !refundTarget && (
        <p className="mst-refund-error text-error" role="alert" data-testid="mst-refund-error">
          {refundError}
        </p>
      )}

      {/* No results after filtering */}
      {sorted.length === 0 && (
        <p className="text-muted mst-no-results" data-testid="mst-no-results">
          No subscribers match the selected filter.
        </p>
      )}

      {/* Table */}
      {sorted.length > 0 && (
        <div
          className="mst-scroll-container"
          ref={scrollContainerRef}
          onScroll={onScroll}
          style={{ maxHeight: CONTAINER_HEIGHT, overflowY: "auto" }}
        >
          <table
            className="mst-table"
            aria-label="Merchant subscriber list"
            aria-rowcount={sorted.length}
          >
            <thead>
              <tr className="mst-head-row">
                <th scope="col" className="mst-th">
                  Subscriber Address
                </th>
                <th
                  scope="col"
                  className="mst-th mst-th--sortable"
                  onClick={() => toggleSort("amount")}
                  aria-sort={
                    sort.field === "amount"
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggleSort("amount")}
                  role="columnheader"
                >
                  Amount (XLM)
                  <SortIcon field="amount" sort={sort} />
                </th>
                <th scope="col" className="mst-th">
                  Interval
                </th>
                <th scope="col" className="mst-th">
                  Last Charged
                </th>
                <th
                  scope="col"
                  className="mst-th mst-th--sortable"
                  onClick={() => toggleSort("nextCharge")}
                  aria-sort={
                    sort.field === "nextCharge"
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggleSort("nextCharge")}
                  role="columnheader"
                >
                  Next Charge
                  <SortIcon field="nextCharge" sort={sort} />
                </th>
                <th scope="col" className="mst-th">
                  Status
                </th>
                <th scope="col" className="mst-th">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {offsetY > 0 && (
                <tr aria-hidden="true" style={{ height: offsetY }}>
                  <td colSpan={7} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
              {visibleItems.map(({ item: sub, index }) => {
                const status = deriveStatus(sub.nextChargeAt);
                const preview = calculateRefundPreview(sub);
                const isRefunded = refunded.has(sub.subscriber);
                const walletMatchesRow = walletMatches(sub);
                const refundHint = isRefunded
                  ? "Refund issued"
                  : !walletMatchesRow
                    ? "Merchant wallet mismatch (error 38)"
                    : preview <= 0n
                      ? "Nothing left to refund (error 39)"
                      : isPaused
                        ? "Unavailable during maintenance"
                        : `Estimated refund ${formatXlm(preview)}`;
                return (
                  <tr
                    key={sub.subscriber}
                    className={`mst-row mst-row--${status}`}
                    data-testid={`mst-row-${sub.subscriber}`}
                    aria-rowindex={index + 1}
                  >
                    {/* Subscriber address */}
                    <td className="mst-cell mst-cell--address">
                      <span className="mst-address">{formatAddress(sub.subscriber, 8, 6)}</span>
                      <CopyButton
                        text={sub.subscriber}
                        ariaLabel={`Copy subscriber address ${sub.subscriber}`}
                      />
                    </td>

                    {/* Amount */}
                    <td className="mst-cell mst-cell--amount">{formatXlm(sub.amount)}</td>

                    {/* Interval */}
                    <td className="mst-cell">{formatInterval(sub.interval)}</td>

                    {/* Last charged */}
                    <td className="mst-cell mst-cell--date">{formatDate(sub.lastCharged)}</td>

                    {/* Next charge */}
                    <td className="mst-cell mst-cell--date">{formatDate(sub.nextChargeAt)}</td>

                    {/* Status badge */}
                    <td className="mst-cell">
                      <span
                        className={`mst-status-badge mst-status-badge--${isRefunded ? "refunded" : status}`}
                        aria-label={isRefunded ? "Status: refunded" : `Status: ${status}`}
                      >
                        {isRefunded ? "Refunded" : status === "active" ? "Active" : "Overdue"}
                      </span>
                    </td>

                    {/* Refund action */}
                    <td className="mst-cell">
                      {merchantKey && onSign && (
                        <>
                          <button
                            type="button"
                            className="btn-secondary mst-refund-btn"
                            data-testid={`mst-refund-${sub.subscriber}`}
                            aria-label={`Refund and cancel subscriber ${sub.subscriber}`}
                            title={refundHint}
                            disabled={
                              isPaused ||
                              !walletMatchesRow ||
                              preview <= 0n ||
                              isRefunded ||
                              refunding
                            }
                            onClick={() => openRefund(sub)}
                          >
                            {isRefunded
                              ? "Refunded"
                              : preview > 0n
                                ? `Refund ${formatXlm(preview)}`
                                : "No refund"}
                          </button>
                          {(!walletMatchesRow || preview <= 0n) && !isRefunded && (
                            <span className="mst-refund-hint text-error">{refundHint}</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {bottomSpacerHeight > 0 && (
                <tr aria-hidden="true" style={{ height: bottomSpacerHeight }}>
                  <td colSpan={7} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
            </tbody>
            </table>
          </div>
        )}
      </div>

      {refundTarget && (
        <ConfirmModal
          message={`Cancel this subscription and refund the unused period?`}
          onConfirm={handleConfirmRefund}
          onCancel={() => {
            if (!refunding) {
              setRefundTarget(null);
              setRefundError(null);
            }
          }}
          confirmDisabled={
            refunding ||
            isPaused ||
            !walletMatches(refundTarget) ||
            calculateRefundPreview(refundTarget) <= 0n
          }
          confirmTestId="mst-refund-confirm"
          cancelTestId="mst-refund-cancel"
          confirmLabel={refunding ? "Refunding…" : "Cancel & refund"}
        >
          <div className="mst-refund-summary" data-testid="mst-refund-preview">
            <div className="flex-between">
              <span className="text-sm text-muted">Subscriber</span>
              <span className="text-mono">{formatAddress(refundTarget.subscriber, 8, 6)}</span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">Current charge</span>
              <span className="text-mono">{formatXlm(parseStroops(refundTarget.amount))}</span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">Estimated refund</span>
              <strong className="text-mono" data-testid="mst-refund-amount">
                {formatXlm(calculateRefundPreview(refundTarget))}
              </strong>
            </div>
            <p className="text-sm text-muted">
              The contract requires both merchant and subscriber authorization. Refunds are
              merchant-funded and the subscription is cancelled in the same transaction.
            </p>
          </div>
          {refundError && (
            <p className="text-error" role="alert" data-testid="mst-refund-modal-error">
              {refundError}
            </p>
          )}
        </ConfirmModal>
      )}
    </>
  );
}
