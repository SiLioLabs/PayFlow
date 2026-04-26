import React, { useCallback, useEffect, useState } from "react";
import { getMerchantSubscribers, type MerchantSubscriber } from "../stellar";
import { formatAddress, formatXlm } from "../utils/format";

interface Props {
  merchantKey: string;
  refreshTrigger: number;
}

function formatNextCharge(nextChargeAt: number): string {
  const date = new Date(nextChargeAt * 1000);
  return date.toLocaleString();
}

export default function MerchantDashboard({
  merchantKey,
  refreshTrigger,
}: Props) {
  const [subscribers, setSubscribers] = useState<MerchantSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMerchantSubscribers(merchantKey);
      setSubscribers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setSubscribers([]);
    } finally {
      setLoading(false);
    }
  }, [merchantKey]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  if (loading) {
    return (
      <div className="dashboard">
        <p className="text-muted">Loading merchant subscribers…</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="flex-between mb-4">
        <div>
          <h2 className="text-xl font-bold">Merchant Subscribers</h2>
          <p className="text-sm text-muted">
            Active subscribers paying your merchant wallet.
          </p>
        </div>
        <button className="btn-secondary" onClick={refresh}>
          Refresh
        </button>
      </div>

      {error && (
        <p className="action-status" style={{ color: "var(--color-danger)" }}>
          Error: {error}
        </p>
      )}

      {subscribers.length === 0 ? (
        <div className="card">
          <p className="no-sub-text">
            No active subscribers found for {formatAddress(merchantKey)}.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="subscription-rows">
            {subscribers.map((entry) => (
              <div className="subscription-row" key={entry.subscriber}>
                <span className="subscription-row__label">
                  {formatAddress(entry.subscriber)}
                </span>
                <span className="subscription-row__value">
                  {formatXlm(entry.amount)} · {formatNextCharge(entry.nextChargeAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
