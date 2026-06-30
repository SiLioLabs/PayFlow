import React from "react";
import SubscriptionRepairPanel from "../components/admin/SubscriptionRepairPanel";
import { useAdmin } from "../hooks/useAdmin";
import Spinner from "../components/Spinner";

interface Props {
  publicKey: string;
  onSign: (xdr: string) => Promise<string>;
}

export default function AdminDashboard({ publicKey, onSign }: Props) {
  const { isAdmin, adminAddress, loading } = useAdmin(publicKey);

  return (
    <div className="dashboard admin-dashboard">
      <header className="flex-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Admin Dashboard</h2>
          <p className="text-sm text-muted">
            Operational tools for contract administration and data-integrity recovery.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex gap-2 items-center text-muted" role="status">
          <Spinner size="sm" />
          <span>Loading admin context…</span>
        </div>
      ) : (
        <p className="text-sm text-muted mb-6">
          {isAdmin
            ? `Authorized as contract admin (${adminAddress?.slice(0, 8)}…).`
            : "Diagnostic tools are available in read-only mode. Repair actions require the contract admin wallet."}
        </p>
      )}

      <div className="card admin-dashboard__section">
        <SubscriptionRepairPanel adminKey={publicKey} onSign={onSign} />
      </div>
    </div>
  );
}
