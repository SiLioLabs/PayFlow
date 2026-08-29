import React, { useEffect, useState } from "react";
import { buildSubscribeTx, DEFAULT_TOKEN } from "../stellar";
import {
  useFormValidation,
  validateAddress,
  validateInterval,
  validateStroopAmount,
  type FormFields,
} from "../hooks/useFormValidation";
import { BILLING_INTERVALS, CONTRACT_LIMITS } from "../constants";
import IntervalSelector from "./IntervalSelector";
import BalanceDisplay from "./BalanceDisplay";
import AllowanceDisplay from "./AllowanceDisplay";
import AddressBook from "./AddressBook";
import ToastContainer from "./Toast";
import { useToast } from "../hooks/useToast";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
  announce?: (message: string) => void;
  isPaused?: boolean;
}

type TouchedFields = {
  merchant: boolean;
  amount: boolean;
  interval: boolean;
};

function fieldsAreValid(fields: FormFields): boolean {
  return (
    validateAddress(fields.merchant).valid &&
    validateStroopAmount(fields.amount, CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).valid &&
    validateInterval(fields.interval, CONTRACT_LIMITS.MIN_INTERVAL_SECONDS).valid
  );
}

export default function SubscribeForm({
  userKey,
  onSign,
  onSuccess,
  announce,
  isPaused = false,
}: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const [referrer, setReferrer] = useState("");
  const [touched, setTouched] = useState<TouchedFields>({
    merchant: false,
    amount: false,
    interval: false,
  });
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const { errors, validate, validating } = useFormValidation();
  const { toasts, addToast, removeToast } = useToast();

  const fields: FormFields = { merchant, amount, interval };
  const canSubmit = fieldsAreValid(fields) && !pending && !validating && !isPaused;

  // Re-validate when touched fields change so errors clear as the user corrects them.
  useEffect(() => {
    if (touched.merchant || touched.amount || touched.interval) {
      validate(fields);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on field values + touched
  }, [merchant, amount, interval, touched.merchant, touched.amount, touched.interval, validate]);

  function handleBlur(field: keyof TouchedFields) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validate(fields);
  }

  function handleMerchantChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMerchant(e.target.value);
  }

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAmount(e.target.value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ merchant: true, amount: true, interval: true });
    setStatus(null);

    const ok = validate(fields);
    if (!ok) return;

    setPending(true);
    announce?.("Transaction submitted");
    try {
      const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
      const xdr = await buildSubscribeTx(
        userKey,
        merchant,
        stroops,
        BigInt(interval),
        DEFAULT_TOKEN,
        referrer.trim() || null,
        ""
      );
      const hash = await onSign(xdr);
      setStatus(`Subscribed! tx: ${hash.slice(0, 12)}…`);
      addToast("Subscribed!", "success", hash);
      announce?.("Transaction confirmed");
      onSuccess();
    } catch (err: unknown) {
      const msg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      setStatus(msg);
      addToast(msg, "error");
      announce?.(msg);
    } finally {
      setPending(false);
    }
  }

  const merchantError = touched.merchant && errors.merchant ? errors.merchant : undefined;
  const amountError = touched.amount && errors.amount ? errors.amount : undefined;
  const intervalError = touched.interval && errors.interval ? errors.interval : undefined;

  return (
    <form className="subscribe-form" onSubmit={handleSubmit} noValidate>
      <h2 className="subscribe-form__title">New Subscription</h2>

      <div className="form-group">
        <BalanceDisplay address={userKey} />
      </div>

      {/* Merchant Field */}
      <div className="form-group">
        <label className="form-label" htmlFor="merchant-input">
          Merchant address
        </label>
        <input
          id="merchant-input"
          data-testid="merchant-input"
          name="merchant"
          className="input"
          placeholder="G…"
          value={merchant}
          onChange={handleMerchantChange}
          onBlur={() => handleBlur("merchant")}
          aria-invalid={merchantError ? true : undefined}
          aria-describedby={merchantError ? "merchant-error" : undefined}
          autoComplete="off"
        />
        <button type="button" className="btn-secondary" onClick={() => setShowAddressBook(true)}>
          Select from Address Book
        </button>
        {merchantError && (
          <span
            id="merchant-error"
            data-testid="merchant-error"
            className="error-message text-error"
            role="alert"
          >
            {merchantError}
          </span>
        )}
      </div>

      {/* Amount Field */}
      <div className="form-group">
        <label className="form-label" htmlFor="amount-input">
          Amount (XLM per period)
        </label>
        <input
          id="amount-input"
          data-testid="amount-input"
          name="amount"
          className="input"
          type="number"
          min="0.0000001"
          step="0.0000001"
          placeholder="5"
          value={amount}
          onChange={handleAmountChange}
          onBlur={() => handleBlur("amount")}
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? "amount-error" : undefined}
        />
        {amountError && (
          <span
            id="amount-error"
            data-testid="amount-error"
            className="error-message text-error"
            role="alert"
          >
            {amountError}
          </span>
        )}
      </div>

      {/* Interval Field */}
      <div data-testid="interval-wrapper" tabIndex={-1} onBlur={() => handleBlur("interval")}>
        <IntervalSelector
          value={interval}
          onChange={(seconds) => {
            setInterval(seconds);
          }}
        />
        {intervalError && (
          <span
            id="interval-error"
            data-testid="interval-error"
            className="error-message text-error"
            role="alert"
          >
            {intervalError}
          </span>
        )}
      </div>

      {/* Referrer / allowance */}
      <div className="form-group">
        <label className="form-label" htmlFor="referrer-input">
          Referrer (optional)
        </label>
        <input
          id="referrer-input"
          data-testid="referrer-input"
          name="referrer"
          className="input"
          placeholder="Optional referrer G…"
          value={referrer}
          onChange={(e) => setReferrer(e.target.value)}
          autoComplete="off"
        />
        <AllowanceDisplay userKey={userKey} subscriptionAmount={0n} refreshTrigger={0} />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-primary subscribe-form__submit"
        aria-busy={pending || validating}
        aria-label={isPaused ? "Subscribe (unavailable during maintenance)" : undefined}
      >
        {pending ? "Confirming…" : validating ? "Validating…" : "Subscribe"}
      </button>

      {status && (
        <p className={`form-status${status.startsWith("Error") ? " text-error" : ""}`}>{status}</p>
      )}

      {showAddressBook && (
        <AddressBook
          onSelect={(address) => {
            setMerchant(address);
            setShowAddressBook(false);
          }}
          onClose={() => setShowAddressBook(false)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </form>
  );
}
