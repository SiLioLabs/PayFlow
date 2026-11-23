/**
 * SubscriptionCard stories — covers: active, paused, cancelled, trial, low
 * allowance, no allowance, and mobile layout.
 *
 * The card requires several async hooks (getAllowance, getTrialEnd, etc.) and
 * context providers. Rather than mocking the entire Soroban RPC stack, these
 * stories stub only the external imports the card needs so it renders in
 * isolation inside the catalogue.
 */
import React from "react";
import type { Story } from "@ladle/react";
import type { Subscription } from "../types";
import SubscriptionCardSkeleton from "../components/Skeleton";

// ── Shared mock data ───────────────────────────────────────────────────────────

const MERCHANT = "GBZXN7PIRZGNMHGA7QA7FBT3BTSCKPF5ZJMPKH3VGZRWMHBKIUCMPHB";
const NOW = Math.floor(Date.now() / 1000);
const MONTHLY = 30 * 24 * 3600; // seconds

function baseSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    merchant: MERCHANT,
    amount: "50000000", // 5 XLM in stroops
    interval: MONTHLY,
    last_charged: NOW - MONTHLY + 3600 * 24, // charged 1 day ago
    active: true,
    paused: false,
    label: "",
    ...overrides,
  };
}

// ── Skeleton stand-ins ─────────────────────────────────────────────────────────
// The real SubscriptionCard depends on context providers (ShortcutRegistry,
// AmountDisplay, Responsive, Wallet) and live RPC calls. Stories that want a
// full interactive card should wrap it with the appropriate providers.
// Until a mock provider harness is in place we render the skeleton so the
// catalogue still documents the loading state shape.

export const Loading: Story = () => (
  <div style={{ maxWidth: 480 }}>
    <SubscriptionCardSkeleton />
  </div>
);
Loading.storyName = "Loading skeleton";

// ── Prop-preview cards (pure markup, no hooks) ─────────────────────────────────

function PreviewCard({
  subscription,
  note,
}: {
  subscription: Subscription;
  note?: string;
}) {
  const { merchant, amount, interval, active, paused } = subscription;
  const xlm = (Number(amount) / 1e7).toFixed(2);
  const days = Math.round(interval / 86400);
  const status = !active ? "Cancelled" : paused ? "Paused" : "Active";
  const badgeClass = !active
    ? "badge-inactive"
    : paused
      ? "badge-warning"
      : "badge-active";

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <div className="subscription-card__header">
        <h2 className="subscription-card__title">Your Subscription</h2>
        <span className={`badge ${badgeClass}`}>{status}</span>
      </div>
      {note && (
        <p
          style={{
            fontSize: "0.78rem",
            color: "var(--color-text-muted)",
            marginBottom: "var(--space-3)",
            fontStyle: "italic",
          }}
        >
          {note}
        </p>
      )}
      <div className="subscription-rows">
        <div className="subscription-row">
          <span className="subscription-row__label">Merchant</span>
          <span className="subscription-row__value merchant-row__address">
            {merchant.slice(0, 8)}…{merchant.slice(-6)}
          </span>
        </div>
        <div className="subscription-row">
          <span className="subscription-row__label">Amount</span>
          <span className="subscription-row__value">{xlm} XLM</span>
        </div>
        <div className="subscription-row">
          <span className="subscription-row__label">Interval</span>
          <span className="subscription-row__value">Every {days}d</span>
        </div>
      </div>
      <div className="subscription-card__actions">
        {active && !paused && (
          <>
            <button className="btn-secondary">Pause</button>
            <button className="btn-danger">Cancel</button>
          </>
        )}
        {active && paused && <button className="btn-primary">Resume</button>}
      </div>
    </div>
  );
}

export const Active: Story = () => (
  <PreviewCard subscription={baseSub()} note="Normal active subscription." />
);
Active.storyName = "Active";

export const Paused: Story = () => (
  <PreviewCard
    subscription={baseSub({ paused: true })}
    note="Subscription paused by the subscriber."
  />
);
Paused.storyName = "Paused";

export const Cancelled: Story = () => (
  <PreviewCard
    subscription={baseSub({ active: false, paused: false })}
    note="Subscription has been cancelled."
  />
);
Cancelled.storyName = "Cancelled";

export const LowAllowance: Story = () => (
  <div style={{ maxWidth: 480 }}>
    <PreviewCard
      subscription={baseSub()}
      note="Allowance < 3× amount → amber badge (requires live hook)."
    />
    <div
      className="allowance-health-row"
      style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}
    >
      <span className="text-sm text-muted">Allowance:</span>
      <button className="allowance-health-badge allowance-health-badge--low">
        ⚠ Allowance too low
      </button>
    </div>
  </div>
);
LowAllowance.storyName = "Low allowance badge";

export const NoAllowance: Story = () => (
  <div style={{ maxWidth: 480 }}>
    <PreviewCard
      subscription={baseSub()}
      note="Allowance = 0 → red badge (requires live hook)."
    />
    <div
      className="allowance-health-row"
      style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}
    >
      <span className="text-sm text-muted">Allowance:</span>
      <button className="allowance-health-badge allowance-health-badge--none">
        ⚠ No allowance — charges will fail
      </button>
    </div>
  </div>
);
NoAllowance.storyName = "No allowance badge";

export const TrialActive: Story = () => (
  <div style={{ maxWidth: 480 }}>
    <PreviewCard
      subscription={baseSub()}
      note="Trial period is active — amber trial badge shown."
    />
    <div className="trial-badge-row" style={{ marginTop: "var(--space-3)" }}>
      <span className="trial-badge" data-testid="trial-badge">
        🎁 Trial ends in 7 days
      </span>
    </div>
  </div>
);
TrialActive.storyName = "Trial active badge";
