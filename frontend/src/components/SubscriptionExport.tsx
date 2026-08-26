/**
 * SubscriptionExport — CSV / JSON export for subscription data.
 *
 * Accepts a generic list of records (subscriptions for a subscriber, or
 * subscriber rows for a merchant) and lets the user download either a
 * comma-separated CSV file or a pretty-printed JSON file.
 *
 * Usage (subscriber dashboard):
 *   <SubscriptionExport
 *     data={[subscription]}
 *     filename="my-subscription"
 *   />
 *
 * Usage (merchant dashboard):
 *   <SubscriptionExport
 *     data={subscribers}
 *     filename="subscribers"
 *     label="Export Subscribers"
 *   />
 */
import React, { useCallback, useState } from "react";

type ExportFormat = "csv" | "json";

// ── Serialisation helpers ─────────────────────────────────────────────────────

/**
 * Flatten one record to a simple key → string map for CSV.
 * Nested objects are serialised as JSON strings so the cell remains valid.
 */
function flattenRecord(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out[k] = "";
    } else if (typeof v === "object") {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/** Escape a CSV cell: wrap in quotes when it contains a comma, quote, or newline. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCSV(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";

  const flattened = records.map(flattenRecord);
  const headers = Object.keys(flattened[0]);
  const rows = flattened.map((row) => headers.map((h) => csvEscape(row[h] ?? "")).join(","));

  return [headers.map(csvEscape).join(","), ...rows].join("\r\n");
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
  /** Rows to export. Each element should be a plain object. */
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
  const [exported, setExported] = useState(false);

  const handleExport = useCallback(() => {
    if (data.length === 0) return;

    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const fullFilename = `${filename}-${timestamp}.${format}`;

    if (format === "csv") {
      triggerDownload(toCSV(data), fullFilename, "text/csv;charset=utf-8;");
    } else {
      triggerDownload(toJSON(data), fullFilename, "application/json");
    }

    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [data, filename, format]);

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
            />
            <span>JSON</span>
          </label>
        </div>

        <button
          className="btn-secondary subscription-export__btn"
          onClick={handleExport}
          disabled={isEmpty}
          type="button"
          title={isEmpty ? "No data to export" : `Download ${format.toUpperCase()}`}
          aria-label={`${label} as ${format.toUpperCase()}`}
        >
          {exported ? "✓ Downloaded" : `${label} (${format.toUpperCase()})`}
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
