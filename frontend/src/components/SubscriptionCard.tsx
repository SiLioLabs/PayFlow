import React from "react";
import CopyButton from "./CopyButton";

interface SubscriptionCardProps {
  subscription: {
    merchant: string;
    amount: string;
    interval: number;
    last_charged: number;
    active: boolean;
  };
  onCancel: () => void;
}

function formatInterval(secs: number): string {
  if (secs >= 2_592_000) return `${Math.round(secs / 2_592_000)}mo`;
  if (secs >= 604_800) return `${Math.round(secs / 604_800)}w`;
  if (secs >= 86_400) return `${Math.round(secs / 86_400)}d`;
  return `${secs}s`;
}

export default function SubscriptionCard({
  subscription,
  onCancel,
}: SubscriptionCardProps) {
  const { merchant, amount, interval, last_charged, active } = subscription;
  const nextCharge = new Date(
    (last_charged + interval) * 1000
  ).toLocaleDateString();

  return (
    <div className="card">
      <div className="subscription-card__header">
        <h2 className="subscription-card__title">Your Subscription</h2>
        <span className={`badge ${active ? "badge-active" : "badge-inactive"}`}>
          {active ? "Active" : "Cancelled"}
        </span>
      </div>

      <div className="subscription-rows">
        <div className="subscription-row">
          <span className="subscription-row__label">Merchant</span>
          <div className="merchant-row">
            <span className="merchant-row__address">
              {`${merchant.slice(0, 8)}…${merchant.slice(-6)}`}
            </span>
            <CopyButton text={merchant} />
          </div>
        </div>
        <Row label="Amount" value={`${xlm} XLM`} />
        <Row label="Interval" value={formatInterval(interval)} />
        <Row label="Next charge" value={active ? nextCharge : "—"} />
      </div>

      {active && (
        <button onClick={onCancel} className="btn-danger cancel-btn">
          Cancel Subscription
        </button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="subscription-row">
      <span className="subscription-row__label">{label}</span>
      <span className="subscription-row__value">{value}</span>
    </div>
  );
}
