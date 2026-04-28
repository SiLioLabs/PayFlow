import React, { useState, useEffect, useCallback } from "react";
import { getChargeHistory } from "../stellar";
import { ChargeEvent } from "../types";
import { STROOPS_PER_XLM } from "../constants";
import Spinner from "./Spinner";
import CopyButton from "./CopyButton";

interface Props {
  userKey: string;
}

function formatAmount(stroops: string): string {
  const xlm = Number(stroops) / STROOPS_PER_XLM;
  return `${xlm.toFixed(2)} XLM`;
}

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

export default function SubscriptionHistory({ userKey }: Props) {
  const [events, setEvents] = useState<ChargeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getChargeHistory(userKey);
      setEvents(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="card" aria-busy="true" aria-label="Loading charge history">
        <h3 className="subscription-card__title">Charge History</h3>
        <div style={{ padding: "var(--space-4) 0", textAlign: "center" }}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" role="alert" aria-live="assertive">
        <h3 className="subscription-card__title">Charge History</h3>
        <div className="error-state" style={{ padding: "var(--space-4) 0" }}>
          <p style={{ color: "var(--color-danger)", marginBottom: "var(--space-3)" }}>
            Unable to load charge history.
          </p>
          <button onClick={fetchHistory} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
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
      <h3 className="subscription-card__title">Charge History</h3>
      <div className="charge-history-list" role="list">
        {events.map((event, index) => (
          <div
            key={`${event.txHash}-${index}`}
            className="charge-history-item"
            role="listitem"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              padding: "var(--space-3) 0",
              borderBottom:
                index < events.length - 1 ? "1px solid var(--color-border)" : "none",
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
              <span
                className="subscription-row__value"
                style={{ fontWeight: 600 }}
              >
                {formatAmount(event.amount)}
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
    </div>
  );
}
