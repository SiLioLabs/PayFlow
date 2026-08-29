import type { ToastVariant } from "../hooks/useToast";

/**
 * Decides whether a toast should be shown while the contract is paused.
 *
 * The contract pause banner (role="alert") is the single source of truth for
 * maintenance state and must take visual precedence over transient toasts.
 * Informational toasts add nothing the banner hasn't already said, so they
 * are suppressed while paused. Success/error toasts reflect the direct
 * consequences of the user's own actions and are always shown regardless of
 * pause state.
 */
export function shouldShowToastWhilePaused(variant: ToastVariant, isPaused: boolean): boolean {
  if (!isPaused) return true;
  return variant !== "info";
}
