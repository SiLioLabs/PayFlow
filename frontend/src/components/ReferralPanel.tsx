/**
 * ReferralPanel — shows the connected user's referral link and referred count.
 *
 * - Displays the user's own address as a shareable referral code
 * - Generates a share link: <BASE_URL>/?ref=<ADDRESS>
 *   (base URL is VITE_APP_BASE_URL env var, falls back to https://app.payflow.io)
 * - Copy button for both the raw address and the full share link
 * - Counts users referred by querying 'referred' contract events
 * - Shows a self-referral warning if the URL ?ref= param matches the user's address
 *
 * Issue #661
 */
import React, { useEffect, useMemo, useState } from "react";
import { fetchEvents } from "../stellar";
import { useClipboard } from "../hooks/useClipboard";

// ── Config ────────────────────────────────────────────────────────────────────

const APP_BASE_URL =
  (import.meta as unknown as { env: Record<string, string> }).env?.VITE_APP_BASE_URL ??
  "https://app.payflow.io";

// ── Exported helpers (tested independently) ───────────────────────────────────

/** Build the referral share URL for a given Stellar address. */
export function buildReferralUrl(address: string, baseUrl = APP_BASE_URL): string {
  return `${baseUrl}/?ref=${address}`;
}

/**
 * Read the ?ref= query param from a URL search string (e.g. window.location.search).
 * Returns null if the param is absent or empty.
 */
export function getReferrerFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const ref = params.get("ref");
  return ref && ref.trim() ? ref.trim() : null;
}

// ── Copy icon / Check icon (inline to avoid extra files) ─────────────────────

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="fade-in"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Inline copy button (uses its own useClipboard instance) ───────────────────

interface InlineCopyButtonProps {
  text: string;
  ariaLabel: string;
}

function InlineCopyButton({ text, ariaLabel }: InlineCopyButtonProps) {
  const { copied, copy } = useClipboard();
  return (
    <button
      className="btn-secondary copy-btn referral-copy-btn"
      onClick={() => copy(text)}
      aria-label={ariaLabel}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span className="referral-copy-btn__label">{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
}

// ── ReferralPanel ─────────────────────────────────────────────────────────────

interface Props {
  /** Connected wallet public key — null when wallet not yet connected */
  publicKey: string | null;
}

export default function ReferralPanel({ publicKey }: Props) {
  const [referredCount, setReferredCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Detect self-referral: check if current URL contains ?ref=<publicKey>
  const selfReferralWarning = useMemo(() => {
    if (!publicKey) return false;
    const refParam = getReferrerFromSearch(window.location.search);
    return refParam === publicKey;
  }, [publicKey]);

  const referralUrl = useMemo(
    () => (publicKey ? buildReferralUrl(publicKey) : buildReferralUrl("YOUR_ADDRESS")),
    [publicKey]
  );

  // Fetch referred count from contract events
  useEffect(() => {
    if (!publicKey) return;

    setLoadingCount(true);
    fetchEvents("referred", publicKey)
      .then(({ events }) => {
        // Each 'referred' event where topic[1] === publicKey means this user
        // referred someone. Count unique referred addresses.
        const uniqueReferees = new Set(events.map((e) => e.address).filter(Boolean));
        setReferredCount(uniqueReferees.size);
      })
      .catch(() => setReferredCount(null))
      .finally(() => setLoadingCount(false));
  }, [publicKey]);

  return (
    <section className="referral-panel card" aria-label="Referral program">
      <div className="referral-panel__header">
        <h3 className="referral-panel__title">Referral Program</h3>
        <p className="referral-panel__subtitle text-muted text-sm">
          Share your referral link to invite others to FlowPay.
        </p>
      </div>

      {/* Self-referral warning */}
      {selfReferralWarning && (
        <div
          className="referral-panel__self-warning"
          role="alert"
          data-testid="self-referral-warning"
        >
          ⚠ You cannot refer yourself — the referral will be ignored by the contract.
        </div>
      )}

      {/* Referral code (user's own address) */}
      <div className="referral-panel__section">
        <span className="referral-panel__label text-sm text-muted">Your referral code</span>
        <div className="referral-panel__code-row">
          <code
            className="referral-panel__code"
            data-testid="referral-code"
            aria-label="Your referral code"
          >
            {publicKey ?? "Connect wallet to see your referral code"}
          </code>
          {publicKey && (
            <InlineCopyButton text={publicKey} ariaLabel="Copy referral code (wallet address)" />
          )}
        </div>
      </div>

      {/* Share link */}
      <div className="referral-panel__section">
        <span className="referral-panel__label text-sm text-muted">Share link</span>
        <div className="referral-panel__link-row">
          <a
            href={publicKey ? referralUrl : undefined}
            className="referral-panel__link text-sm"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open referral link in new tab"
            data-testid="referral-link"
          >
            {referralUrl}
          </a>
          {publicKey && (
            <InlineCopyButton text={referralUrl} ariaLabel="Copy referral share link" />
          )}
        </div>
      </div>

      {/* Referred count */}
      <div className="referral-panel__stats" aria-live="polite" aria-atomic="true">
        <span className="referral-panel__stat-label text-sm text-muted">Users referred</span>
        <span
          className="referral-panel__stat-value"
          data-testid="referred-count"
          aria-label={
            loadingCount
              ? "Loading referred count"
              : referredCount === null
                ? "Referred count unavailable"
                : `${referredCount} users referred`
          }
        >
          {loadingCount ? (
            <span className="skeleton referral-skeleton" aria-hidden="true" />
          ) : referredCount === null ? (
            <span className="text-muted">—</span>
          ) : (
            <strong>{referredCount}</strong>
          )}
        </span>
      </div>
    </section>
  );
}
