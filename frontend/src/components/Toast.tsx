/**
 * ToastContainer - Renders the transient toast queue with WCAG 2.2.2
 * ("Timing Adjustable") compliant dismissal controls.
 *
 * WCAG 2.2.2 requires that non-essential, time-based content can be paused,
 * stopped, or extended by the user. A toast is exactly that kind of content, so
 * this component provides all three of the permitted mechanisms:
 *
 * 1. PAUSE - The dismiss countdown suspends while the pointer rests on a toast
 *    (`onMouseEnter`/`onMouseLeave`) and while keyboard focus is inside it
 *    (`onFocus`/`onBlur`). The remaining budget is preserved by the store, so a
 *    pause of any length resumes exactly where it stopped. Focus moving between
 *    controls *within* one toast is ignored, so tabbing from the dismiss button
 *    to the transaction link does not restart the clock.
 * 2. STOP - Each toast carries an explicit, labelled dismiss button. It is a
 *    real `<button type="button">`, so it is reachable and operable by keyboard
 *    alone and is never a mouse-only affordance.
 * 3. EXTEND - (1) and (2) together let the reader extend the reading time
 *    indefinitely without having to race the timer.
 *
 * Independently of the above, `useToast` also suspends every countdown while the
 * document is hidden or the window is unfocused, so backgrounding a tab cannot
 * silently discard a message that was never read.
 *
 * The container is a polite live region so the message is announced to screen
 * reader users, matching the convention used by the other status surfaces in
 * this app (see `ContractPauseBanner` and the announcer in `App.tsx`).
 */
import type { Toast } from "../hooks/useToast";
import { explorerTxUrl } from "../stellar";
import { formatAddress } from "../utils/format";
import { shouldShowToastWhilePaused } from "../utils/notificationPriority";

interface Props {
  toasts: Toast[];
  onRemove: (id: number) => void;
  /** Suspends the dismiss countdown for a toast (pointer hover / keyboard focus). */
  onPause: (id: number) => void;
  /** Restarts a suspended countdown from its remaining time. */
  onResume: (id: number) => void;
  /** When true, suppresses informational toasts so they don't compete with the contract pause banner. */
  isPaused?: boolean;
}

export default function ToastContainer({
  toasts,
  onRemove,
  onPause,
  onResume,
  isPaused = false,
}: Props) {
  const visibleToasts = toasts.filter((t) => shouldShowToastWhilePaused(t.variant, isPaused));
  if (!visibleToasts.length) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite" data-testid="toast-container">
      {visibleToasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.variant} fade-in`}
          data-testid={`toast-${t.id}`}
          onMouseEnter={() => onPause(t.id)}
          onMouseLeave={() => onResume(t.id)}
          onFocus={() => onPause(t.id)}
          onBlur={(e) => {
            // Keep the clock paused when focus simply moves to another control
            // in this same toast (e.g. dismiss button -> transaction link).
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            onResume(t.id);
          }}
        >
          <span>
            {t.message}
            {t.txHash && (
              <>
                {" "}
                <a
                  href={explorerTxUrl(t.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="toast__tx-link"
                  title={t.txHash}
                  style={{ textDecoration: "underline" }}
                >
                  tx: {formatAddress(t.txHash)}
                </a>
              </>
            )}
          </span>
          <button
            type="button"
            className="btn-secondary toast__dismiss"
            aria-label="Dismiss notification"
            title="Dismiss"
            onClick={() => onRemove(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
