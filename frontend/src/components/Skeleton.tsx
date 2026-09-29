import React from "react";

/** A single skeleton block. Width defaults to 100%. */
function SkeletonBlock({
  width = "100%",
  height = "var(--space-4)",
  style,
}: {
  width?: string;
  height?: string;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

/** Mirrors the SubscriptionCard layout: title row, three data rows, button placeholder. */
export default function SubscriptionCardSkeleton() {
  return (
    <div className="card" aria-busy="true" aria-label="Loading subscription">
      {/* Title row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-4)",
        }}
      >
        <SkeletonBlock width="40%" height="var(--space-5)" />
        <SkeletonBlock width="15%" height="var(--space-5)" />
      </div>

      {/* Data rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <SkeletonBlock width="80%" />
        <SkeletonBlock width="60%" />
        <SkeletonBlock width="70%" />
      </div>

      {/* Button placeholder */}
      <SkeletonBlock width="100%" height="var(--space-8)" style={{ marginTop: "var(--space-5)" }} />
    </div>
  );
}

export function MerchantSubscriberSkeleton() {
  return (
    <div
      className="subscription-row merchant-subscriber-row"
      aria-busy="true"
      aria-label="Loading subscriber"
    >
      <div className="merchant-row" style={{ width: "40%" }}>
        <SkeletonBlock width="100%" height="var(--space-4)" />
      </div>
      <div className="merchant-subscriber-value" style={{ width: "30%" }}>
        <SkeletonBlock width="80%" height="var(--space-5)" style={{ marginLeft: "auto" }} />
        <SkeletonBlock
          width="60%"
          height="var(--space-4)"
          style={{ marginLeft: "auto", marginTop: "var(--space-1)" }}
        />
      </div>
    </div>
  );
}

export function ChargeHistorySkeleton() {
  return (
    <div
      className="charge-history-item"
      role="listitem"
      aria-busy="true"
      aria-label="Loading item"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-3) 0",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonBlock width="25%" height="var(--space-4)" />
        <SkeletonBlock width="20%" height="var(--space-5)" />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonBlock width="35%" height="var(--space-4)" />
      </div>
    </div>
  );
}

// ─── Admin panel skeletons ────────────────────────────────────────────────────

/**
 * Skeleton placeholder for an admin panel that loads a list of address rows
 * (BatchPausePanel, BatchWhitelistPanel). Renders `count` shimmering rows.
 */
export function AdminAddressListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading panel data" className="admin-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: "var(--space-3)",
            alignItems: "center",
            padding: "var(--space-2) 0",
          }}
        >
          <SkeletonBlock width="60%" height="var(--space-4)" />
          <SkeletonBlock width="20%" height="var(--space-4)" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton placeholder for a single-address repair / validation panel.
 * Renders a label row and an input-sized block to match the panel shape.
 */
export function AdminRepairSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading repair panel" className="admin-skeleton">
      <SkeletonBlock width="30%" height="var(--space-4)" style={{ marginBottom: "var(--space-2)" }} />
      <SkeletonBlock width="100%" height="var(--space-8)" style={{ marginBottom: "var(--space-4)" }} />
      <SkeletonBlock width="40%" height="var(--space-4)" style={{ marginBottom: "var(--space-2)" }} />
      <SkeletonBlock width="80%" height="var(--space-4)" />
    </div>
  );
}
