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
import React, { useMemo, useState } from "react";
import type { MerchantSubscriber } from "../stellar";
import { formatAddress, formatXlm } from "../utils/format";
import CopyButton from "./CopyButton";
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

interface Props {
  subscribers: MerchantSubscriber[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(unixSec: number): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatInterval(secs: number): string {
  const day = 86_400;
  const week = 604_800;
  const month = 2_592_000;
  if (secs >= month) return `${Math.round(secs / month)}mo`;
  if (secs >= week) return `${Math.round(secs / week)}w`;
  if (secs >= day) return `${Math.round(secs / day)}d`;
  return `${secs}s`;
}

export function deriveStatus(nextChargeAt: number): "active" | "overdue" {
  const now = Math.floor(Date.now() / 1000);
  return nextChargeAt >= now ? "active" : "overdue";
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

export default function MerchantSubscriberTable({ subscribers }: Props) {
  const [sort, setSort] = useState<SortState>({ field: "nextCharge", dir: "asc" });
  const [filter, setFilter] = useState<StatusFilter>("all");

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (filter === "all") return subscribers;
    return subscribers.filter((s) => deriveStatus(s.nextChargeAt) === filter);
  }, [subscribers, filter]);

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
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              aria-label={`Show ${label} subscribers`}
            >
              {label}
            </button>
          );
        })}
      </div>

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
              </tr>
            </thead>
            <tbody>
              {offsetY > 0 && (
                <tr aria-hidden="true" style={{ height: offsetY }}>
                  <td colSpan={6} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
              {visibleItems.map(({ item: sub, index }) => {
                const status = deriveStatus(sub.nextChargeAt);
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
                        className={`mst-status-badge mst-status-badge--${status}`}
                        aria-label={`Status: ${status}`}
                      >
                        {status === "active" ? "Active" : "Overdue"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {bottomSpacerHeight > 0 && (
                <tr aria-hidden="true" style={{ height: bottomSpacerHeight }}>
                  <td colSpan={6} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
