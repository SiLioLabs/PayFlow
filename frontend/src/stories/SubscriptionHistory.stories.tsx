/**
 * SubscriptionHistory stories — loading, empty, error, and populated states
 * via pure markup (no live RPC).
 */
import React from "react";
import type { Story } from "@ladle/react";
import { ChargeHistorySkeleton } from "../components/Skeleton";

// ── Loading state ──────────────────────────────────────────────────────────────

export const Loading: Story = () => (
  <div className="card" aria-busy="true" style={{ maxWidth: 560 }}>
    <h3 className="subscription-card__title" style={{ marginBottom: "var(--space-4)" }}>
      Charge History
    </h3>
    <div className="charge-history-list" role="list">
      <ChargeHistorySkeleton />
      <ChargeHistorySkeleton />
      <ChargeHistorySkeleton />
    </div>
  </div>
);
Loading.storyName = "Loading skeleton";

// ── Empty state ────────────────────────────────────────────────────────────────

export const Empty: Story = () => (
  <div className="card" style={{ maxWidth: 560 }}>
    <h3 className="subscription-card__title">Charge History</h3>
    <p className="no-sub-text" style={{ padding: "var(--space-4) 0" }}>
      No charges yet. Your subscription billing history will appear here.
    </p>
  </div>
);
Empty.storyName = "Empty (no charges)";

// ── Error state ────────────────────────────────────────────────────────────────

export const ErrorState: Story = () => (
  <div className="card" role="alert" aria-live="assertive" style={{ maxWidth: 560 }}>
    <h3 className="subscription-card__title">Charge History</h3>
    <div className="error-state" style={{ padding: "var(--space-4) 0" }}>
      <p style={{ color: "var(--color-danger)", marginBottom: "var(--space-3)" }}>
        Unable to load charge history.
      </p>
      <button className="btn-primary">Retry</button>
    </div>
  </div>
);
ErrorState.storyName = "Error (RPC failure)";

// ── Populated state ────────────────────────────────────────────────────────────

const CHARGES = [
  {
    date: new Date("2026-11-20"),
    amount: 50_000_000n,
    merchant: "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB",
    txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  },
  {
    date: new Date("2026-10-20"),
    amount: 50_000_000n,
    merchant: "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB",
    txHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
  },
  {
    date: new Date("2026-09-20"),
    amount: 50_000_000n,
    merchant: "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB",
    txHash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  },
];

function truncateHash(h: string) {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const Populated: Story = () => (
  <div className="card" style={{ maxWidth: 560 }}>
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
      <button className="btn-secondary">Export CSV</button>
    </div>
    <div className="charge-history-list" role="list">
      {CHARGES.map((e, i) => (
        <div
          key={e.txHash}
          className="charge-history-item"
          role="listitem"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            padding: "var(--space-3) 0",
            borderBottom:
              i < CHARGES.length - 1 ? "1px solid var(--color-border)" : "none",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="subscription-row__value">{formatDate(e.date)}</span>
            <span className="subscription-row__value" style={{ fontWeight: 600 }}>
              {(Number(e.amount) / 1e7).toFixed(2)} XLM
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="merchant-row__address" style={{ fontSize: "0.875rem" }}>
              To: {truncateHash(e.merchant)}
            </span>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${e.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="merchant-row__address"
              style={{ fontSize: "0.875rem" }}
            >
              {truncateHash(e.txHash)}
            </a>
          </div>
        </div>
      ))}
    </div>
  </div>
);
Populated.storyName = "Populated (3 charges)";
