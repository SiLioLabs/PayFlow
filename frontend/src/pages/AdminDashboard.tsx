import React from "react";
import SystemHealthCard from "../components/SystemHealthCard";
import SubscriptionRepairPanel from "../components/admin/SubscriptionRepairPanel";

interface Props {
  callerKey: string;
  onSign: (xdr: string) => Promise<string>;
}

export default function AdminDashboard({ callerKey, onSign }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <SystemHealthCard callerKey={callerKey} />
      <SubscriptionRepairPanel callerKey={callerKey} onSign={onSign} />
    </div>
  );
}
