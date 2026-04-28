import React, { useState } from "react";
import { buildSubscribeTx } from "../stellar";
import { friendlyError } from "../utils/errors";
import { STROOPS_PER_XLM, BILLING_INTERVALS } from "../constants";
import { useFormValidation } from "../hooks/useFormValidation";

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
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { errors, validate } = useFormValidation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate({ merchant, amount, interval })) return;
    setStatus(null);
    setLoading(true);
    announce("Transaction submitted");
    try {
      const stroops = BigInt(Math.round(parseFloat(amount) * STROOPS_PER_XLM));
      const xdr = await buildSubscribeTx(userKey, merchant, stroops, BigInt(interval));
      const hash = await onSign(xdr);
      const msg = `Subscribed! tx: ${hash.slice(0, 12)}…`;
      setStatus(msg);
      announce("Transaction confirmed");
      onSuccess();
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const msg = `Error: ${friendlyError(rawMessage)}`;
      setStatus(msg);
      announce(msg);
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
      </label>

      <button type="submit" disabled={loading} className="btn-primary subscribe-form__submit">
        {loading ? "Signing…" : "Subscribe"}
      </button>

      {status && (
        /* Dynamic: color is error/success state-driven — inline color is intentional */
        <p
          className="form-status"
          style={{
            color: status.startsWith("Error") ? "var(--color-danger)" : "var(--color-success)",
          }}
        >
          {status}
        </p>
      )}
    </form>
  );
}
