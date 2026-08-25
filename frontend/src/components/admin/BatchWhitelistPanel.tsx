import React, { useState } from "react";
import { buildWhitelistBatchAddTx, buildWhitelistBatchRemoveTx } from "../../stellar";
import { parseAddressList, chunkAddresses } from "../../utils/addressValidation";
import { friendlyError } from "../../utils/errors";
import { useTransaction } from "../../hooks/useTransaction";
import { useToast } from "../../hooks/useToast";
import AddressListInput from "./AddressListInput";
import ConfirmModal from "../ConfirmModal";
import Spinner from "../Spinner";
import ToastContainer from "../Toast";

/** Contract hard limit per whitelist_batch_add / whitelist_batch_remove call */
const MAX_WHITELIST_BATCH = 50;

type WhitelistAction = "add" | "remove";

interface Props {
  /** The admin's wallet public key */
  adminKey: string;
  /** Signs a transaction XDR and returns the submitted tx hash */
  onSign: (xdr: string) => Promise<string>;
  /** Whether the connected wallet has admin privileges */
  isAdmin: boolean;
}

/**
 * BatchWhitelistPanel — lets an admin add or remove multiple merchant addresses
 * from the whitelist in a single operation.
 *
 * Lists longer than 50 addresses are split into multiple transactions.
 */
export default function BatchWhitelistPanel({ adminKey, onSign, isAdmin }: Props) {
  const { toasts, addToast, removeToast } = useToast();
  const tx = useTransaction();

  const [rawInput, setRawInput] = useState("");
  const [action, setAction] = useState<WhitelistAction>("add");
  const [showConfirm, setShowConfirm] = useState(false);

  const { valid, invalid } = parseAddressList(rawInput);
  const canSubmit = isAdmin && valid.length > 0 && invalid.length === 0 && tx.status !== "pending";

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

  return (
    <section
      className="batch-whitelist-panel"
      aria-labelledby="batch-whitelist-heading"
      style={{ opacity: isAdmin ? 1 : 0.5 }}
    >
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <header className="mb-3">
        <h4 id="batch-whitelist-heading" className="text-base font-semibold">
          Batch Whitelist Management
        </h4>
        <p className="text-sm text-muted">
          Add or remove multiple merchant addresses from the whitelist. Lists longer than{" "}
          {MAX_WHITELIST_BATCH} addresses are split automatically.
        </p>
      </header>

      {!isAdmin && (
        <div className="network-warning mb-3" role="alert">
          <span>🔒</span>
          <span>Admin access required to modify the whitelist.</span>
        </div>
      )}

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
          <strong>Preview:</strong> {valid.length} merchant{valid.length !== 1 ? "s" : ""} will be{" "}
          {action === "add" ? "added to" : "removed from"} the whitelist
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
