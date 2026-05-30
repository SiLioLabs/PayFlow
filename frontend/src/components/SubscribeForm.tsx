import React, { useMemo, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { buildSubscribeTx, DEFAULT_TOKEN } from "../stellar";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM, BILLING_INTERVALS } from "../constants";
import { useFormValidation } from "../hooks/useFormValidation";
import { useToast } from "../hooks/useToast";
import { useTransaction } from "../hooks/useTransaction";
import AllowanceDisplay from "./AllowanceDisplay";
import ToastContainer from "./Toast";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
  announce: (message: string) => void;
}

export default function SubscribeForm({ userKey, onSign, onSuccess, announce }: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const { errors, validate } = useFormValidation();
  const { toasts, addToast, removeToast } = useToast();
  const tx = useTransaction();

  function validateReferrer(value: string): string | null {
    if (!value) return null; // Optional field
    if (!StrKey.isValidEd25519PublicKey(value)) {
      return "Invalid Stellar address format";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate({ merchant, amount, interval })) return;

    announce("Transaction submitted");
    const hash = await tx.submit(async () => {
      const stroops = BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
      const xdr = await buildSubscribeTx(userKey, merchant, stroops, BigInt(interval), DEFAULT_TOKEN, null, "");
      return onSign(xdr);
    });

    if (hash) {
      addToast("Subscribed!", "success", hash);
      announce("Transaction confirmed");
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

      <label className="form-group">
        <span className="form-label">Billing interval</span>
        <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
          {BILLING_INTERVALS.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
        {errors.interval && <span className="text-error">{errors.interval}</span>}
      </label>

      <button type="submit" disabled={pending} className="btn-primary subscribe-form__submit">
        {pending ? "Confirming…" : "Subscribe"}
      </button>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </form>
  );
}
