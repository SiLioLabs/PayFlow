import React from "react";
import type { TxSimulationPreview } from "../stellar";

interface TransactionPreviewProps {
  preview: TxSimulationPreview | null;
  loading?: boolean;
  error?: string | null;
  override?: boolean;
  onOverrideChange?: (value: boolean) => void;
}

/** Displays the simulated fee and any predicted contract failure before signing. */
export default function TransactionPreview({
  preview,
  loading = false,
  error = null,
  override = false,
  onOverrideChange,
}: TransactionPreviewProps) {
  return (
    <div className="tx-simulation-preview" data-testid="tx-simulation-preview">
      {loading && (
        <p className="text-muted text-sm" role="status" data-testid="tx-preview-loading">
          Simulating transaction…
        </p>
      )}

      {!loading && error && (
        <p className="text-muted text-sm" role="status" data-testid="tx-preview-error-rpc">
          Simulation unavailable: {error}
        </p>
      )}

      {!loading && preview?.feeXlm && (
        <p className="text-sm" data-testid="tx-preview-fee">
          Estimated fee: <strong>{preview.feeXlm} XLM</strong>
          {preview.feeStroops !== null && (
            <span className="text-muted"> ({preview.feeStroops} stroops)</span>
          )}
        </p>
      )}

      {!loading && preview && !preview.feeXlm && !preview.rpcError && (
        <p className="text-muted text-sm" data-testid="tx-preview-fee-unavailable">
          Fee estimate unavailable.
        </p>
      )}

      {!loading && preview?.errorMessage && (
        <div
          className="card"
          role="alert"
          data-testid="tx-preview-failure"
          style={{
            background: "var(--color-danger-bg)",
            border: "1px solid var(--color-danger)",
            padding: "8px 12px",
            marginTop: 8,
          }}
        >
          <p className="text-sm" style={{ color: "var(--color-danger-text)" }}>
            <strong>Simulation detected a problem:</strong> {preview.errorMessage}
            {preview.errorCode && (
              <span className="text-muted"> ({preview.errorCode})</span>
            )}
          </p>
          {preview.overrideAllowed && onOverrideChange && (
            <label className="text-sm" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => onOverrideChange(e.target.checked)}
                data-testid="tx-preview-override"
              />
              I understand and want to continue anyway.
            </label>
          )}
          {!preview.overrideAllowed && (
            <p className="text-xs text-muted" data-testid="tx-preview-blocked">
              Signing is blocked. Resolve this issue before continuing.
              {override && " The override is not available for this error."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
