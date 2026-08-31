import React, { useEffect, useState, useCallback } from "react";
import { getDailyLimit, getDailySpent, getDayStart } from "../stellar";
import { useAmountDisplay } from "../hooks/useAmountDisplay";
import { dailyLimitProgress } from "../utils/format";
import Spinner from "./Spinner";

interface Props {
  userKey: string;
  refreshTrigger: number;
  onOpen: () => void;
}

export default function DailyLimitCard({ userKey, refreshTrigger, onOpen }: Props) {
  const [dailyLimit, setDailyLimit] = useState<bigint | null>(null);
  const [dailySpent, setDailySpent] = useState<bigint | null>(null);
  const [dayStart, setDayStart] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { displayCurrentAmount } = useAmountDisplay();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [limit, spent, start] = await Promise.all([
        getDailyLimit(userKey),
        getDailySpent(userKey),
        getDayStart(userKey),
      ]);
      setDailyLimit(limit);
      setDailySpent(spent);
      setDayStart(start);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setDailyLimit(null);
      setDailySpent(null);
      setDayStart(null);
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const remaining = dailyLimit !== null && dailySpent !== null ? dailyLimit - dailySpent : null;
  const dayActive = dayStart !== null;
  const progress =
    dailyLimit !== null && dailySpent !== null ? dailyLimitProgress(dailySpent, dailyLimit) : 0;
  const isUncappedWithWindow =
    dailyLimit === null && dayActive && dailySpent !== null && dailySpent > 0n;

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
        <>
          <div className="subscription-rows">
            <Row
              label="Daily limit"
              value={dailyLimit !== null ? displayCurrentAmount(dailyLimit) : "Not set"}
            />
            <Row
              label="Today's spend"
              value={dailySpent !== null ? displayCurrentAmount(dailySpent) : "—"}
            />
            <Row
              label="Remaining"
              value={
                remaining !== null
                  ? remaining >= 0n
                    ? displayCurrentAmount(remaining)
                    : "Exceeded"
                  : "—"
              }
            />
            <Row
              label="Day window"
              value={dayActive ? "Active — resets ~24h after first spend" : "Inactive"}
            />
          </div>

          {dailyLimit !== null && dailySpent !== null && (
            <div style={{ marginTop: 12 }}>
              <div
                role="progressbar"
                aria-label="Daily limit usage"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  height: 8,
                  background: "var(--color-surface-overlay)",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    background:
                      progress >= 100
                        ? "var(--color-danger)"
                        : progress >= 80
                          ? "#f59e0b"
                          : "var(--color-primary)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                {progress}% used —{" "}
                {dayActive
                  ? "Resets about 24 hours after your first spend today."
                  : "Window starts on first pay-per-use."}
              </p>
            </div>
          )}

          {isUncappedWithWindow && (
            <p className="text-xs" style={{ marginTop: 8, color: "#f59e0b" }} role="status">
              Limit expired but window still active — spending is currently uncapped until you set a
              new limit.
            </p>
          )}

          {dailyLimit === null && !dayActive && (
            <p className="text-xs text-muted" style={{ marginTop: 8 }}>
              No cap set — pay-per-use is uncapped. Set a limit to protect against unexpected spend.
            </p>
          )}
        </>
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
