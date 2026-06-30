import React, { useState, useEffect } from "react";
import AddressInput from "../../components/AddressInput";
import { useWallet } from "../../hooks/useWallet";
import { getContractAdmin, validateSubscription, buildRepairSubscriptionTx, server, CONTRACT_ID } from "../../stellar";

interface Props {
  callerKey: string;
  onSign: (xdr: string) => Promise<string>;
}

export default function SubscriptionRepairPanel({ callerKey, onSign }: Props) {
  const { publicKey } = useWallet();
  const [target, setTarget] = useState("");
  const [issues, setIssues] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [adminAddr, setAdminAddr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const a = await getContractAdmin();
      if (mounted) setAdminAddr(a);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleValidate() {
    setIssues(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await validateSubscription(callerKey, target);
      setIssues(res || []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleRepair() {
    setMessage(null);
    if (!publicKey) {
      setMessage("Connect Freighter as the admin to perform repair.");
      return;
    }
    if (publicKey !== adminAddr) {
      setMessage("Connected wallet is not the configured contract admin.");
      return;
    }

    if (!window.confirm(`Repair subscription for ${target}? This will perform an on-chain admin action.`)) return;

    setLoading(true);
    try {
      const xdr = await buildRepairSubscriptionTx(publicKey, target);
      const txHash = await onSign(xdr);

      // Try to fetch contract events for this tx to extract any details.
      try {
        const evts = await server.getEvents({
          filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
          limit: 1000,
        });
        const related = evts.events.filter((e: any) => e.txHash === txHash);
        if (related.length > 0) {
          setMessage(`Repair succeeded — ${related.length} contract events emitted. Tx: ${txHash}`);
        } else {
          setMessage(`Repair succeeded. Tx: ${txHash}`);
        }
      } catch {
        setMessage(`Repair succeeded. Tx: ${txHash}`);
      }

      // Refresh issues after repair
      try {
        const after = await validateSubscription(callerKey, target);
        setIssues(after || []);
      } catch {
        // ignore
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const isAdminConnected = !!publicKey && adminAddr && publicKey === adminAddr;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="flex-between">
        <h3 style={{ margin: 0 }}>Subscription Repair</h3>
      </div>

      <AddressInput label="Subscriber address" value={target} onChange={setTarget} />

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={handleValidate} disabled={!target || loading}>
          Validate
        </button>
        <button
          className="btn-danger"
          onClick={handleRepair}
          disabled={!issues || issues.length === 0 || !isAdminConnected || loading}
          title={isAdminConnected ? undefined : "Requires admin wallet"}
        >
          Repair on-chain
        </button>
      </div>

      {loading && <p className="text-muted">Working…</p>}

      {message && <p className="text-sm" style={{ color: "var(--color-muted)" }}>{message}</p>}

      {issues && (
        <div>
          <h4 style={{ marginBottom: 6 }}>Validation results</h4>
          {issues.length === 0 ? (
            <p className="text-success">No issues found.</p>
          ) : (
            <ul>
              {issues.map((it, idx) => (
                <li key={idx} style={{ color: "var(--color-danger)" }}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!adminAddr && <p className="text-muted">Loading contract admin…</p>}
      {adminAddr && <p className="text-muted">Contract admin: {adminAddr}</p>}
    </div>
  );
}
