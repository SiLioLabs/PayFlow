import React, { useState, useEffect } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { useDebounce } from "../hooks/useDebounce";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export default function AddressInput({ label, value, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const debouncedValue = useDebounce(value, 300);

  useEffect(() => {
    if (!debouncedValue) {
      setError(null);
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(debouncedValue)) {
      setError("Invalid Stellar address");
    } else {
      setError(null);
    }
  }, [debouncedValue]);

  const isValid = value && !error && StrKey.isValidEd25519PublicKey(value);
  const stateClass = !value ? "" : isValid ? "input--valid" : error ? "input--error" : "";

  return (
    <label className="form-group">
      <span className="form-label">{label}</span>
      <input
        className={`input ${stateClass}`.trim()}
        type="text"
        placeholder="G…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span className="text-error">{error}</span>}
    </label>
  );
}
