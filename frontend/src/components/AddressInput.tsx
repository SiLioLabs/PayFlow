import React, { useState, useEffect } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { useDebounce } from "../hooks/useDebounce";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  testId?: string;
}

export default function AddressInput({
  label,
  value,
  onChange,
  id = "stellar-address-input",
  testId = "address-input",
}: Props) {
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

  const isValid = !!debouncedValue && !error;
  const stateClass = !value ? "" : isValid ? "input--valid" : error ? "input--error" : "";
  const errorId = `${id}-error`;

  function validateNow(val: string) {
    if (!val) {
      setError(null);
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(val)) {
      setError("Invalid Stellar address");
    } else {
      setError(null);
    }
  }

  return (
    <div className="form-group">
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      <input
        id={id}
        data-testid={testId}
        className={`input ${stateClass}`.trim()}
        type="text"
        placeholder="G…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => validateNow(value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <span id={errorId} className="text-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
