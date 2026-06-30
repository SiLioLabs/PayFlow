import React, { useMemo, useState, useEffect } from "react";
import { buildSubscribeTx, DEFAULT_TOKEN } from "../stellar";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM, BILLING_INTERVALS } from "../constants"; // BILLING_INTERVALS used for initial value
import { useFormValidation } from "../hooks/useFormValidation";
import { useDebounce } from "../hooks/useDebounce";
import { useToast } from "../hooks/useToast";
import { useTransaction } from "../hooks/useTransaction";
import BalanceDisplay from "./BalanceDisplay";
import AllowanceDisplay from "./AllowanceDisplay";
import ToastContainer from "./Toast";
import IntervalSelector from "./IntervalSelector";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
  announce: (message: string) => void;
  onSubscribed?: () => void;
}

export default function SubscribeForm({ userKey, onSign, onSuccess, announce, onSubscribed }: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const { errors, validate, validateAsync, validating, isValid } = useFormValidation();
  const { toasts, addToast, removeToast } = useToast();
  const tx = useTransaction();

  const debouncedMerchant = useDebounce(merchant, 500);

  // Validate whenever any field changes
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


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isValidAsync = await validateAsync({ merchant, amount, interval });
    if (!isValidAsync) return;

    announce("Transaction submitted");
    const hash = await tx.submit(async () => {
      const stroops = BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
      const xdr = await buildSubscribeTx(userKey, merchant, stroops, BigInt(interval), DEFAULT_TOKEN, null, "");
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

  return (
    <form onSubmit={handleSubmit} className="subscribe-form">
      <h2 className="subscribe-form__title">New Subscription</h2>

      <label className="form-group">
        <span className="form-label">Merchant address</span>
        <input
          placeholder="G…"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          required
        />
        {errors.merchant && <span className="text-error">{errors.merchant}</span>}
      </label>

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
          required
        />
        {errors.amount && <span className="text-error">{errors.amount}</span>}
        {userKey && (
          <AllowanceDisplay
            userKey={userKey}
            subscriptionAmount={amountStroops}
            refreshTrigger={0}
          />
        )}
      </label>

      {/* #278 — Use dedicated IntervalSelector instead of inline <select> */}
      <IntervalSelector value={interval} onChange={setInterval} />
      {errors.interval && <span className="text-error">{errors.interval}</span>}

      <button type="submit" disabled={disabled} className="btn-primary subscribe-form__submit">
        {pending ? "Confirming…" : validating ? "Validating…" : "Subscribe"}
      </button>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </form>
  );
}

