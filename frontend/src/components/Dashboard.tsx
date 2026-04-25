import React, { useEffect, useState } from "react";
import {
  getSubscription,
  buildCancelTx,
  buildPayPerUseTx,
  getEvents,
} from "../stellar";
import { friendlyError } from "../utils/errors";
import SubscriptionCardSkeleton from "./Skeleton";
import { useSubscription } from "../hooks/useSubscription";

// ✅ FIX: Missing imports added
import SubscriptionCard from "./SubscriptionCard";
import PayPerUseForm from "./PayPerUseForm";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  refreshTrigger: number;
}

function formatInterval(secs: number): string {
  if (secs >= 2_592_000) return `${Math.round(secs / 2_592_000)}mo`;
  if (secs >= 604_800) return `${Math.round(secs / 604_800)}w`;
  if (secs >= 86_400) return `${Math.round(secs / 86_400)}d`;
  return `${secs}s`;
}

export default function Dashboard({ userKey, onSign, refreshTrigger }: Props) {
  const {
    subscription: sub,
    loading,
    refresh,
  } = useSubscription(userKey, refreshTrigger);

  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [ppuLoading, setPpuLoading] = useState(false);

  // 🔥 Transaction history state
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  // 🔥 Fetch events
  useEffect(() => {
    async function fetchEvents() {
      if (!userKey) return;

      setEventsLoading(true);
      try {
        const data = await getEvents(userKey);
        setEvents(data);
      } catch (e) {
        console.error("Failed to fetch events:", e);
        setEvents([]);
      } finally {
        setEventsLoading(false);
      }
    }

    fetchEvents();
  }, [userKey, refreshTrigger]);

  async function handleCancel() {
    setActionStatus(null);
    try {
      const xdr = await buildCancelTx(userKey);
      const hash = await onSign(xdr);
      setActionStatus(`Cancelled. tx: ${hash.slice(0, 12)}…`);
      refresh();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      setActionStatus(`Error: ${friendlyError(rawMessage)}`);
    }
  }

  async function handlePayPerUse(stroops: bigint) {
    setActionStatus(null);
    setPpuLoading(true);
    try {
      const xdr = await buildPayPerUseTx(userKey, stroops);
      const hash = await onSign(xdr);
      setActionStatus(`Paid! tx: ${hash.slice(0, 12)}…`);
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      setActionStatus(`Error: ${friendlyError(rawMessage)}`);
    } finally {
      setPpuLoading(false);
    }
  }

  if (loading) return <SubscriptionCardSkeleton />;

  return (
    <div className="dashboard">
      {!sub ? (
        <div className="card">
          <p className="no-sub-text">No active subscription found.</p>
        </div>
      ) : (
        <>
          <SubscriptionCard subscription={sub} onCancel={handleCancel} />

          {sub.active && (
            <PayPerUseForm onPay={handlePayPerUse} loading={ppuLoading} />
          )}
        </>
      )}

      {actionStatus && (
        <p
          className="action-status"
          style={{
            color: actionStatus.startsWith("Error")
              ? "var(--color-danger)"
              : "var(--color-success)",
          }}
        >
          {actionStatus}
        </p>
      )}

      {/* 🔥 Transaction History */}
      <div className="transaction-history">
        <h3>Transaction History</h3>

        {eventsLoading ? (
          <p>Loading...</p>
        ) : events.length === 0 ? (
          <p>No transactions yet.</p>
        ) : (
          <div className="history-list">
            {events.map((event, index) => (
              <div key={index} className="history-item">
                <span className="type">{event.type}</span>
                <span className="amount">{event.amount}</span>
                <span className="time">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}