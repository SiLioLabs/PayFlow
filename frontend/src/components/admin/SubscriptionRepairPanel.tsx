import React, { useCallback, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import {
  buildRepairSubscriptionTx,
  parseSubscriptionRepairedEvent,
  validateSubscription,
} from "../../stellar";
import { friendlyError } from "../../utils/errors";
import {
  collectValidationMessages,
  formatViolation,
  hasValidationFailures,
} from "../../utils/subscriptionValidation";
import type { SubscriptionValidationReport } from "../../types";
import { useAdmin } from "../../hooks/useAdmin";
import { useSubscription } from "../../hooks/useSubscription";
import { useTransaction } from "../../hooks/useTransaction";
import { useToast } from "../../hooks/useToast";
import AddressInput from "../AddressInput";
import ConfirmModal from "../ConfirmModal";
import Spinner from "../Spinner";
import ToastContainer from "../Toast";

interface Props {
  adminKey: string;
  onSign: (xdr: string) => Promise<string>;
}

type ValidationPhase = "idle" | "loading" | "success" | "error";

function ViolationList({ items, prefix }: { items: string[]; prefix: string }) {
  if (items.length === 0) return null;

  return (
    <ul className="subscription-repair-panel__violations">
      {items.map((item) => (
        <li key={`${prefix}-${item}`}>{formatViolation(item)}</li>
      ))}
    </ul>
  );
}

export default function SubscriptionRepairPanel({ adminKey, onSign }: Props) {
  const { isAdmin, adminAddress, loading: adminLoading, error: adminError } = useAdmin(adminKey);
  const { toasts, addToast, removeToast } = useToast();
  const repairTx = useTransaction();

  const [userAddress, setUserAddress] = useState("");
  const [validatedAddress, setValidatedAddress] = useState<string | null>(null);
  const [report, setReport] = useState<SubscriptionValidationReport | null>(null);
  const [validationPhase, setValidationPhase] = useState<ValidationPhase>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);
  const [repairResultCount, setRepairResultCount] = useState<number | null>(null);
  const [subscriptionRefresh, setSubscriptionRefresh] = useState(0);

  const lookupKey = validatedAddress ?? adminKey;
  const { subscription, refresh: refreshSubscription } = useSubscription(
    lookupKey,
    subscriptionRefresh
  );

  const addressValid =
    !!userAddress && StrKey.isValidEd25519PublicKey(userAddress.trim());

  const validationMessages = report ? collectValidationMessages(report) : [];
  const hasFailures = report ? hasValidationFailures(report) : false;
  const canRepair =
    isAdmin &&
    hasFailures &&
    !!validatedAddress &&
    repairTx.status !== "pending";

  const runValidation = useCallback(async () => {
    const trimmed = userAddress.trim();
    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setValidationError("Enter a valid Stellar public key (G…).");
      return;
    }

    setValidationPhase("loading");
    setValidationError(null);
    setReport(null);
    setRepairResultCount(null);
    setValidatedAddress(trimmed);

    try {
      const result = await validateSubscription(adminKey, trimmed);
      setReport(result);
      setValidationPhase("success");
    } catch (e: unknown) {
      const msg = friendlyError(e instanceof Error ? e.message : String(e));
      setValidationError(msg);
      setValidationPhase("error");
    }
  }, [adminKey, userAddress]);

  async function performRepair() {
    if (!validatedAddress || !canRepair) return;

    setShowRepairConfirm(false);
    setRepairResultCount(null);

    try {
      const hash = await repairTx.submit(async () => {
        const xdr = await buildRepairSubscriptionTx(adminKey, validatedAddress);
        return onSign(xdr);
      });

      const fixedCount = await parseSubscriptionRepairedEvent(hash);
      setRepairResultCount(fixedCount);

      if (fixedCount != null) {
        addToast(`Repair successful. Fixed inconsistencies: ${fixedCount}`, "success", hash);
      } else {
        addToast("Repair transaction confirmed.", "success", hash);
      }

      setSubscriptionRefresh((n) => n + 1);
      await runValidation();
      await refreshSubscription();
    } catch (e: unknown) {
      const msg = friendlyError(e instanceof Error ? e.message : String(e));
      addToast(`Repair failed: ${msg}`, "error");
    }
  }

  return (
    <section
      className="subscription-repair-panel"
      aria-labelledby="subscription-repair-heading"
    >
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <header className="mb-4">
        <h3 id="subscription-repair-heading" className="text-lg font-semibold">
          Subscription Repair
        </h3>
        <p className="text-sm text-muted">
          Diagnose corrupted subscription records and execute authorized on-chain repairs.
        </p>
      </header>

      {adminLoading && (
        <div className="flex gap-2 items-center text-muted text-sm mb-4" role="status">
          <Spinner size="sm" />
          <span>Verifying admin credentials…</span>
        </div>
      )}

      {!adminLoading && !isAdmin && (
        <div className="network-warning mb-4" role="alert">
          <span>🔒</span>
          <span>
            {adminError
              ? adminError
              : adminAddress
                ? "Connected wallet is not the contract admin. Repair actions are disabled."
                : "Admin credentials could not be verified. Repair actions are disabled."}
          </span>
        </div>
      )}

      {isAdmin && (
        <p className="text-sm text-muted mb-4">
          Signed in as contract admin{" "}
          <code className="text-xs">{adminAddress?.slice(0, 8)}…</code>
        </p>
      )}

      <div className="form-group mb-4">
        <AddressInput
          label="Subscriber address"
          value={userAddress}
          onChange={setUserAddress}
        />
        <button
          type="button"
          className="btn-primary mt-3"
          onClick={runValidation}
          disabled={!addressValid || validationPhase === "loading"}
          aria-busy={validationPhase === "loading"}
        >
          {validationPhase === "loading" ? (
            <span className="flex gap-2 items-center">
              <Spinner size="sm" />
              Validating…
            </span>
          ) : (
            "Validate subscription"
          )}
        </button>
      </div>

      {validationPhase === "error" && validationError && (
        <div className="card mb-4" role="alert" style={{ borderColor: "var(--color-danger)" }}>
          <h4 className="text-base font-semibold mb-2">Validation Error</h4>
          <p className="text-sm text-error mb-3">{validationError}</p>
          <button type="button" className="btn-secondary" onClick={runValidation}>
            Retry validation
          </button>
        </div>
      )}

      {validationPhase === "success" && report && (
        <div className="card mb-4" aria-live="polite">
          {hasFailures ? (
            <>
              <h4 className="text-base font-semibold mb-2" style={{ color: "var(--color-danger)" }}>
                Subscription Validation Failed
              </h4>
              <ul className="subscription-repair-panel__violations">
                {validationMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>

              {report.missingRecords.length > 0 && (
                <details className="mb-3 mt-3">
                  <summary className="text-sm font-medium cursor-pointer">
                    Missing records ({report.missingRecords.length})
                  </summary>
                  <ViolationList items={report.missingRecords} prefix="missing" />
                </details>
              )}

              {report.invalidStateTransitions.length > 0 && (
                <details className="mb-3">
                  <summary className="text-sm font-medium cursor-pointer">
                    Invalid state transitions ({report.invalidStateTransitions.length})
                  </summary>
                  <ViolationList items={report.invalidStateTransitions} prefix="transition" />
                </details>
              )}

              {report.corruptedReferences.length > 0 && (
                <details className="mb-3">
                  <summary className="text-sm font-medium cursor-pointer">
                    Corrupted references ({report.corruptedReferences.length})
                  </summary>
                  <ViolationList items={report.corruptedReferences} prefix="ref" />
                </details>
              )}

              <button
                type="button"
                className="btn-danger mt-3"
                disabled={!canRepair}
                onClick={() => setShowRepairConfirm(true)}
                title={!isAdmin ? "Contract admin wallet required" : undefined}
              >
                {repairTx.status === "pending" ? "Repairing…" : "Repair subscription"}
              </button>

              {!isAdmin && (
                <p className="text-sm text-muted mt-2">
                  Repair requires authorization from the contract admin wallet.
                </p>
              )}
            </>
          ) : (
            <>
              <h4 className="text-base font-semibold mb-2" style={{ color: "var(--color-success)" }}>
                Subscription validation passed
              </h4>
              <p className="text-sm text-muted">
                No structural inconsistencies were detected for this address.
              </p>
            </>
          )}

          {repairResultCount != null && (
            <div
              className="mt-4 p-3 rounded-md"
              style={{ background: "var(--color-success-bg)", color: "var(--color-success-text)" }}
              role="status"
            >
              <strong>Repair successful</strong>
              <p className="text-sm mb-0 mt-1">Fixed inconsistencies: {repairResultCount}</p>
            </div>
          )}

          {validatedAddress && subscription && (
            <details className="mt-4">
              <summary className="text-sm font-medium cursor-pointer">Current subscription state</summary>
              <pre className="text-xs mt-2 overflow-auto">{JSON.stringify(subscription, null, 2)}</pre>
            </details>
          )}
        </div>
      )}

      {validationPhase === "idle" && (
        <p className="text-sm text-muted">
          Enter a subscriber address and run validation to inspect on-chain integrity.
        </p>
      )}

      {showRepairConfirm && (
        <ConfirmModal
          message={`Repair subscription data for ${validatedAddress}? This submits an on-chain recovery transaction.`}
          onConfirm={performRepair}
          onCancel={() => setShowRepairConfirm(false)}
        />
      )}
    </section>
  );
}
