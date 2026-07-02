import React, { useEffect, useState, useCallback } from "react";
import { getDailyLimit, getDailySpent } from "../stellar";
import { formatXlm } from "../utils/format";
import Spinner from "./Spinner";

interface Props {
  userKey: string;
  refreshTrigger: number;
  onOpen: () => void;
}

export default function DailyLimitCard({ userKey, refreshTrigger, onOpen }: Props) {
  const [dailyLimit, setDailyLimit] = useState<bigint | null>(null);
  const [dailySpent, setDailySpent] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [limit, spent] = await Promise.all([getDailyLimit(userKey), getDailySpent(userKey)]);
      setDailyLimit(limit);
      setDailySpent(spent);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setDailyLimit(null);
      setDailySpent(null);
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const remaining = dailyLimit !== null && dailySpent !== null ? dailyLimit - dailySpent : null;

  if (loading) {
    return (
      <div className="card" aria-busy="true" aria-label="Loading daily spending limit">
        <h3 className="subscription-card__title">Daily Spending</h3>
        <div style={{ padding: "var(--space-4) 0", textAlign: "center" }}>
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="subscription-card__header">
        <div>
          <h3 className="subscription-card__title">Daily Spending</h3>
          <p className="subscription-card__label">
            Control your pay-per-use spending cap and view today’s usage.
          </p>
        </div>
        <button className="btn-secondary" onClick={onOpen}>
          Set limit
        </button>
      </div>

      {error ? (
        <div role="alert" className="error-state">
          <p className="text-error">Unable to load daily spending data.</p>
          <p>{error}</p>
        </div>
      ) : (
        <div className="subscription-rows">
          <Row
            label="Daily limit"
            value={dailyLimit !== null ? formatXlm(dailyLimit) : "Not set"}
          />
          <Row label="Today's spend" value={dailySpent !== null ? formatXlm(dailySpent) : "—"} />
          <Row
            label="Remaining"
            value={remaining !== null ? (remaining >= 0n ? formatXlm(remaining) : "Exceeded") : "—"}
          />
        </div>
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
