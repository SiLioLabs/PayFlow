import React, { useCallback, useEffect, useState } from "react";
import { getContractHealth, type ContractHealthReport } from "../stellar";
import { useRpcHealthContext } from "../context/RpcHealthContext";
import RpcSettings from "./RpcSettings";

interface Props {
  callerKey: string;
}

type StatusLevel = "green" | "yellow" | "red";

function statusBadge(level: StatusLevel, label: string) {
  const colors: Record<StatusLevel, string> = {
    green: "var(--color-success, #22c55e)",
    yellow: "var(--color-warning, #eab308)",
    red: "var(--color-danger, #ef4444)",
  };
  const icons: Record<StatusLevel, string> = { green: "✓", yellow: "⚠", red: "✕" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "9999px",
        fontSize: "12px",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: colors[level],
      }}
    >
      {icons[level]} {label}
    </span>
  );
}

export default function SystemHealthCard({ callerKey }: Props) {
  const [report, setReport] = useState<ContractHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRpcSettings, setShowRpcSettings] = useState(false);

  const { activeRpcUrl } = useRpcHealthContext();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getContractHealth(callerKey);
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callerKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="card">
        <p className="text-muted">Fetching contract health…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p style={{ color: "var(--color-danger)" }}>Health check failed: {error}</p>
        <button className="btn-secondary" onClick={refresh} style={{ marginTop: "8px" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!report) return null;

  const rpcLevel: StatusLevel = report.rpcReachable ? "green" : "red";
  const pauseLevel: StatusLevel = report.contractPaused ? "red" : "green";
  const tokenLevel: StatusLevel = report.tokenConfigured ? "green" : "yellow";

  return (
    <>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div className="flex-between">
          <h3 style={{ margin: 0 }}>System Health</h3>
          <button className="btn-secondary" onClick={refresh} aria-label="Refresh health status">
            Refresh
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* RPC Endpoint row — shows URL + Change button */}
          <div className="flex-between" style={{ alignItems: "flex-start", gap: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
              <span className="text-sm">RPC Endpoint</span>
              <code
                data-testid="system-health-rpc-url"
                style={{
                  fontSize: "11px",
                  wordBreak: "break-all",
                  color: "var(--color-muted)",
                  maxWidth: "280px",
                  display: "block",
                }}
                title={activeRpcUrl}
              >
                {activeRpcUrl}
              </code>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              {statusBadge(rpcLevel, report.rpcReachable ? "Reachable" : "Unreachable")}
              <button
                className="btn-secondary"
                style={{ fontSize: "12px", padding: "2px 10px" }}
                onClick={() => setShowRpcSettings(true)}
                data-testid="rpc-change-btn"
                aria-label="Change RPC endpoint"
              >
                Change
              </button>
            </div>
          </div>

          <div className="flex-between">
            <span className="text-sm">Contract State</span>
            {statusBadge(pauseLevel, report.contractPaused ? "Paused" : "Active")}
          </div>
          <div className="flex-between">
            <span className="text-sm">Token Setup</span>
            {statusBadge(tokenLevel, report.tokenConfigured ? "Configured" : "Not configured")}
          </div>
          <div className="flex-between">
            <span className="text-sm">Active Subscriptions</span>
            <span className="text-sm font-semibold">{report.activeSubscriptions}</span>
          </div>
        </div>

        <p className="text-muted" style={{ fontSize: "11px", margin: 0 }}>
          Last checked: {report.checkedAt.toLocaleTimeString()}
        </p>
      </div>

      {showRpcSettings && <RpcSettings onClose={() => setShowRpcSettings(false)} />}
    </>
  );
}
