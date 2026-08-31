import { NETWORK_PASSPHRASE } from "../stellar";

export const MAINNET_CONFIRM_KEY = "flowpay_mainnet_confirmed";

/**
 * Returns true when the given passphrase corresponds to Stellar Public Network (Mainnet).
 * Matches the same heuristic as NetworkBadge: presence of "Public Global".
 */
export function isMainnetPassphrase(passphrase: string): boolean {
  return passphrase.includes("Public Global");
}

/** Whether the app's configured NETWORK_PASSPHRASE points at Mainnet. */
export function isMainnetNetwork(): boolean {
  return isMainnetPassphrase(NETWORK_PASSPHRASE);
}

/** Whether the user has confirmed mainnet usage in this session. */
export function isMainnetConfirmed(): boolean {
  try {
    return sessionStorage.getItem(MAINNET_CONFIRM_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist mainnet confirmation for the current session. */
export function setMainnetConfirmed(): void {
  try {
    sessionStorage.setItem(MAINNET_CONFIRM_KEY, "true");
  } catch {
    // sessionStorage unavailable (SSR/test) — no-op
  }
}

/**
 * Clears mainnet confirmation. Exported for tests and for manual reset flows.
 */
export function clearMainnetConfirmed(): void {
  try {
    sessionStorage.removeItem(MAINNET_CONFIRM_KEY);
  } catch {
    // ignore
  }
}

/**
 * Guard helper for mutating transactions. When on mainnet and not yet confirmed,
 * prompts the user via window.confirm. Returns true if allowed to proceed, false if cancelled.
 * Persists confirmation on accept so subsequent calls in the same session skip the prompt.
 *
 * Testable: `confirmFn` injection avoids window.confirm in unit tests.
 */
export function ensureMainnetConfirmed(
  confirmFn: () => boolean = () =>
    typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(
          "You are about to transact on Mainnet with real funds. " +
            "Please confirm you intend to use Mainnet. This will be remembered for this session."
        )
      : false
): boolean {
  if (!isMainnetNetwork()) return true;
  if (isMainnetConfirmed()) return true;
  const ok = confirmFn();
  if (ok) setMainnetConfirmed();
  return ok;
}
