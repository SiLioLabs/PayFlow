import React, { useEffect, useRef, useState } from "react";
import {
  CHARGE_SIM_LABELS,
  ChargeSimResult,
  getSubscriptionHealth,
  isSubscriptionHealthy,
  simulateCharge,
  subscriptionHasWarnings,
  SubscriptionHealth,
} from "../stellar";

interface SubscriptionHealthWidgetProps {
  userKey: string;
  /** When true, also dry-run `simulate_charge` and show the outcome. */
  showSimulateCharge?: boolean;
  onHealthChange?: (health: SubscriptionHealth | null) => void;
  onSimulateResult?: (result: ChargeSimResult | null) => void;
}

export default function SubscriptionHealthWidget({
  userKey,
  showSimulateCharge = false,
  onHealthChange,
  onSimulateResult,
}: SubscriptionHealthWidgetProps) {
  const [health, setHealth] = useState<SubscriptionHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [simResult, setSimResult] = useState<ChargeSimResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const onHealthChangeRef = useRef(onHealthChange);
  onHealthChangeRef.current = onHealthChange;
  const onSimulateResultRef = useRef(onSimulateResult);
  onSimulateResultRef.current = onSimulateResult;

  useEffect(() => {
    let mounted = true;
    const fetchHealth = async () => {
      try {
        setLoading(true);
        const data = await getSubscriptionHealth(userKey);
        if (mounted) {
          setHealth(data);
          setError(!data);
          onHealthChangeRef.current?.(data);
        }
      } catch {
        if (mounted) {
          setError(true);
          setHealth(null);
          onHealthChangeRef.current?.(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchHealth();
    const intervalId = setInterval(fetchHealth, 30000);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [userKey]);

  useEffect(() => {
    if (!showSimulateCharge) {
      setSimResult(null);
      onSimulateResultRef.current?.(null);
      return;
    }

    let mounted = true;
    const fetchSim = async () => {
      try {
        setSimLoading(true);
        const result = await simulateCharge(userKey);
        if (mounted) {
          setSimResult(result);
          onSimulateResultRef.current?.(result);
        }
      } catch {
        if (mounted) {
          setSimResult(null);
          onSimulateResultRef.current?.(null);
        }
      } finally {
        if (mounted) setSimLoading(false);
      }
    };

    fetchSim();
    const intervalId = setInterval(fetchSim, 30000);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [userKey, showSimulateCharge]);

  if (loading && !health) {
    return (
      <div
        className="card"
        data-testid="subscription-health-loading"
        style={{ padding: "var(--space-3)", marginBottom: "var(--space-4)" }}
      >
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

  if (error || !health) {
    return (
      <div
        className="card"
        data-testid="subscription-health-unavailable"
        style={{ padding: "var(--space-3)", marginBottom: "var(--space-4)" }}
      >
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          Unable to load subscription health.
        </p>
      </div>
    );
  }

  const healthy = isSubscriptionHealthy(health);
  const needsAttention = subscriptionHasWarnings(health);
  const simRisky = simResult && simResult !== "WouldSucceed" && simResult !== "NotDue";

  return (
    <div
      className={`card ${healthy && !needsAttention ? "status-active" : "status-danger"}`}
      data-testid="subscription-health-widget"
      data-healthy={healthy && !needsAttention ? "true" : "false"}
      style={{
        padding: "var(--space-3)",
        marginBottom: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <span style={{ fontSize: "1.2rem" }}>{healthy && !needsAttention ? "✅" : "⚠️"}</span>
        <h4 style={{ margin: 0 }} data-testid="subscription-health-status">
          Subscription Health: {healthy && !needsAttention ? "Good" : "Needs Attention"}
        </h4>
      </div>

      {needsAttention && (
        <ul
          data-testid="subscription-health-issues"
          style={{
            margin: 0,
            paddingLeft: "var(--space-5)",
            fontSize: "0.875rem",
            color: "var(--color-text-muted)",
          }}
        >
          {!health.active && <li>Subscription is inactive.</li>}
          {!health.has_sufficient_allowance && <li>Token allowance is insufficient.</li>}
          {health.is_paused && <li>Subscription is currently paused.</li>}
          {health.within_grace && <li>Subscription is in its grace period.</li>}
          {health.charge_due && <li>A payment is currently due.</li>}
        </ul>
      )}

      {health.trial_active && healthy && !needsAttention && (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
          Currently in trial period.
        </p>
      )}

      {showSimulateCharge && simLoading && !simResult && (
        <p
          data-testid="simulate-charge-loading"
          style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" }}
        >
          Checking next charge…
        </p>
      )}

      {showSimulateCharge && simResult && (
        <p
          data-testid="simulate-charge-readout"
          data-sim-result={simResult}
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: simRisky ? "var(--color-danger-text)" : "var(--color-text-muted)",
          }}
        >
          Charge simulation: {CHARGE_SIM_LABELS[simResult]}
        </p>
      )}
    </div>
  );
}
