// CopyButton: copies a Stellar address to clipboard with a 200ms fade-in checkmark feedback (#56)
import React from "react";
import { useClipboard } from "../hooks/useClipboard";

interface Props {
  text: string;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="fade-in" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function CopyButton({ text }: Props) {
  const { copied, copy } = useClipboard();

  return (
    <button className="btn-secondary copy-btn" onClick={() => copy(text)} title="Copy to clipboard" aria-label="Copy address">
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
