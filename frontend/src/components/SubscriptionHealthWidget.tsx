import React, { useEffect, useState } from "react";
import { getSubscriptionHealth, SubscriptionHealth } from "../stellar";

interface SubscriptionHealthWidgetProps {
  userKey: string;
}

export default function SubscriptionHealthWidget({ userKey }: SubscriptionHealthWidgetProps) {
  const [health, setHealth] = useState<SubscriptionHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchHealth = async () => {
      try {
        setLoading(true);
        const data = await getSubscriptionHealth(userKey);
        if (mounted) {
          setHealth(data);
          setError(!data);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchHealth();
    const intervalId = setInterval(fetchHealth, 30000); // Poll every 30s
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [userKey]);

  if (loading && !health) {
    return (
      <div className="card" style={{ padding: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <div
            className="skeleton-block"
            style={{ width: "20px", height: "20px", borderRadius: "50%" }}
          ></div>
          <div className="skeleton-block" style={{ width: "100px", height: "20px" }}></div>
        </div>
      </div>
    );
  }

  if (error || !health) return null;

  const isHealthy = health.charged_up && health.allowance_ok && !health.paused;

  return (
    <div
      className={`card ${isHealthy ? "status-active" : "status-danger"}`}
      style={{
        padding: "var(--space-3)",
        marginBottom: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ fontSize: "1.2rem" }}>{isHealthy ? "✅" : "⚠️"}</span>
        <h4 style={{ margin: 0 }}>Subscription Health: {isHealthy ? "Good" : "Needs Attention"}</h4>
      </div>

      {!isHealthy && (
        <ul
          style={{
            margin: 0,
            paddingLeft: "var(--space-5)",
            fontSize: "0.875rem",
            color: "var(--color-text-muted)",
          }}
        >
          {!health.charged_up && <li>Balance is too low for the next charge.</li>}
          {!health.allowance_ok && <li>Token allowance is insufficient.</li>}
          {health.paused && <li>Subscription is currently paused.</li>}
          {health.charge_due && <li>A payment is currently due.</li>}
        </ul>
      )}

      {health.trial_active && isHealthy && (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          Currently in trial period.
        </p>
      )}
    </div>
  );
}
