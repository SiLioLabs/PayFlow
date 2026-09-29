/**
 * ProtocolStatsPanel — read-only aggregate view of protocol-wide stats for
 * operators: active subscription count, fee, grace period, pause state,
 * and schema version. Backed by the contract's `get_protocol_stats` and
 * `contract_health_check` read-only methods.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  getProtocolStats,
  getContractHealthCheck,
  type ProtocolStats,
  type ContractHealthCheckReport,
} from "../../stellar";

interface Props {
  callerKey: string;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-between">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

export default function ProtocolStatsPanel({ callerKey }: Props) {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [health, setHealth] = useState<ContractHealthCheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsResult, healthResult] = await Promise.all([
        getProtocolStats(callerKey),
        getContractHealthCheck(callerKey),
      ]);
      setStats(statsResult);
      setHealth(healthResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callerKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="protocol-stats-panel" data-testid="protocol-stats-panel">
      <div className="flex-between mb-4">
        <h3 className="text-lg font-semibold" style={{ margin: 0 }}>
          Protocol Stats
        </h3>
        <button className="btn-secondary" onClick={refresh} aria-label="Refresh protocol stats">
          Refresh
        </button>
      </div>

      {loading && (
        <p className="text-muted" data-testid="protocol-stats-loading">
          Loading protocol stats…
        </p>
      )}

      {!loading && error && (
        <p style={{ color: "var(--color-danger)" }} role="alert">
          Failed to load protocol stats: {error}
        </p>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <Stat
            label="Active subscriptions"
            value={
              stats
                ? stats.activeCount.toString()
                : health
                  ? health.activeSubscriptionCount.toString()
                  : "—"
            }
          />
          <Stat label="Fee (bps)" value={stats ? stats.feeBps.toString() : "—"} />
          <Stat
            label="Grace period (s)"
            value={stats ? stats.gracePeriod.toString() : "—"}
          />
          <Stat
            label="Contract state"
            value={
              (stats?.contractPaused ?? health?.contractPaused) === true ? "Paused" : "Active"
            }
          />
          <Stat
            label="Whitelist enabled"
            value={stats ? (stats.whitelistEnabled ? "Yes" : "No") : "—"}
          />
          <Stat
            label="Schema version"
            value={
              stats
                ? stats.schemaVersion.toString()
                : health
                  ? health.schemaVersion.toString()
                  : "—"
            }
          />
          {health && (
            <>
              <Stat label="Overall health" value={health.isHealthy ? "Healthy" : "Attention needed"} />
              <Stat label="Token configured" value={health.tokenConfigured ? "Yes" : "No"} />
              <Stat label="Admin configured" value={health.adminConfigured ? "Yes" : "No"} />
              <Stat label="Fee collector set" value={health.feeCollectorSet ? "Yes" : "No"} />
              <Stat
                label="Global volume utilization"
                value={`${health.globalVolumeUtilizationPct}%`}
              />
              <Stat
                label="Pending merchant payouts"
                value={health.pendingMerchantRevCount.toString()}
              />
              <Stat label="Instance TTL (ledgers)" value={health.instanceTtlLedgers.toString()} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
