import React, { useId } from "react";
import { parseAddressList } from "../../utils/addressValidation";

interface Props {
  /** Field label rendered above the textarea */
  label: string;
  /** Raw multiline text value */
  value: string;
  /** Called whenever the textarea changes */
  onChange: (value: string) => void;
  /** Placeholder text inside the textarea */
  placeholder?: string;
  /** Whether the textarea is disabled */
  disabled?: boolean;
}

/**
 * AddressListInput — multiline textarea that accepts one Stellar address per
 * line (or comma-separated). Shows per-line validation feedback and a count
 * of valid/invalid/duplicate addresses below the input.
 */
export default function AddressListInput({
  label,
  value,
  onChange,
  placeholder = "One Stellar address per line (G…)",
  disabled = false,
}: Props) {
  const id = useId();
  const descId = `${id}-desc`;

  const { valid, invalid, duplicates } = parseAddressList(value);
  const hasContent = value.trim().length > 0;
  const hasInvalid = invalid.length > 0;

  const stateClass = !hasContent ? "" : hasInvalid ? "input--error" : "input--valid";

  return (
    <div className="form-group">
      <label htmlFor={id} className="form-label">
        {label}
      </label>

      <textarea
        id={id}
        aria-describedby={descId}
        aria-invalid={hasInvalid ? "true" : "false"}
        className={`input address-list-input ${stateClass}`.trim()}
        rows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        style={{ fontFamily: "monospace", resize: "vertical" }}
      />

      <div id={descId} className="address-list-input__status" aria-live="polite">
        {hasContent && (
          <ul
            className="address-list-input__counts"
            style={{ listStyle: "none", padding: 0, margin: "4px 0 0", fontSize: "0.8rem" }}
          >
            {valid.length > 0 && (
              <li style={{ color: "var(--color-success, #22c55e)" }}>
                ✓ {valid.length} valid address{valid.length !== 1 ? "es" : ""}
              </li>
            )}
            {invalid.length > 0 && (
              <li className="text-error">
                ✗ {invalid.length} invalid address{invalid.length !== 1 ? "es" : ""}:
                <ul style={{ paddingLeft: "1rem", marginTop: "2px" }}>
                  {invalid.slice(0, 5).map((addr) => (
                    <li key={addr} style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                      {addr.length > 40 ? `${addr.slice(0, 20)}…${addr.slice(-8)}` : addr}
                    </li>
                  ))}
                  {invalid.length > 5 && <li>…and {invalid.length - 5} more</li>}
                </ul>
              </li>
            )}
            {duplicates.length > 0 && (
              <li style={{ color: "var(--color-warning, #f59e0b)" }}>
                ⚠ {duplicates.length} duplicate{duplicates.length !== 1 ? "s" : ""} will be removed
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
