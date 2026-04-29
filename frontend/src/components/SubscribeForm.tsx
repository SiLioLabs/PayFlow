import React, { useState } from "react";
import { buildSubscribeTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM, BILLING_INTERVALS } from "../constants";
import { useFormValidation } from "../hooks/useFormValidation";
import { useToast } from "../hooks/useToast";
import { useTransaction } from "../hooks/useTransaction";
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate({ merchant, amount, interval })) return;

    announce("Transaction submitted");
    const hash = await tx.submit(async () => {
      const stroops = BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
      const xdr = await buildSubscribeTx(userKey, merchant, stroops, BigInt(interval));
      return onSign(xdr);
    });

    if (hash) {
      addToast(`Subscribed! tx: ${hash.slice(0, 12)}…`, "success");
      announce("Transaction confirmed");
      onSuccess();
    } else if (tx.error) {
      const msg = `Error: ${friendlyError(tx.error)}`;
      addToast(msg, "error");
      announce(msg);
    }
  }

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
