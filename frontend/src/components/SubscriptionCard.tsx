import React from "react";
import CopyButton from "./CopyButton";
import NextChargeCountdown from "./NextChargeCountdown";
import { Subscription } from "../types";
import { BILLING_INTERVALS, STROOPS_PER_XLM } from "../constants";

interface SubscriptionCardProps {
  subscription: Subscription;
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
  const nextChargeTimestamp = last_charged + interval;
  const xlm = (Number(amount) / STROOPS_PER_XLM).toFixed(2);

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
        <div className="subscription-row">
          <span className="subscription-row__label">Next charge</span>
          <span className="subscription-row__value">
            {active ? (
              <NextChargeCountdown nextChargeTimestamp={nextChargeTimestamp} />
            ) : (
              "—"
            )}
          </span>
        </div>
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
