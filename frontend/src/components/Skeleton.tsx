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
