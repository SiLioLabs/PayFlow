import React, { useState } from "react";
import { getMerchantRevenueDays } from "../stellar";
import { stroopsToXlm } from "../utils/format";
import { useToast } from "../hooks/useToast";
import { toCSV } from "./SubscriptionExport";

const REVENUE_HEADERS = ["record_type", "date_utc", "revenue_stroops", "revenue_xlm"] as const;

export function revenueToCSV(
  days: { day: number; amount: bigint }[],
  totalRevenue: bigint
): string {
  return toCSV(
    [
      {
        record_type: "total",
        date_utc: "",
        revenue_stroops: totalRevenue.toString(),
        revenue_xlm: stroopsToXlm(totalRevenue),
      },
      ...days.map(({ day, amount }) => ({
        record_type: "daily",
        date_utc: new Date(day * 86_400_000).toISOString().slice(0, 10),
        revenue_stroops: amount.toString(),
        revenue_xlm: stroopsToXlm(amount),
      })),
    ],
    REVENUE_HEADERS
  );
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

interface RevenueExportProps {
  merchantKey: string;
  totalRevenue: bigint;
}

export default function RevenueExport({ merchantKey, totalRevenue }: RevenueExportProps) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const exportRevenue = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const days = await getMerchantRevenueDays(merchantKey);
      downloadCSV(
        revenueToCSV(days, totalRevenue),
        `merchant-revenue-${merchantKey.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      addToast(`Revenue export failed: ${message}`, "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card">
      <div className="flex-between">
        <div>
          <h3 className="text-lg font-semibold">Revenue history</h3>
          <p className="text-sm text-muted">
            Export daily revenue in stroops and XLM for accounting.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={exportRevenue}
          disabled={exporting}
          data-testid="export-revenue"
        >
          {exporting ? "Preparing CSV…" : "Export Revenue CSV"}
        </button>
      </div>
      {error && (
        <p className="text-xs text-danger mt-2" role="alert" data-testid="revenue-export-error">
          Revenue export failed: {error}
        </p>
      )}
    </div>
  );
}
