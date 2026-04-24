import React, { useState } from "react";
import { buildSubscribeTx } from "../stellar";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
}

const INTERVALS = [
  { label: "Daily", value: 86_400 },
  { label: "Weekly", value: 604_800 },
  { label: "Monthly (~30d)", value: 2_592_000 },
];

export default function SubscribeForm({ userKey, onSign, onSuccess }: Props) {
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState(INTERVALS[2].value);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    try {
      // Convert XLM → stroops (1 XLM = 10_000_000)
      const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
      const xdr = await buildSubscribeTx(
        userKey,
        merchant,
        stroops,
        BigInt(interval)
      );
      const hash = await onSign(xdr);
      setStatus(`Subscribed! tx: ${hash.slice(0, 12)}…`);
      onSuccess();
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
        <select
          value={interval}
          onChange={(e) => setInterval(Number(e.target.value))}
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
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
          style={{ color: status.startsWith("Error") ? "var(--color-danger)" : "var(--color-success)" }}
        >
          {status}
        </p>
      )}
    </form>
  );
}
