import React, { useMemo, useRef, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { buildTransferSubscriptionTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import { useFocusTrap } from "../hooks/useFocusTrap";
import AddressBook from "./AddressBook";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onClose: () => void;
  onSuccess: () => void;
}

const CHECKLIST_ITEMS = [
  "I have verified this address is correct and does not already have an active subscription.",
  "I understand the recipient must also authorize this transfer in their own wallet.",
  "I understand this action is irreversible and cannot be undone.",
] as const;

export default function TransferSubscriptionModal({ userKey, onSign, onClose, onSuccess }: Props) {
  const [targetAddress, setTargetAddress] = useState("");
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [checklist, setChecklist] = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, true, onClose);

  const trimmedTarget = targetAddress.trim();
  const trimmedSelf = userKey.trim();
  const isValidFormat = trimmedTarget.length > 0 && StrKey.isValidEd25519PublicKey(trimmedTarget);
  const isSelf = trimmedTarget.length > 0 && trimmedTarget === trimmedSelf;

  const addressError = useMemo(() => {
    if (trimmedTarget.length === 0) return null;
    if (!isValidFormat) return "Enter a valid Stellar address.";
    if (isSelf) return "You cannot transfer a subscription to your own address.";
    return null;
  }, [trimmedTarget, isValidFormat, isSelf]);

  const allChecked = checklist.every(Boolean);
  const canConfirm = isValidFormat && !isSelf && allChecked && !submitting;

  const toggleChecklistItem = (index: number) => {
    setChecklist((prev) => prev.map((checked, i) => (i === index ? !checked : checked)));
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const xdr = await buildTransferSubscriptionTx(userKey, trimmedTarget);
      await onSign(xdr);
      onSuccess();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(friendlyError(message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-subscription-title"
      >
        <h3 id="transfer-subscription-title">Transfer Subscription Ownership</h3>
        <p>
          Move this subscription to a different Stellar address. Both you and the recipient must
          authorize the transfer in your wallets.
        </p>

        <label className="form-group">
          <span className="form-label">Target address</span>
          <input
            type="text"
            placeholder="G… (Stellar address)"
            value={targetAddress}
            onChange={(e) => setTargetAddress(e.target.value)}
            disabled={submitting}
            data-testid="transfer-address-input"
            aria-invalid={addressError ? true : undefined}
          />
        </label>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setShowAddressBook(true)}
          disabled={submitting}
          data-testid="transfer-address-book-button"
        >
          Choose from Address Book
        </button>
        {addressError && (
          <p className="text-error" role="alert">
            {addressError}
          </p>
        )}

        <fieldset className="form-group">
          <legend className="form-label">Before you continue, confirm the following</legend>
          {CHECKLIST_ITEMS.map((item, index) => (
            <label key={item} className="checklist-item">
              <input
                type="checkbox"
                checked={checklist[index]}
                onChange={() => toggleChecklistItem(index)}
                disabled={submitting}
                data-testid={`transfer-checklist-item-${index}`}
              />
              {item}
            </label>
          ))}
        </fieldset>

        <p className="text-sm text-muted">
          Warning: transferring ownership is irreversible. Once confirmed, this subscription can no
          longer be managed from your wallet.
        </p>

        {error && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={submitting}
            data-testid="transfer-cancel-button"
          >
            Cancel
          </button>
          <button
            className="btn-danger"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="transfer-confirm-button"
          >
            {submitting ? "Transferring…" : "Confirm Transfer"}
          </button>
        </div>
      </div>

      {showAddressBook && (
        <AddressBook
          onSelect={(address) => setTargetAddress(address)}
          onClose={() => setShowAddressBook(false)}
        />
      )}
    </div>
  );
}
