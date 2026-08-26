import React, { useEffect, useMemo, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { buildSubscribeTx, DEFAULT_TOKEN } from "../stellar";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM, BILLING_INTERVALS } from "../constants"; // BILLING_INTERVALS used for initial value
import { useFormValidation } from "../hooks/useFormValidation";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../hooks/useToast";
import { useTransaction } from "../hooks/useTransaction";
import { getReferrerFromSearch } from "./ReferralPanel";
import BalanceDisplay from "./BalanceDisplay";
import AllowanceDisplay from "./AllowanceDisplay";
import ToastContainer from "./Toast";
import IntervalSelector from "./IntervalSelector";
import AddressBook from "./AddressBook";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
  announce: (message: string) => void;
  onSubscribed?: () => void;
}

export default function SubscribeForm({
  userKey,
  onSign,
  onSuccess,
  announce,
  onSubscribed,
}: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const [referrer, setReferrer] = useState("");
  const [referrerError, setReferrerError] = useState<string | null>(null);
  const [showAddressBook, setShowAddressBook] = useState(false);

  // Track which fields have been blurred (touched) for inline validation
  const [touched, setTouched] = useState<{ merchant: boolean; amount: boolean; interval: boolean }>({
    merchant: false,
    amount: false,
    interval: false,
  });

  const { errors, validate, validateAsync, validating, isValid } = useFormValidation();
  const { toasts, addToast, removeToast } = useToast();
  const tx = useTransaction();

  const debouncedMerchant = useDebounce(merchant, 500);

  // Pre-fill referrer from ?ref= URL query param (Issue #661)
  useEffect(() => {
    const refParam = getReferrerFromSearch(window.location.search);
    if (!refParam) return;

    // Warn if the ref param equals the connected user (self-referral)
    if (refParam === userKey) {
      setReferrerError("Self-referral is not allowed — the contract will ignore it.");
      return;
    }

    // Validate it looks like a Stellar address before pre-filling
    if (StrKey.isValidEd25519PublicKey(refParam)) {
      setReferrer(refParam);
    }
  }, [userKey]);

  // Validate whenever any field changes (drives isValid for submit button)
  useEffect(() => {
    validate({ merchant, amount, interval });
  }, [merchant, amount, interval, validate]);

  useEffect(() => {
    if (debouncedMerchant) {
      validateAsync({
        merchant: debouncedMerchant,
        amount: amount || "1",
        interval: interval || 30,
      });
    }
  }, [debouncedMerchant, validateAsync]);

  function handleBlur(field: "merchant" | "amount" | "interval") {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function validateReferrer(value: string): string | null {
    if (!value) return null; // optional field
    if (value === userKey) return "Self-referral is not allowed.";
    if (!StrKey.isValidEd25519PublicKey(value)) {
      return "Invalid Stellar address format";
    }
    return null;
  }

  function handleReferrerChange(value: string) {
    setReferrer(value);
    setReferrerError(validateReferrer(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Mark all fields as touched on submit attempt
    setTouched({ merchant: true, amount: true, interval: true });

    const isValidAsync = await validateAsync({ merchant, amount, interval });
    if (!isValidAsync) return;

    const refErr = validateReferrer(referrer);
    if (refErr) {
      setReferrerError(refErr);
      return;
    }

    announce("Transaction submitted");
    const hash = await tx.submit(async () => {
      const stroops = BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
      const refAddr = referrer && StrKey.isValidEd25519PublicKey(referrer) ? referrer : null;
      const xdr = await buildSubscribeTx(
        userKey,
        merchant,
        stroops,
        BigInt(interval),
        DEFAULT_TOKEN,
        refAddr,
        ""
      );
      return onSign(xdr);
    });

    if (hash) {
      addToast("Subscribed!", "success", hash);
      announce("Transaction confirmed");
      onSubscribed?.();
      onSuccess();
    } else if (tx.error) {
      const msg = `Error: ${friendlyError(tx.error)}`;
      addToast(msg, "error");
      announce(msg);
    }
  }

  const amountStroops = useMemo(() => {
    const parsed = parseFloat(amount);
    if (!amount || Number.isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.round(parsed * STROOPS_PER_XLM));
  }, [amount]);

  const pending = tx.status === "pending";
  const disabled = pending || validating || !isValid;

  // Only show errors for touched fields (blur-based inline validation)
  const visibleErrors = {
    merchant: touched.merchant ? errors.merchant : undefined,
    amount: touched.amount ? errors.amount : undefined,
    interval: touched.interval ? errors.interval : undefined,
  };

  return (
    <form onSubmit={handleSubmit} className="subscribe-form">
      <h2 className="subscribe-form__title">New Subscription</h2>

      <label className="form-group">
        <span className="form-label">Merchant address</span>
        <input
          placeholder="G…"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          onBlur={() => handleBlur("merchant")}
          required
          aria-invalid={touched.merchant ? !!errors.merchant : undefined}
          aria-describedby={visibleErrors.merchant ? "merchant-error" : undefined}
          data-testid="merchant-input"
        />
        {visibleErrors.merchant && (
          <span
            id="merchant-error"
            className="text-error"
            role="alert"
            data-testid="merchant-error"
          >
            {visibleErrors.merchant}
          </span>
        )}
        <button
          type="button"
          className="btn-secondary subscribe-form__address-book-btn"
          onClick={() => setShowAddressBook(true)}
          aria-label="Select merchant from address book"
        >
          📋 Select from Address Book
        </button>
      </label>

      {showAddressBook && (
        <AddressBook
          onSelect={(address) => {
            setMerchant(address);
          }}
          onClose={() => setShowAddressBook(false)}
        />
      )}

      <BalanceDisplay address={userKey} />

      <label className="form-group">
        <span className="form-label">Amount (XLM per period)</span>
        <input
          type="number"
          min="0.0000001"
          step="0.0000001"
          placeholder="5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => handleBlur("amount")}
          required
          aria-invalid={touched.amount ? !!errors.amount : undefined}
          aria-describedby={visibleErrors.amount ? "amount-error" : undefined}
          data-testid="amount-input"
        />
        {visibleErrors.amount && (
          <span
            id="amount-error"
            className="text-error"
            role="alert"
            data-testid="amount-error"
          >
            {visibleErrors.amount}
          </span>
        )}
        {userKey && (
          <AllowanceDisplay
            userKey={userKey}
            subscriptionAmount={amountStroops}
            refreshTrigger={0}
          />
        )}
      </label>

      {/* #278 — Use dedicated IntervalSelector instead of inline <select> */}
      <div
        onBlur={() => handleBlur("interval")}
        data-testid="interval-wrapper"
      >
        <IntervalSelector value={interval} onChange={setInterval} />
      </div>
      {visibleErrors.interval && (
        <span
          id="interval-error"
          className="text-error"
          role="alert"
          data-testid="interval-error"
          aria-live="polite"
        >
          {visibleErrors.interval}
        </span>
      )}

      {/* Referrer field — pre-filled from ?ref= URL param (Issue #661) */}
      <label className="form-group">
        <span className="form-label">
          Referrer address{" "}
          <span className="text-muted" style={{ fontWeight: "normal" }}>
            (optional)
          </span>
        </span>
        <input
          placeholder="G… (optional)"
          value={referrer}
          onChange={(e) => handleReferrerChange(e.target.value)}
          aria-label="Referrer Stellar address (optional)"
          aria-describedby={referrerError ? "referrer-error" : undefined}
          aria-invalid={!!referrerError}
          data-testid="referrer-input"
        />
      </label>

      <div className="form-group">
        {referrerError && (
          <span
            id="referrer-error"
            className="text-error"
            role="alert"
            data-testid="referrer-error"
          >
            {referrerError}
          </span>
        )}
      </div>

      <button type="submit" disabled={disabled} className="btn-primary subscribe-form__submit" aria-busy={pending || validating}>
      <button type="submit" disabled={disabled} className="btn-primary subscribe-form__submit">
        {pending ? "Confirming…" : validating ? "Validating…" : "Subscribe"}
      </button>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </form>
  );
}
