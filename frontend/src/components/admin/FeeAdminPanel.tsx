/**
 * FeeAdminPanel — admin UI for the two-step protocol fee change.
 *
 * Flow:
 *   1. `propose_fee(collector, bps)` stages a proposal in temporary storage.
 *   2. `commit_fee()` applies it, but only if the bps fall inside the bounds
 *      configured by `set_fee_bounds`.
 *
 * The panel reads the live fee (`get_fee`) and bounds (`get_fee_bounds`) and
 * validates the collector, bps and bounds client-side before asking the wallet
 * to sign. Validation messages come from the contract error catalog, so an
 * out-of-bounds value is blocked with the same wording the contract would use.
 *
 * The contract exposes no getter for the pending proposal (it lives in
 * temporary storage), so a proposal is only shown while it was made in this
 * panel session. Committing a proposal staged elsewhere still works; the
 * contract reports `NoPendingProposal` if none exists.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  CONTRACT_ID,
  buildClearFeeTx,
  buildCommitFeeTx,
  buildProposeFeeTx,
  buildSetFeeBoundsTx,
  getFeeBounds,
  getProtocolFee,
  type FeeBounds,
  type ProtocolFee,
} from "../../stellar";
import { isValidEd25519Address } from "../../utils/addressValidation";
import { contractErrorMessage, friendlyError } from "../../utils/errors";
import { useTransaction } from "../../hooks/useTransaction";

/** Mirrors the contract's `bps <= 10_000` guard in `fee::propose_fee`. */
const MAX_FEE_BPS = 10_000;
const DEFAULT_BOUNDS: FeeBounds = { minBps: 0, maxBps: MAX_FEE_BPS };

// Contract error messages (contract/src/errors.rs) used for client-side rules.
const INVALID_FEE_BPS = contractErrorMessage(13);
const INVALID_FEE_COLLECTOR = contractErrorMessage(26);
const INVALID_FEE_BOUNDS = contractErrorMessage(34);
const FEE_OUT_OF_BOUNDS = contractErrorMessage(35);

interface PendingProposal {
  collector: string;
  bps: number;
}

interface Props {
  /** The admin's wallet public key. */
  adminKey: string;
  /** Signs a transaction XDR and returns the submitted tx hash. */
  onSign: (xdr: string) => Promise<string>;
  /** Whether the connected wallet has admin privileges. */
  isAdmin: boolean;
}

function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address;
}

