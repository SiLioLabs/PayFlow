import React, { useEffect, useRef, useState } from "react";
import { buildWhitelistBatchAddTx, buildWhitelistBatchRemoveTx } from "../../stellar";
import { parseAddressList, chunkAddresses } from "../../utils/addressValidation";
import { friendlyError } from "../../utils/errors";
import { useTransaction } from "../../hooks/useTransaction";
import { useToast } from "../../hooks/useToast";
import { CONTRACT_LIMITS } from "../../constants";
import AddressListInput from "./AddressListInput";
import ConfirmModal from "../ConfirmModal";
import Spinner from "../Spinner";
import ToastContainer from "../Toast";
import { AdminAddressListSkeleton } from "../Skeleton";

/** Contract hard limit — sourced from shared constants */
const MAX_WHITELIST_BATCH = CONTRACT_LIMITS.MAX_BATCH_WHITELIST;

type WhitelistAction = "add" | "remove";

// ── Panel load state ──────────────────────────────────────────────────────────

type PanelState = "loading" | "ready" | "error";

interface Props {
  /** The admin's wallet public key */
  adminKey: string;
  /** Signs a transaction XDR and returns the submitted tx hash */
  onSign: (xdr: string) => Promise<string>;
  /** Whether the connected wallet has admin privileges */
  isAdmin: boolean;
  /**
   * Optional async initialiser (e.g. fetching current whitelist size).
   * The panel shows a skeleton until this settles. Defaults to an immediately-
   * resolved promise. Receives an `AbortSignal` — stale completions are
   * discarded when the signal has been aborted or superseded by a newer call.
   */
  onInit?: (signal: AbortSignal) => Promise<void>;
}

/**
 * BatchWhitelistPanel — lets an admin add or remove multiple merchant addresses
 * from the whitelist in a single operation.
 *
 * Loading state: `AdminAddressListSkeleton` with aria-busy.
 * Empty state: textarea shown with a hint — visually and semantically distinct.
 * Error state: red card with actionable Retry button.
 *
 * Stale responses: each `onInit` invocation is paired with an `AbortController`
 * and a monotonic sequence counter. Results from superseded calls are dropped.
 * Lists longer than MAX_BATCH_WHITELIST are blocked at submit with a warning.
 */
