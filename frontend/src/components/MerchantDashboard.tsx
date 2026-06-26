import React, { useCallback, useEffect, useState } from "react";
import { getMerchantSubscribers, type MerchantSubscriber, buildBatchChargeTx, simulateBatchCharge, type BatchChargeOutcome, getMerchantRevenue, getMerchantRevenueHistory } from "../stellar";
import { formatAddress, formatXlm } from "../utils/format";
import { usePolling } from "../hooks/usePolling";
import { useTransaction } from "../hooks/useTransaction";
import { useVirtualList } from "../hooks/useVirtualList";
import CopyButton from "./CopyButton";
import RevenueSparkline from "./RevenueSparkline";

const SUBSCRIBER_ROW_HEIGHT = 72;
const SUBSCRIBER_LIST_HEIGHT = 400;

interface Props {
  merchantKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
}

function formatNextCharge(nextChargeAt: number): string {
  const date = new Date(nextChargeAt * 1000);
  return date.toLocaleString();
}

export default function MerchantDashboard({
  merchantKey,
  onSign,
  refreshTrigger,
}: Props) {
  const [subscribers, setSubscribers] = useState<MerchantSubscriber[]>([]);
  const [revenue, setRevenue] = useState<bigint>(0n);
  const [revenueHistory, setRevenueHistory] = useState<bigint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tx = useTransaction();
  const [outcomes, setOutcomes] = useState<Record<string, BatchChargeOutcome>>({});

  const dueSubscribers = subscribers.filter(
    (s) => s.nextChargeAt <= Math.floor(Date.now() / 1000)
  );
  const virtualSubscribers = useVirtualList(
    subscribers,
    SUBSCRIBER_ROW_HEIGHT,
    SUBSCRIBER_LIST_HEIGHT
  );

  const refresh = useCallback(async () => {
    setSubscribers((prev) => {
      if (prev.length === 0) setLoading(true);
      return prev;
    });
    setError(null);

    try {
      const [subData, revData, histData] = await Promise.all([
        getMerchantSubscribers(merchantKey),
        getMerchantRevenue(merchantKey),
        getMerchantRevenueHistory(merchantKey),
      ]);
      setSubscribers(subData);
      setRevenue(revData);
      setRevenueHistory(histData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [merchantKey]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  usePolling({ callback: refresh, interval: 30000, enabled: true });

  const handleBatchCharge = async () => {
    if (dueSubscribers.length === 0) return;

    const users = dueSubscribers.map((s) => s.subscriber);
    setOutcomes({});

    try {
      // 1. Pre-flight simulation to predict outcomes
      const simulationOutcomes = await simulateBatchCharge(merchantKey, users);
      const outcomeMap: Record<string, BatchChargeOutcome> = {};
      users.forEach((u, i) => {
        outcomeMap[u] = simulationOutcomes[i] || "Failed";
      });
      setOutcomes(outcomeMap);

      // 2. Submit transaction
      await tx.submit(async () => {
        return await onSign(await buildBatchChargeTx(merchantKey, users));
      });

      // 3. Success — refresh list to show updated next charge times
      window.setTimeout(refresh, 2000);
    } catch (e) {
      console.error("Batch charge failed:", e);
    }
  };

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
          <h2 className="text-xl font-bold">Merchant Dashboard</h2>
          <p className="text-sm text-muted">
            Manage your subscribers and track your revenue.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card">
          <span className="text-sm text-muted block mb-1">Total Revenue</span>
          <span className="text-2xl font-bold">{formatXlm(revenue)}</span>
        </div>
        <div className="card">
          <span className="text-sm text-muted block mb-2">Last 7 Days Revenue</span>
          <RevenueSparkline history={revenueHistory} />
        </div>
      </div>

      {error && (
        <p className="action-status mb-4" style={{ color: "var(--color-danger)" }}>
          Error: {error}
        </p>
      )}

      {tx.error && (
        <p className="action-status mb-4" style={{ color: "var(--color-danger)" }}>
          Transaction Error: {tx.error}
        </p>
      )}

      {subscribers.length === 0 ? (
        <div className="card">
          <p className="no-sub-text">
            No active subscribers found for {formatAddress(merchantKey)}.
          </p>
        </div>
      ) : (
        <div className="card merchant-subscriber-card">
          <div className="merchant-subscriber-meta mb-4">
            <h3 className="text-lg font-bold">Active Subscribers</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">
                {subscribers.length} total
              </span>
              {dueSubscribers.length > 0 && (
                <span className="badge badge-warning">
                  {dueSubscribers.length} due
                </span>
              )}
            </div>
          </div>

          {dueSubscribers.length > 0 && (
            <div className="mb-6">
              <button
                className="btn-primary w-full"
                onClick={handleBatchCharge}
                disabled={tx.status === "pending"}
              >
                {tx.status === "pending"
                  ? "Processing Batch Charge..."
                  : `Charge ${dueSubscribers.length} due subscriber${
                      dueSubscribers.length !== 1 ? "s" : ""
                    }`}
              </button>
              {tx.status === "success" && (
                <p className="text-sm text-center mt-2" style={{ color: "var(--color-success)" }}>
                  Batch charge submitted successfully!
                </p>
              )}
            </div>
          )}

          <div
            className="subscription-rows merchant-subscriber-list"
            onScroll={virtualSubscribers.onScroll}
            style={{ height: SUBSCRIBER_LIST_HEIGHT }}
          >
            <div
              className="merchant-subscriber-list__spacer"
              style={{ height: virtualSubscribers.totalHeight }}
            >
              <div
                className="merchant-subscriber-list__window"
                style={{ transform: `translateY(${virtualSubscribers.offsetY}px)` }}
              >
                {virtualSubscribers.visibleItems.map(({ item: entry, index }) => (
                  <div
                    className={`subscription-row merchant-subscriber-row${
                      index === subscribers.length - 1 ? " merchant-subscriber-row--last" : ""
                    }`}
                    key={entry.subscriber}
                  >
                    <div className="merchant-row">
                      <span className="merchant-row__address">
                        {formatAddress(entry.subscriber)}
                      </span>
                      <CopyButton text={entry.subscriber} />
                    </div>
                    <div className="merchant-subscriber-value">
                      <span className="subscription-row__value">
                        {formatXlm(entry.amount)}
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        <span className="subscription-row__label">
                          Next charge {formatNextCharge(entry.nextChargeAt)}
                        </span>
                        {outcomes[entry.subscriber] && (
                          <span className={`badge badge-${outcomes[entry.subscriber].toLowerCase()}`}>
                            {outcomes[entry.subscriber]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
