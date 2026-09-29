import React, { useEffect, useRef, useState } from "react";
import { buildBatchPauseSubscriptionsTx } from "../../stellar";
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
const MAX_PAUSE_BATCH = CONTRACT_LIMITS.MAX_BATCH_PAUSE;

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
   * Optional async initialiser. When provided the panel shows a skeleton until
   * it resolves or rejects. This is the seam that lets tests inject a
   * controllable promise for race-condition coverage.
   *
   * Defaults to an immediately-resolved promise (no remote data needed).
   */
  onInit?: (signal: AbortSignal) => Promise<void>;
}

/**
 * BatchPausePanel — lets an admin paste a list of subscriber addresses and
 * pause all their subscriptions in one or more transactions.
 *
 * Loading state: shows an `AdminAddressListSkeleton` with aria-busy.
 * Empty state: shows the address textarea with a hint — distinct from loading.
 * Error state: shows an actionable retry banner — distinct from loading/empty.
 *
 * Stale-response prevention: each call to `onInit` is paired with an
 * `AbortController`. If a newer call starts before the previous one settles,
 * the previous result is ignored (the component checks `signal.aborted` before
 * applying state). This prevents an out-of-order slow response from clobbering
 * a newer, faster one.
 * Lists longer than MAX_BATCH_PAUSE are blocked at submit with a warning,
 * because the contract caps each batch_pause_subscriptions call.
 */
export default function BatchPausePanel({ adminKey, onSign, isAdmin, onInit }: Props) {
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToast();
  const tx = useTransaction();

  const [rawInput, setRawInput] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [panelState, setPanelState] = useState<PanelState>("loading");
  const [initError, setInitError] = useState<string | null>(null);

  // Tracks the sequence number of the latest init call so older completions
  // can be discarded even without AbortController cancellation support.
  const latestSeqRef = useRef(0);

  useEffect(() => {
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

    return () => {
      controller.abort();
    };
  // Re-run whenever the panel's identity changes (adminKey or onInit reference).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, onInit]);

  const { valid, invalid } = parseAddressList(rawInput);
  const canSubmit =
    isAdmin && valid.length > 0 && invalid.length === 0 && tx.status !== "pending" && panelState === "ready";
  const overCap = valid.length > MAX_PAUSE_BATCH;
  const canSubmit =
    isAdmin &&
    valid.length > 0 &&
    invalid.length === 0 &&
    !overCap &&
    tx.status !== "pending";

  const chunks = chunkAddresses(valid, MAX_PAUSE_BATCH);
  const txCount = chunks.length;

  async function executePause() {
    setShowConfirm(false);

    try {
      for (let i = 0; i < chunks.length; i++) {
        await tx.submit(async () => {
          const xdr = await buildBatchPauseSubscriptionsTx(adminKey, chunks[i]);
          return onSign(xdr);
        });
      }
      addToast(
        `Paused ${valid.length} subscription${valid.length !== 1 ? "s" : ""} successfully.`,
        "success"
      );
      setRawInput("");
    } catch (e: unknown) {
      addToast(
        `Batch pause failed: ${friendlyError(e instanceof Error ? e.message : String(e))}`,
        "error"
      );
    }
  }

  const confirmMessage =
    txCount > 1
      ? `Pause ${valid.length} subscriptions across ${txCount} transactions (${MAX_PAUSE_BATCH} per tx)?`
      : `Pause ${valid.length} subscription${valid.length !== 1 ? "s" : ""}?`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <section
      className="batch-pause-panel"
      aria-labelledby="batch-pause-heading"
      style={{ opacity: isAdmin ? 1 : 0.5 }}
    >
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onPause={pauseToast}
        onResume={resumeToast}
      />

      <header className="mb-3">
        <h4 id="batch-pause-heading" className="text-base font-semibold">
          Batch Pause Subscriptions
        </h4>
        <p className="text-sm text-muted">
          Paste subscriber addresses (one per line) to pause multiple subscriptions at once. Max{" "}
          {MAX_PAUSE_BATCH} addresses per batch.
        </p>
      </header>

      {!isAdmin && (
        <div className="network-warning mb-3" role="alert">
          <span>🔒</span>
          <span>Admin access required to pause subscriptions.</span>
        </div>
      )}

      {/* ── Loading state ── */}
      {panelState === "loading" && <AdminAddressListSkeleton />}

      {/* ── Error state ── */}
      {panelState === "error" && (
        <div
          className="card mb-3"
          role="alert"
          data-testid="batch-pause-error"
          style={{ borderColor: "var(--color-danger)" }}
        >
          <p className="text-sm text-error mb-2">
            Failed to load panel: {initError}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              // Re-trigger the effect by bumping a counter via onInit re-reference
              // is not needed — just re-set loading so the effect re-runs when
              // a parent re-renders. Simplest pattern: expose a retry callback.
              setPanelState("loading");
              setInitError(null);
              const seq = ++latestSeqRef.current;
              const controller = new AbortController();
              const { signal } = controller;
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
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Ready state (includes empty sub-state) ── */}
      {panelState === "ready" && (
        <>
          <AddressListInput
            label="Subscriber addresses"
            value={rawInput}
            onChange={setRawInput}
            disabled={!isAdmin || tx.status === "pending"}
          />

          {/* Empty sub-state: no addresses entered yet */}
          {rawInput.trim().length === 0 && (
            <p
              className="text-sm text-muted mb-3"
              data-testid="batch-pause-empty"
              aria-live="polite"
            >
              Enter subscriber addresses above to begin.
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
              <strong>Preview:</strong> {valid.length} address{valid.length !== 1 ? "es" : ""} will
              be paused
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
            className="btn-danger"
            onClick={() => setShowConfirm(true)}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            aria-busy={tx.status === "pending"}
            title={!isAdmin ? "Admin access required" : undefined}
          >
            {tx.status === "pending" ? (
              <span className="flex gap-2 items-center">
                <Spinner size="sm" />
                Pausing…
              </span>
            ) : (
              "Pause subscriptions"
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
          Too many addresses: {valid.length} provided, max {MAX_PAUSE_BATCH} per batch. Remove{" "}
          {valid.length - MAX_PAUSE_BATCH} to continue.
        </div>
      )}

      <button
        type="button"
        className="btn-danger"
        onClick={() => setShowConfirm(true)}
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        aria-busy={tx.status === "pending"}
        title={!isAdmin ? "Admin access required" : undefined}
      >
        {tx.status === "pending" ? (
          <span className="flex gap-2 items-center">
            <Spinner size="sm" />
            Pausing…
          </span>
        ) : (
          "Pause subscriptions"
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
          onConfirm={executePause}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </section>
  );
}