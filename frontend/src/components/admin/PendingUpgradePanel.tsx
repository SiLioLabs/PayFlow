/**
 * PendingUpgradePanel — displays pending WASM upgrades and provides admin
 * controls to propose, cancel, and commit upgrades with hash confirmation.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  getPendingUpgrade,
  buildProposeUpgradeTx,
  buildCancelPendingUpgradeTx,
  buildCommitUpgradeTx,
  type PendingUpgrade,
} from "../../stellar";
import { friendlyError } from "../../utils/errors";

interface Props {
  adminKey: string;
  onSign: (xdr: string) => Promise<string>;
  isAdmin: boolean;
}

export default function PendingUpgradePanel({ adminKey, onSign, isAdmin }: Props) {
  const [pending, setPending] = useState<PendingUpgrade | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);
  const [showCommit, setShowCommit] = useState(false);
  const [proposeHash, setProposeHash] = useState("");
  const [commitConfirm, setCommitConfirm] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPendingUpgrade(adminKey);
      setPending(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePropose = async () => {
    if (!proposeHash.trim()) {
      setActionStatus("Error: WASM hash is required");
      return;
    }

    const cleanHash = proposeHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(cleanHash)) {
      setActionStatus("Error: Hash must be exactly 64 hex characters (32 bytes)");
      return;
    }

    setActionPending(true);
    setActionStatus(null);
    try {
      const xdr = await buildProposeUpgradeTx(adminKey, cleanHash);
      const hash = await onSign(xdr);
      setActionStatus(`Upgrade proposed! tx: ${hash.slice(0, 12)}…`);
      setProposeHash("");
      setShowPropose(false);
      setTimeout(refresh, 2000);
    } catch (err) {
      const msg = `Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
      setActionStatus(msg);
    } finally {
      setActionPending(false);
    }
  };

  const handleCancel = async () => {
    setActionPending(true);
    setActionStatus(null);
    try {
      const xdr = await buildCancelPendingUpgradeTx(adminKey);
      const hash = await onSign(xdr);
      setActionStatus(`Upgrade cancelled! tx: ${hash.slice(0, 12)}…`);
      setTimeout(refresh, 2000);
    } catch (err) {
      const msg = `Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
      setActionStatus(msg);
    } finally {
      setActionPending(false);
    }
  };

  const handleCommit = async () => {
    if (!pending) return;

    const hashPrefix = pending.wasmHash.slice(0, 8);
    if (commitConfirm !== hashPrefix) {
      setActionStatus(`Error: Type "${hashPrefix}" to confirm`);
      return;
    }

    setActionPending(true);
    setActionStatus(null);
    try {
      const xdr = await buildCommitUpgradeTx(adminKey);
      const hash = await onSign(xdr);
      setActionStatus(`Upgrade committed! tx: ${hash.slice(0, 12)}…`);
      setCommitConfirm("");
      setShowCommit(false);
      setTimeout(refresh, 2000);
    } catch (err) {
      const msg = `Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
      setActionStatus(msg);
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="pending-upgrade-panel" data-testid="pending-upgrade-panel">
      <div className="flex-between mb-4">
        <h3 className="text-lg font-semibold" style={{ margin: 0 }}>
          Pending Upgrade
        </h3>
        <button className="btn-secondary" onClick={refresh} aria-label="Refresh pending upgrade">
          Refresh
        </button>
      </div>

      {loading && <p className="text-muted">Loading pending upgrade…</p>}
      {!loading && error && <p style={{ color: "var(--color-danger)" }} role="alert">Failed to load: {error}</p>}

      {!loading && !error && !pending && (
        <div>
          <p className="text-sm text-muted mb-4">No pending upgrade.</p>
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowPropose(true)} disabled={showPropose}>
              Propose Upgrade
            </button>
          )}
        </div>
      )}

      {!loading && !error && pending && (
        <div>
          <div className="flex-between mb-2">
            <span className="text-sm text-muted">WASM Hash</span>
            <span className="text-sm font-mono">{pending.wasmHash.slice(0, 16)}…</span>
          </div>
          <div className="text-xs text-muted mb-4">
            <p>Verify the hash before committing:</p>
            <code>soroban contract install --wasm /path/to/contract.wasm</code>
          </div>

          {isAdmin && (
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={handleCancel} disabled={actionPending}>
                {actionPending ? "Cancelling…" : "Cancel"}
              </button>
              <button className="btn-primary" onClick={() => setShowCommit(true)} disabled={actionPending || showCommit}>
                Commit Upgrade
              </button>
            </div>
          )}
        </div>
      )}

      {showPropose && (
        <div className="modal-overlay" onClick={() => setShowPropose(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Propose Upgrade</h3>
            <div className="form-group">
              <label className="form-label">WASM Hash (64 hex chars)</label>
              <input
                type="text"
                className="input"
                value={proposeHash}
                onChange={(e) => setProposeHash(e.target.value)}
                placeholder="e.g., abc123..."
                maxLength={64}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setShowPropose(false)}>Cancel</button>
              <button className="btn-primary" onClick={handlePropose} disabled={actionPending}>
                {actionPending ? "Proposing…" : "Propose"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCommit && pending && (
        <div className="modal-overlay" onClick={() => setShowCommit(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Commit Upgrade</h3>
            <p className="text-sm text-muted mb-4">
              Type the first 8 characters of the hash to confirm: <strong>{pending.wasmHash.slice(0, 8)}</strong>
            </p>
            <div className="form-group">
              <input
                type="text"
                className="input"
                value={commitConfirm}
                onChange={(e) => setCommitConfirm(e.target.value)}
                placeholder="Hash prefix"
                maxLength={8}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setShowCommit(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCommit} disabled={actionPending}>
                {actionPending ? "Committing…" : "Commit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionStatus && (
        <p className={`form-status mt-4${actionStatus.startsWith("Error") ? " text-error" : ""}`}>
          {actionStatus}
        </p>
      )}
    </div>
  );
}