/** Parses a non-negative integer bps value, or returns null. */
function parseBps(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export default function FeeAdminPanel({ adminKey, onSign, isAdmin }: Props) {
  const tx = useTransaction();

  const [fee, setFee] = useState<ProtocolFee | null>(null);
  const [bounds, setBounds] = useState<FeeBounds>(DEFAULT_BOUNDS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [collectorInput, setCollectorInput] = useState("");
  const [bpsInput, setBpsInput] = useState("");
  const [minInput, setMinInput] = useState(String(DEFAULT_BOUNDS.minBps));
  const [maxInput, setMaxInput] = useState(String(DEFAULT_BOUNDS.maxBps));

  const [pending, setPending] = useState<PendingProposal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [currentFee, currentBounds] = await Promise.all([
        getProtocolFee(adminKey),
        getFeeBounds(adminKey),
      ]);
      setFee(currentFee);

      const nextBounds = currentBounds ?? DEFAULT_BOUNDS;
      setBounds(nextBounds);
      setMinInput(String(nextBounds.minBps));
      setMaxInput(String(nextBounds.maxBps));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = tx.status === "pending";

  async function submitAction(
    label: string,
    build: () => Promise<string>,
    after?: () => void | Promise<void>
  ) {
    setActionError(null);
    setStatus(null);
    try {
      await tx.submit(async () => onSign(await build()), label);
      if (after) await after();
    } catch (err) {
      setActionError(friendlyError(err instanceof Error ? err.message : String(err)));
    }
  }

  const handlePropose = async () => {
    const collector = collectorInput.trim();
    const bps = parseBps(bpsInput);

    if (!collector || !isValidEd25519Address(collector) || collector === CONTRACT_ID) {
      setActionError(INVALID_FEE_COLLECTOR);
      return;
    }
    if (bps === null || bps > MAX_FEE_BPS) {
      setActionError(INVALID_FEE_BPS);
      return;
    }
    if (bps < bounds.minBps || bps > bounds.maxBps) {
      setActionError(
        `${FEE_OUT_OF_BOUNDS} Allowed range: ${bounds.minBps}–${bounds.maxBps} bps.`
      );
      return;
    }

    await submitAction(
      "Propose protocol fee",
      () => buildProposeFeeTx(adminKey, collector, bps),
      () => {
        setPending({ collector, bps });
        setStatus(
          `Proposed ${bps} bps to ${shortAddress(collector)}. Commit to apply it on-chain.`
        );
      }
    );
  };

  const pendingOutOfBounds =
    pending !== null && (pending.bps < bounds.minBps || pending.bps > bounds.maxBps);

  const handleCommit = async () => {
    if (pendingOutOfBounds) {
      setActionError(
        `${FEE_OUT_OF_BOUNDS} Allowed range: ${bounds.minBps}–${bounds.maxBps} bps.`
      );
      return;
    }

    await submitAction(
      "Commit protocol fee",
      () => buildCommitFeeTx(adminKey),
      async () => {
        setPending(null);
        setStatus("Committed the pending protocol fee.");
        await load();
      }
    );
  };

  const handleClear = async () => {
    await submitAction(
      "Clear protocol fee",
      () => buildClearFeeTx(adminKey),
      async () => {
        setPending(null);
        setStatus("Cleared the protocol fee.");
        await load();
      }
    );
  };

  const handleSetBounds = async () => {
    const min = parseBps(minInput);
    const max = parseBps(maxInput);

    if (min === null || max === null || min > max || max > MAX_FEE_BPS) {
      setActionError(INVALID_FEE_BOUNDS);
      return;
    }

    await submitAction(
      "Set fee bounds",
      () => buildSetFeeBoundsTx(adminKey, min, max),
      async () => {
        setStatus(`Fee bounds set to ${min}–${max} bps.`);
        await load();
      }
    );
  };

  return (
    <section className="fee-admin-panel" aria-labelledby="fee-admin-heading">
      <header className="mb-3">
        <h4 id="fee-admin-heading" className="text-base font-semibold">
          Protocol Fee
        </h4>
        <p className="text-sm text-muted">
          Fee changes are two-step: propose a collector and bps, then commit once it is within the
          configured bounds.
        </p>
      </header>

      {!isAdmin && (
        <div className="network-warning mb-3" role="alert">
          <span>🔒</span>
          <span>Admin access required to change the protocol fee.</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted" role="status">
          Loading fee configuration…
        </p>
      ) : (
        <>
          {loadError && (
            <div className="card mb-3" role="alert" style={{ borderColor: "var(--color-danger)" }}>
              <p className="text-sm text-error mb-2">Failed to load fee configuration: {loadError}</p>
              <button type="button" className="btn-secondary" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}

          <dl className="fee-admin-panel__summary mb-4">
            <div>
              <dt className="text-sm text-muted">Current fee</dt>
              <dd className="font-semibold">
                {fee ? `${fee.bps} bps (${fee.bps / 100}%)` : "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Collector</dt>
              <dd title={fee?.collector}>{fee ? shortAddress(fee.collector) : "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Allowed range</dt>
              <dd>
                {bounds.minBps}–{bounds.maxBps} bps
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Pending proposal</dt>
              <dd>
                {pending
                  ? `${pending.bps} bps → ${shortAddress(pending.collector)}`
                  : "No pending proposal in this session."}
              </dd>
            </div>
          </dl>

          {pendingOutOfBounds && (
            <p className="text-error text-sm mb-3" role="alert">
              <strong>{FEE_OUT_OF_BOUNDS}</strong> Allowed range: {bounds.minBps}–{bounds.maxBps}{" "}
              bps. Replace the proposal or widen the bounds before committing.
            </p>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="fee-collector">
              Fee collector address
            </label>
            <input
              id="fee-collector"
              type="text"
              className="input"
              value={collectorInput}
              onChange={(e) => setCollectorInput(e.target.value)}
              placeholder="G…"
              disabled={!isAdmin || busy}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="fee-bps">
              Fee (bps)
            </label>
            <input
              id="fee-bps"
              type="number"
              className="input"
              min={0}
              max={MAX_FEE_BPS}
              step={1}
              value={bpsInput}
              onChange={(e) => setBpsInput(e.target.value)}
              placeholder="e.g. 100"
              disabled={!isAdmin || busy}
            />
            <span className="text-xs text-muted">
              1 bps = 0.01%. Proposals outside {bounds.minBps}–{bounds.maxBps} bps are blocked.
            </span>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              className="btn-primary"
              onClick={handlePropose}
              disabled={!isAdmin || busy}
            >
              {busy ? "Submitting…" : "Propose fee"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCommit}
              disabled={!isAdmin || busy || pendingOutOfBounds}
            >
              Commit fee
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={handleClear}
              disabled={!isAdmin || busy}
            >
              Clear fee
            </button>
          </div>

          <h5 className="text-sm font-semibold mb-2">Fee bounds</h5>
          <div className="flex gap-2 mb-3">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="fee-min-bps">
                Minimum fee (bps)
              </label>
              <input
                id="fee-min-bps"
                type="number"
                className="input"
                min={0}
                max={MAX_FEE_BPS}
                step={1}
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                disabled={!isAdmin || busy}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="fee-max-bps">
                Maximum fee (bps)
              </label>
              <input
                id="fee-max-bps"
                type="number"
                className="input"
                min={0}
                max={MAX_FEE_BPS}
                step={1}
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                disabled={!isAdmin || busy}
              />
            </div>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleSetBounds}
            disabled={!isAdmin || busy}
          >
            Update fee bounds
          </button>

          {actionError && (
            <p className="text-error text-sm mt-3" role="alert">
              {actionError}
            </p>
          )}
          {status && (
            <p className="text-sm mt-3" role="status">
              {status}
            </p>
          )}
        </>
      )}
    </section>
  );
}
