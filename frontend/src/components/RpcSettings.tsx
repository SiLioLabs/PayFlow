/**
 * RpcSettings — modal that lets users configure a custom RPC endpoint.
 *
 * - Validates the URL (must be HTTP/HTTPS; HTTPS preferred)
 * - Persists the choice to localStorage via RpcHealthContext
 * - Shows a warning for HTTP (non-HTTPS) URLs
 * - "Reset to default" clears the custom URL and falls back to VITE_RPC_URL
 */
import React, { useRef, useState, useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRpcHealthContext, validateRpcUrl, normalizeRpcUrl } from "../context/RpcHealthContext";
import { RPC_URL } from "../stellar";

interface Props {
  onClose: () => void;
}

export default function RpcSettings({ onClose }: Props) {
  const { customRpcUrl, setCustomRpcUrl, activeRpcUrl } = useRpcHealthContext();

  const [inputValue, setInputValue] = useState(customRpcUrl ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [httpWarning, setHttpWarning] = useState(false);
  const [saved, setSaved] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true, onClose);

  // Keep validation state in sync as the user types
  useEffect(() => {
    if (!inputValue.trim()) {
      setValidationError(null);
      setHttpWarning(false);
      return;
    }
    const { valid, error } = validateRpcUrl(inputValue);
    setValidationError(valid ? null : error);
    setHttpWarning(valid && inputValue.trim().startsWith("http://"));
  }, [inputValue]);

  function handleSave() {
    const trimmed = inputValue.trim();

    if (!trimmed) {
      // Empty input = clear custom URL (revert to default)
      setCustomRpcUrl(null);
      setSaved(true);
      setTimeout(onClose, 800);
      return;
    }

    const { valid, error } = validateRpcUrl(trimmed);
    if (!valid) {
      setValidationError(error);
      return;
    }

    const normalized = normalizeRpcUrl(trimmed);
    setCustomRpcUrl(normalized);
    setSaved(true);
    setTimeout(onClose, 800);
  }

  function handleReset() {
    setCustomRpcUrl(null);
    setInputValue("");
    setSaved(true);
    setTimeout(onClose, 800);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
  }

  const defaultUrl = RPC_URL;
  const isUsingDefault = !customRpcUrl;

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="rpc-settings-overlay">
      <div
        ref={modalRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpc-settings-title"
      >
        <h3 id="rpc-settings-title">RPC Endpoint Settings</h3>

        <p className="text-muted" style={{ fontSize: "13px", marginTop: 0 }}>
          The app connects to a Stellar Soroban RPC node to submit and query transactions. You can
          override the default endpoint if it is down or unreachable.
        </p>

        <div
          style={{
            background: "var(--color-surface, rgba(255,255,255,0.05))",
            borderRadius: "6px",
            padding: "8px 12px",
            fontSize: "12px",
            marginBottom: "12px",
          }}
        >
          <span className="text-muted">Current active URL: </span>
          <code style={{ wordBreak: "break-all", fontSize: "11px" }} data-testid="active-rpc-url">
            {activeRpcUrl}
          </code>
          {isUsingDefault && (
            <span
              style={{
                marginLeft: "6px",
                fontSize: "11px",
                color: "var(--color-success, #22c55e)",
              }}
            >
              (default)
            </span>
          )}
        </div>

        <label className="form-group">
          <span className="form-label" id="rpc-url-label">
            Custom RPC URL
          </span>
          <input
            type="url"
            aria-labelledby="rpc-url-label"
            aria-describedby={
              validationError ? "rpc-url-error" : httpWarning ? "rpc-url-warning" : undefined
            }
            aria-invalid={validationError !== null}
            placeholder={defaultUrl}
            value={inputValue}
            onChange={(e) => {
              setSaved(false);
              setInputValue(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            data-testid="rpc-url-input"
            style={{ fontFamily: "monospace", fontSize: "13px" }}
          />
        </label>

        {validationError && (
          <p
            id="rpc-url-error"
            className="text-error"
            role="alert"
            data-testid="rpc-url-error"
            style={{ marginTop: "4px", fontSize: "13px" }}
          >
            {validationError}
          </p>
        )}

        {httpWarning && !validationError && (
          <p
            id="rpc-url-warning"
            role="alert"
            data-testid="rpc-url-http-warning"
            style={{
              marginTop: "4px",
              fontSize: "13px",
              color: "var(--color-warning, #eab308)",
            }}
          >
            ⚠️ HTTP (non-HTTPS) connections are insecure. Use HTTPS when possible.
          </p>
        )}

        {saved && (
          <p
            role="status"
            data-testid="rpc-url-saved"
            style={{
              marginTop: "4px",
              fontSize: "13px",
              color: "var(--color-success, #22c55e)",
            }}
          >
            ✓ Saved — reconnecting…
          </p>
        )}

        <p style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "8px" }}>
          Leave blank to use the default endpoint. Changes take effect immediately.
        </p>

        <div className="modal-actions">
          {customRpcUrl && (
            <button
              className="btn-secondary"
              onClick={handleReset}
              data-testid="rpc-reset-btn"
              aria-label="Reset to default RPC URL"
            >
              Reset to default
            </button>
          )}
          <button className="btn-secondary" onClick={onClose} data-testid="rpc-cancel-btn">
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!!validationError}
            data-testid="rpc-save-btn"
            aria-label="Save custom RPC URL"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
