import React from "react";
import { formatAddress, formatXlm } from "../utils/format";
import { BILLING_INTERVALS } from "../constants";

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
  const monthly = BILLING_INTERVALS[2].value;
  const weekly = BILLING_INTERVALS[1].value;
  const daily = BILLING_INTERVALS[0].value;
  if (secs >= monthly) return `${Math.round(secs / monthly)}mo`;
  if (secs >= weekly) return `${Math.round(secs / weekly)}w`;
  if (secs >= daily) return `${Math.round(secs / daily)}d`;
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
        <Row
          label="Merchant"
          value={formatAddress(merchant, 8, 6)}
        />
        <Row label="Amount" value={formatXlm(amount)} />
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