export default function BatchWhitelistPanel({ adminKey, onSign, isAdmin, onInit }: Props) {
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToast();
  const tx = useTransaction();

  const [rawInput, setRawInput] = useState("");
  const [action, setAction] = useState<WhitelistAction>("add");
  const [showConfirm, setShowConfirm] = useState(false);
  const [panelState, setPanelState] = useState<PanelState>("loading");
  const [initError, setInitError] = useState<string | null>(null);

  const latestSeqRef = useRef(0);

  const runInit = () => {
    const seq = ++latestSeqRef.current;
    const controller = new AbortController();
    const { signal } = controller;

    setPanelState("loading");
    setInitError(null);

    const initialise = onInit ?? (() => Promise.resolve());

    initialise(signal).then(
      () => {
        if (signal.aborted || seq !== latestSeqRef.current) return;
        setPanelState("ready");
      },
      (err: unknown) => {
        if (signal.aborted || seq !== latestSeqRef.current) return;
        setInitError(err instanceof Error ? err.message : String(err));
        setPanelState("error");
      }
    );

    return () => controller.abort();
  };

  useEffect(() => {
    return runInit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, onInit]);

  const { valid, invalid } = parseAddressList(rawInput);
  const overCap = valid.length > MAX_WHITELIST_BATCH;
  const canSubmit =
    isAdmin &&
    valid.length > 0 &&
    invalid.length === 0 &&
    tx.status !== "pending" &&
    panelState === "ready";
    !overCap &&
    tx.status !== "pending";

  const chunks = chunkAddresses(valid, MAX_WHITELIST_BATCH);
  const txCount = chunks.length;

  async function executeWhitelist() {
    setShowConfirm(false);

    const builder = action === "add" ? buildWhitelistBatchAddTx : buildWhitelistBatchRemoveTx;
    const verb = action === "add" ? "Added" : "Removed";

    try {
      for (let i = 0; i < chunks.length; i++) {
        await tx.submit(async () => {
          const xdr = await builder(adminKey, chunks[i]);
          return onSign(xdr);
        });
      }
      addToast(
        `${verb} ${valid.length} merchant${valid.length !== 1 ? "s" : ""} successfully.`,
        "success"
      );
      setRawInput("");
    } catch (e: unknown) {
      addToast(
        `Whitelist operation failed: ${friendlyError(e instanceof Error ? e.message : String(e))}`,
        "error"
      );
    }
  }

  const verbLabel = action === "add" ? "add to" : "remove from";
  const confirmMessage =
    txCount > 1
      ? `${action === "add" ? "Add" : "Remove"} ${valid.length} merchants ${action === "add" ? "to" : "from"} the whitelist across ${txCount} transactions?`
      : `${action === "add" ? "Add" : "Remove"} ${valid.length} merchant${valid.length !== 1 ? "s" : ""} ${verbLabel} the whitelist?`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section
      className="batch-whitelist-panel"
      aria-labelledby="batch-whitelist-heading"
      style={{ opacity: isAdmin ? 1 : 0.5 }}
    >
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onPause={pauseToast}
        onResume={resumeToast}
      />

      <header className="mb-3">
        <h4 id="batch-whitelist-heading" className="text-base font-semibold">
          Batch Whitelist Management
        </h4>
        <p className="text-sm text-muted">
          Add or remove multiple merchant addresses from the whitelist. Max{" "}
          {MAX_WHITELIST_BATCH} addresses per batch.
        </p>
      </header>

      {!isAdmin && (
        <div className="network-warning mb-3" role="alert">
          <span>🔒</span>
          <span>Admin access required to modify the whitelist.</span>
        </div>
      )}

      {/* ── Loading state ── */}
      {panelState === "loading" && <AdminAddressListSkeleton />}

      {/* ── Error state ── */}
      {panelState === "error" && (
        <div
          className="card mb-3"
          role="alert"
          data-testid="batch-whitelist-error"
          style={{ borderColor: "var(--color-danger)" }}
        >
          <p className="text-sm text-error mb-2">
            Failed to load panel: {initError}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={runInit}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Ready state (includes empty sub-state) ── */}
      {panelState === "ready" && (
        <>
          {/* Action selector */}
          <div className="form-group mb-3" role="group" aria-labelledby="whitelist-action-label">
            <span id="whitelist-action-label" className="form-label">
              Action
            </span>
            <div className="flex gap-3 mt-1">
              <label className="flex gap-2 items-center" style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="whitelist-action"
                  value="add"
                  checked={action === "add"}
                  onChange={() => setAction("add")}
                  disabled={!isAdmin || tx.status === "pending"}
                />
                <span>Add merchants</span>
              </label>
              <label className="flex gap-2 items-center" style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="whitelist-action"
                  value="remove"
                  checked={action === "remove"}
                  onChange={() => setAction("remove")}
                  disabled={!isAdmin || tx.status === "pending"}
                />
                <span>Remove merchants</span>
              </label>
            </div>
          </div>

          <AddressListInput
            label="Merchant addresses"
            value={rawInput}
            onChange={setRawInput}
            disabled={!isAdmin || tx.status === "pending"}
          />

          {/* Empty sub-state: no addresses entered yet */}
          {rawInput.trim().length === 0 && (
            <p
              className="text-sm text-muted mb-3"
              data-testid="batch-whitelist-empty"
              aria-live="polite"
            >
              Enter merchant addresses above to begin.
            </p>
          )}

          {valid.length > 0 && invalid.length === 0 && (
            <div
              className="mb-3 p-3 rounded-md"
              style={{
                background: "var(--color-surface-secondary, #f3f4f6)",
                fontSize: "0.85rem",
              }}
              role="status"
              aria-live="polite"
            >
              <strong>Preview:</strong> {valid.length} merchant{valid.length !== 1 ? "s" : ""} will
              be {action === "add" ? "added to" : "removed from"} the whitelist
              {txCount > 1 && (
                <span>
                  {" "}
                  in <strong>{txCount} transactions</strong>
                </span>
              )}
              .
            </div>
          )}

          <button
            type="button"
            className={action === "add" ? "btn-primary" : "btn-danger"}
            onClick={() => setShowConfirm(true)}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            aria-busy={tx.status === "pending"}
            title={!isAdmin ? "Admin access required" : undefined}
          >
            {tx.status === "pending" ? (
              <span className="flex gap-2 items-center">
                <Spinner size="sm" />
                {action === "add" ? "Adding…" : "Removing…"}
              </span>
            ) : action === "add" ? (
              "Add to whitelist"
            ) : (
              "Remove from whitelist"
            )}
          </button>

          {tx.error && (
            <p className="text-error text-sm mt-2" role="alert">
              {friendlyError(tx.error)}
            </p>
          )}
        </>
      {overCap && (
        <div
          role="alert"
          className="mb-3 p-3 rounded-md text-sm"
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            color: "var(--color-error, #ef4444)",
            border: "1px solid var(--color-error, #ef4444)",
          }}
        >
          Too many addresses: {valid.length} provided, max {MAX_WHITELIST_BATCH} per batch. Remove{" "}
          {valid.length - MAX_WHITELIST_BATCH} to continue.
        </div>
      )}

      <button
        type="button"
        className={action === "add" ? "btn-primary" : "btn-danger"}
        onClick={() => setShowConfirm(true)}
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        aria-busy={tx.status === "pending"}
        title={!isAdmin ? "Admin access required" : undefined}
      >
        {tx.status === "pending" ? (
          <span className="flex gap-2 items-center">
            <Spinner size="sm" />
            {action === "add" ? "Adding…" : "Removing…"}
          </span>
        ) : action === "add" ? (
          "Add to whitelist"
        ) : (
          "Remove from whitelist"
        )}
      </button>

      {tx.error && (
        <p className="text-error text-sm mt-2" role="alert">
          {friendlyError(tx.error)}
        </p>
      )}

      {showConfirm && (
        <ConfirmModal
          message={confirmMessage}
          onConfirm={executeWhitelist}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  );
}