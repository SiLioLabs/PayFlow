import React, { useCallback, useState } from "react";
import { getSubscriptionToken, getReferral, getReferrer, getSubscriptionHealth } from "../stellar";
import Spinner from "./Spinner";

type ExportFormat = "csv" | "json";

export const EXPORT_SCHEMA_VERSION = 1;

/**
 * Stable documented headers list.
 * Any additions must increment EXPORT_SCHEMA_VERSION.
 */
export const EXPORT_HEADERS = [
  "_schema_version",
  "subscriber",
  "merchant",
  "amount_stroops",
  "interval_seconds",
  "last_charged",
  "next_charge_at",
  "active",
  "paused",
  "trial_duration",
  "label",
  "token",
  "referral",
  "referrer",
  "health_active",
  "health_paused",
  "health_charge_due",
  "health_has_sufficient_allowance",
] as const;

// ── Serialisation helpers ─────────────────────────────────────────────────────

/** Escape a CSV cell: wrap in quotes when it contains a comma, quote, or newline. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCSV(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";

  const rows = records.map((row) =>
    EXPORT_HEADERS.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) {
        return "";
      }
      return csvEscape(String(val));
    }).join(",")
  );

  return [EXPORT_HEADERS.map(csvEscape).join(","), ...rows].join("\r\n");
}

function toJSON(records: Record<string, unknown>[]): string {
  return JSON.stringify(records, null, 2);
}

// ── Download trigger ─────────────────────────────────────────────────────────

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
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

// ── Component ────────────────────────────────────────────────────────────────

interface SubscriptionExportProps {
  /** Rows to export. Each element should have a 'subscriber' field. */
  data: Record<string, unknown>[];
  /** Base filename (without extension). */
  filename?: string;
  /** Button label override. */
  label?: string;
  /** Optional extra class names. */
  className?: string;
}

export default function SubscriptionExport({
  data,
  filename = "export",
  label = "Export",
  className,
}: SubscriptionExportProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = useCallback(async () => {
    if (data.length === 0 || exporting) return;

    setExporting(true);
    try {
      // Enrich each record with on-chain data
      const enrichedRecords = await Promise.all(
        data.map(async (record) => {
          const subscriber = String(record.subscriber || "");
          let token: string | null = null;
          let referral: string | null = null;
          let referrer: string | null = null;
          let healthActive: boolean | null = null;
          let healthPaused: boolean | null = null;
          let healthChargeDue: boolean | null = null;
          let healthSufficientAllowance: boolean | null = null;

          if (subscriber) {
            const [tokenRes, referralRes, referrerRes, healthRes] = await Promise.all([
              getSubscriptionToken(subscriber),
              getReferral(subscriber),
              getReferrer(subscriber),
              getSubscriptionHealth(subscriber),
            ]);
            token = tokenRes;
            referral = referralRes;
            referrer = referrerRes;
            if (healthRes) {
              healthActive = healthRes.active;
              healthPaused = healthRes.is_paused;
              healthChargeDue = healthRes.charge_due;
              healthSufficientAllowance = healthRes.has_sufficient_allowance;
            }
          }

          // Build a normalized object following the stable EXPORT_HEADERS policy
          const enriched: Record<string, unknown> = {};
          for (const header of EXPORT_HEADERS) {
            if (header === "_schema_version") {
              enriched[header] = EXPORT_SCHEMA_VERSION;
            } else if (header === "token") {
              enriched[header] = token;
            } else if (header === "referral") {
              enriched[header] = referral;
            } else if (header === "referrer") {
              enriched[header] = referrer;
            } else if (header === "health_active") {
              enriched[header] = healthActive;
            } else if (header === "health_paused") {
              enriched[header] = healthPaused;
            } else if (header === "health_charge_due") {
              enriched[header] = healthChargeDue;
            } else if (header === "health_has_sufficient_allowance") {
              enriched[header] = healthSufficientAllowance;
            } else {
              // Preserve original field or default to null
              enriched[header] = record[header] !== undefined ? record[header] : null;
            }
          }
          return enriched;
        })
      );

      const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const fullFilename = `${filename}-${timestamp}.${format}`;

      if (format === "csv") {
        triggerDownload(toCSV(enrichedRecords), fullFilename, "text/csv;charset=utf-8;");
      } else {
        triggerDownload(toJSON(enrichedRecords), fullFilename, "application/json");
      }

      setExported(true);
      setTimeout(() => setExported(false), 2000);
    } catch (err) {
      console.error("Export enrichment failed:", err);
    } finally {
      setExporting(false);
    }
  }, [data, filename, format, exporting]);

  const isEmpty = data.length === 0;

  return (
    <div className={`subscription-export${className ? ` ${className}` : ""}`}>
      <div className="subscription-export__controls">
        <div className="subscription-export__format-group" role="group" aria-label="Export format">
          <label className="subscription-export__format-label">
            <input
              type="radio"
              name={`export-format-${filename}`}
              value="csv"
              checked={format === "csv"}
              onChange={() => setFormat("csv")}
              className="subscription-export__radio"
              disabled={exporting}
            />
            <span>CSV</span>
          </label>
          <label className="subscription-export__format-label">
            <input
              type="radio"
              name={`export-format-${filename}`}
              value="json"
              checked={format === "json"}
              onChange={() => setFormat("json")}
              className="subscription-export__radio"
              disabled={exporting}
            />
            <span>JSON</span>
          </label>
        </div>

        <button
          className="btn-secondary subscription-export__btn"
          onClick={handleExport}
          disabled={isEmpty || exporting}
          type="button"
          title={
            isEmpty
              ? "No data to export"
              : exporting
                ? "Fetching on-chain data..."
                : `Download ${format.toUpperCase()}`
          }
          aria-label={
            exporting ? "Enriching and downloading..." : `${label} as ${format.toUpperCase()}`
          }
        >
          {exporting ? (
            <span className="flex gap-2 items-center">
              <Spinner size="sm" />
              Exporting…
            </span>
          ) : exported ? (
            "✓ Downloaded"
          ) : (
            `${label} (${format.toUpperCase()})`
          )}
        </button>
      </div>

      {isEmpty && (
        <p className="text-xs text-muted subscription-export__empty">
          No data available to export.
        </p>
      )}
    </div>
  );
}
