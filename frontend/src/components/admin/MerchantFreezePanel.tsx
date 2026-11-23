/**
 * MerchantFreezePanel — admin controls for freezing and unfreezing merchants
 * with optional reason display.
 */
import React, { useState } from "react";
import {
  buildFreezeMerchantTx,
  buildUnfreezeMerchantTx,
  getMerchantFreezeReason,
} from "../../stellar";
import { isValidStellarAddress } from "../../utils/addressValidation";
import { friendlyError } from "../../utils/errors";

interface Props {
  adminKey: string;
  onSign: (xdr: string) => Promise<string>;
  isAdmin: boolean;
}

export default function MerchantFreezePanel({ adminKey, onSign, isAdmin }: Props) {
  const [merchantAddress, setMerchantAddress] = useState("");
  const [freezeReason, setFreezeReason] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [checkReason, setCheckReason] = useState("");
  const [displayReason, setDisplayReason] = useState<string | null>(null);
  const [checkingReason, setCheckingReason] = useState(false);

  const handleFreeze = async () => {
    if (!merchantAddress.trim() || !isValidStellarAddress(merchantAddress.trim())) {
      setActionStatus("Error: Invalid merchant address");
      return;
    }

    if (freezeReason.trim() && new TextEncoder().encode(freezeReason.trim()).length > 128) {
      setActionStatus("Error: Freeze reason must be 128 bytes or fewer");
      return;
    }

    setActionPending(true);
    setActionStatus(null);
    try {
      const xdr = await buildFreezeMerchantTx(
        adminKey,
        merchantAddress.trim(),
        freezeReason.trim() || null
      );
      const hash = await onSign(xdr);
      setActionStatus(`Merchant frozen! tx: ${hash.slice(0, 12)}…`);
      setMerchantAddress("");
      setFreezeReason("");
    } catch (err) {
      const msg = `Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
      setActionStatus(msg);
    } finally {
      setActionPending(false);
    }
  };

  const handleUnfreeze = async () => {
    if (!merchantAddress.trim() || !isValidStellarAddress(merchantAddress.trim())) {
      setActionStatus("Error: Invalid merchant address");
      return;
    }

    setActionPending(true);
    setActionStatus(null);
    try {
      const xdr = await buildUnfreezeMerchantTx(adminKey, merchantAddress.trim());
      const hash = await onSign(xdr);
      setActionStatus(`Merchant unfrozen! tx: ${hash.slice(0, 12)}…`);
      setMerchantAddress("");
    } catch (err) {
      const msg = `Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
      setActionStatus(msg);
    } finally {
      setActionPending(false);
    }
  };

  const handleCheckReason = async () => {
    if (!checkReason.trim() || !isValidStellarAddress(checkReason.trim())) {
      setDisplayReason("Invalid merchant address");
      return;
    }

    setCheckingReason(true);
    setDisplayReason(null);
    try {
      const reason = await getMerchantFreezeReason(adminKey, checkReason.trim());
      setDisplayReason(reason || "Merchant is not frozen");
    } catch (err) {
      setDisplayReason(`Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`);
    } finally {
      setCheckingReason(false);
    }
  };

  return (
    <div className="merchant-freeze-panel" data-testid="merchant-freeze-panel">
      <h3 className="text-lg font-semibold mb-4">Merchant Freeze Controls</h3>

      {!isAdmin && (
        <div className="network-warning mb-4" role="alert">
          <span>🔒</span>
          <span>Admin access required to freeze/unfreeze merchants.</span>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Merchant Address</label>
        <input
          type="text"
          className="input"
          value={merchantAddress}
          onChange={(e) => setMerchantAddress(e.target.value)}
          placeholder="G…"
          disabled={!isAdmin || actionPending}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Freeze Reason (optional, max 128 bytes)</label>
        <input
          type="text"
          className="input"
          value={freezeReason}
          onChange={(e) => setFreezeReason(e.target.value)}
          placeholder="e.g., Terms of service violation"
          disabled={!isAdmin || actionPending}
          maxLength={128}
        />
        <span className="text-xs text-muted">
          {new TextEncoder().encode(freezeReason).length} / 128 bytes
        </span>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          className="btn-primary"
          onClick={handleFreeze}
          disabled={!isAdmin || actionPending}
        >
          {actionPending ? "Processing…" : "Freeze Merchant"}
        </button>
        <button
          className="btn-secondary"
          onClick={handleUnfreeze}
          disabled={!isAdmin || actionPending}
        >
          Unfreeze Merchant
        </button>
      </div>

      {actionStatus && (
        <p className={`form-status mb-4${actionStatus.startsWith("Error") ? " text-error" : ""}`}>
          {actionStatus}
        </p>
      )}

      <hr className="my-6" />

      <h4 className="text-md font-semibold mb-3">Check Freeze Reason</h4>
      <div className="form-group">
        <input
          type="text"
          className="input"
          value={checkReason}
          onChange={(e) => setCheckReason(e.target.value)}
          placeholder="Merchant address to check"
        />
      </div>
      <button
        className="btn-secondary mb-3"
        onClick={handleCheckReason}
        disabled={checkingReason}
      >
        {checkingReason ? "Checking…" : "Check Reason"}
      </button>

      {displayReason && (
        <p className="text-sm" style={{ color: displayReason.startsWith("Error") ? "var(--color-danger)" : "inherit" }}>
          {displayReason}
        </p>
      )}
    </div>
  );
}
