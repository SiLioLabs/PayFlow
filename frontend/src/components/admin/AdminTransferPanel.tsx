import React, { useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import AddressInput from "../AddressInput";
import ConfirmModal from "../ConfirmModal";
import Spinner from "../Spinner";
import { buildTransferAdminTx, buildAcceptAdminTx } from "../../stellar";

interface Props {
  publicKey: string;
  onSign: (xdr: string) => Promise<string>;
  isAdmin: boolean;
  isPendingAdmin: boolean;
  adminAddress: string | null;
  pendingAdminAddress: string | null;
  onSuccess: () => void;
}

export default function AdminTransferPanel({
  publicKey,
  onSign,
  isAdmin,
  isPendingAdmin,
  adminAddress,
  pendingAdminAddress,
  onSuccess,
}: Props) {
  const [newAdminInput, setNewAdminInput] = useState("");
  const [confirmAction, setConfirmAction] = useState<"propose" | "accept" | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isValidAddress = (addr: string) => StrKey.isValidEd25519PublicKey(addr);

  async function handleConfirm() {
    const action = confirmAction;
    setConfirmAction(null);
    setStatus("loading");
    setErrorMsg(null);
    try {
      const xdr =
        action === "propose"
          ? await buildTransferAdminTx(publicKey, newAdminInput)
          : await buildAcceptAdminTx(publicKey);
      await onSign(xdr);
      setStatus("success");
      setNewAdminInput("");
      onSuccess();
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      // Map error code 45 (NoPendingAdmin) to a friendly message.
      const msg =
        raw.includes("45") || /NoPendingAdmin/i.test(raw)
          ? "No pending admin transfer exists. The current admin must propose one first."
          : raw;
      setErrorMsg(msg);
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="admin-transfer-heading">
      <h3 id="admin-transfer-heading" className="text-lg font-semibold mb-2">
        Admin Transfer
      </h3>
      <p className="text-sm text-muted mb-4">
        Two-step ownership rotation. <strong>Step 1</strong>: current admin proposes a new admin.{" "}
        <strong>Step 2</strong>: the proposed address accepts.
      </p>

      <div className="mb-4">
        <span className="form-label">Current admin</span>
        <p className="text-sm font-mono" data-testid="current-admin-address">
          {adminAddress ?? "—"}
        </p>
      </div>

      <div className="mb-4">
        <span className="form-label">Pending admin</span>
        <p
          className={`text-sm font-mono ${pendingAdminAddress ? "" : "text-muted"}`}
          data-testid="pending-admin-address"
        >
          {pendingAdminAddress ?? "None"}
        </p>
      </div>

      {status === "success" && (
        <div className="network-ok mb-4" role="status">
          Transaction submitted successfully.
        </div>
      )}
      {status === "error" && errorMsg && (
        <div className="network-warning mb-4" role="alert">
          {errorMsg}
        </div>
      )}
      {status === "loading" && (
        <div className="flex gap-2 items-center text-muted mb-4" role="status">
          <Spinner size="sm" />
          <span>Submitting transaction…</span>
        </div>
      )}

      {/* Step 1 — only current admin sees the propose form */}
      {isAdmin && (
        <div className="mb-6">
          <AddressInput
            label="Propose new admin"
            value={newAdminInput}
            onChange={setNewAdminInput}
          />
          <button
            className="btn-primary mt-2"
            disabled={!isValidAddress(newAdminInput) || status === "loading"}
            onClick={() => setConfirmAction("propose")}
            data-testid="propose-admin-btn"
          >
            Propose transfer
          </button>
        </div>
      )}

      {/* Step 2 — only pending admin sees the accept button */}
      {isPendingAdmin && pendingAdminAddress && (
        <div className="mb-4">
          <p className="text-sm mb-2">
            You are the pending admin. Accept to complete the transfer.
          </p>
          <button
            className="btn-primary"
            disabled={status === "loading"}
            onClick={() => setConfirmAction("accept")}
            data-testid="accept-admin-btn"
          >
            Accept admin transfer
          </button>
        </div>
      )}

      {!isAdmin && !isPendingAdmin && (
        <p className="text-sm text-muted">
          Connect as the current admin to propose a transfer, or as the pending admin to accept.
        </p>
      )}

      {confirmAction === "propose" && (
        <ConfirmModal
          message={`Transfer admin to ${newAdminInput.slice(0, 8)}…${newAdminInput.slice(-4)}? The new address must accept before the change takes effect.`}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
          confirmTestId="confirm-propose-btn"
          cancelTestId="cancel-propose-btn"
        />
      )}
      {confirmAction === "accept" && (
        <ConfirmModal
          message="Accept admin transfer? You will become the contract admin immediately."
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
          confirmTestId="confirm-accept-btn"
          cancelTestId="cancel-accept-btn"
        />
      )}
    </section>
  );
}
