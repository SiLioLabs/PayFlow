import React, { useState } from "react";
import { buildSubscribeTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM, BILLING_INTERVALS } from "../constants";
import { useToast } from "../hooks/useToast";
import ToastContainer from "./Toast";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
}

export default function SubscribeForm({ userKey, onSign, onSuccess }: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const [loading, setLoading] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const stroops = BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
      const xdr = await buildSubscribeTx(userKey, merchant, stroops, BigInt(interval));
      const hash = await onSign(xdr);
      addToast(`Subscribed! tx: ${hash.slice(0, 12)}…`, "success");
      onSuccess();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      addToast(friendlyError(rawMessage), "error");
    } finally {
      setLoading(false);
    }
  }

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
      </label>

      <button type="submit" disabled={loading} className="btn-primary subscribe-form__submit">
        {loading ? "Signing…" : "Subscribe"}
      </button>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </form>
  );
}
