/**
 * useToast - Manages an auto-dismissing toast notification queue and a
 * persistent notification centre.
 *
 * Toasts auto-dismiss after {@link TOAST_DURATION_MS} but are kept in the
 * notification list for the whole session (persisted to sessionStorage so a page
 * refresh does not clear mid-session activity). The notification list is capped
 * at 50 entries; older items are dropped with a single
 * "X older notifications cleared" sentinel.
 *
 * Accessibility (WCAG 2.2.2 "Timing Adjustable"):
 * The auto-dismiss countdown is treated as *suspendable* rather than absolute.
 * A running countdown can be paused three ways, and the pause survives however
 * long it lasts because the remaining time is stored per toast:
 *
 * 1. `pauseToast(id)` / `resumeToast(id)` — driven by the container from
 *    pointer hover and keyboard focus. This is the "extend" affordance: moving
 *    the pointer over a toast or tabbing into it buys the reader as long as
 *    they need.
 * 2. A global suspension while the document is hidden or the window is not
 *    focused, so switching tabs or windows never silently destroys messages
 *    that were never actually read.
 * 3. `removeToast(id)` — the explicit "stop" affordance, wired to the
 *    per-toast dismiss button in `ToastContainer`.
 *
 * `pauseToast`/`resumeToast` are no-ops while the global suspension is active so
 * that pointer state and window state cannot fight each other; the countdown
 * resumes only once the tab is visible and focused again.
 *
 * @returns {Object} Toast queue and control methods
 * @returns {Toast[]}         returns.toasts          - Active (visible) toasts
 * @returns {Notification[]}  returns.notifications   - Full session history
 * @returns {number}          returns.unreadCount     - Count of unread notifications
 * @returns {Function}        returns.addToast        - Queues a new toast & notification
 * @returns {Function}        returns.removeToast     - Immediately removes a toast by id
 * @returns {Function}        returns.pauseToast      - Suspends a toast's dismiss countdown
 * @returns {Function}        returns.resumeToast     - Restarts a paused countdown with its remaining time
 * @returns {Function}        returns.markAllRead     - Marks all notifications as read
 * @returns {Function}        returns.clearNotifications - Empties the notification list
 */
import { useState, useCallback, useEffect, useRef } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  txHash?: string;
}

export interface Notification {
  id: number;
  message: string;
  variant: ToastVariant;
  timestamp: Date;
  txHash?: string;
  read: boolean;
}

/** Time a freshly queued toast stays on screen before auto-dismissing. */
export const TOAST_DURATION_MS = 5000;

const MAX_NOTIFICATIONS = 50;
const SESSION_KEY = "flowpay_notifications";

let nextId = 0;

/**
 * Per-toast countdown bookkeeping. The countdown is stored as a *remaining*
 * budget rather than a single deadline so that pausing mid-countdown and
 * resuming much later resumes from where it stopped instead of restarting or
 * overshooting.
 */
interface ToastTimer {
  /** Ms left when paused; the full duration while running. */
  remaining: number;
  /** When the current running segment began, or null while paused. */
  startedAt: number | null;
  handle: ReturnType<typeof setTimeout> | null;
}

// ── sessionStorage helpers ───────────────────────────────────────────────────

function loadFromSession(): Notification[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<
      Omit<Notification, "timestamp"> & { timestamp: string }
    >;
    return parsed.map((n) => ({ ...n, timestamp: new Date(n.timestamp) }));
  } catch {
    return [];
  }
}

function saveToSession(notifications: Notification[]): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(notifications));
  } catch {
    // sessionStorage may be unavailable (private browsing, quota exceeded, etc.)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(loadFromSession);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Timer bookkeeping lives in a ref: it is imperative bookkeeping, not render
  // output, and mutating it must never re-render the queue.
  const timers = useRef(new Map<number, ToastTimer>());

  // True while the document is hidden or the window is unfocused. While set,
  // every countdown is held back regardless of pointer/keyboard state.
  const suspended = useRef(false);

  const discardTimer = useCallback((id: number) => {
    const entry = timers.current.get(id);
    if (!entry) return;
    if (entry.handle !== null) clearTimeout(entry.handle);
    timers.current.delete(id);
  }, []);

  const removeToast = useCallback(
    (id: number) => {
      discardTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [discardTimer]
  );

  const startTimer = useCallback(
    (id: number, ms: number) => {
      timers.current.set(id, {
        remaining: ms,
        startedAt: Date.now(),
        handle: setTimeout(() => removeToast(id), ms),
      });
    },
    [removeToast]
  );

  const pauseTimer = useCallback((id: number) => {
    const entry = timers.current.get(id);
    // Unknown id (already dismissed) or already paused — nothing to do.
    if (!entry || entry.startedAt === null) return;
    entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
    if (entry.handle !== null) clearTimeout(entry.handle);
    entry.handle = null;
    entry.startedAt = null;
  }, []);

  const resumeTimer = useCallback(
    (id: number) => {
      const entry = timers.current.get(id);
      // Unknown id, or already running.
      if (!entry || entry.startedAt !== null) return;
      // The budget ran out while paused; honour it immediately rather than
      // keeping a message on screen past its deadline.
      if (entry.remaining <= 0) {
        removeToast(id);
        return;
      }
      startTimer(id, entry.remaining);
    },
    [removeToast, startTimer]
  );

  const pauseToast = useCallback(
    (id: number) => {
      // The global suspension already holds every countdown, so honouring
      // hover here would only be undone by the next window event.
      if (suspended.current) return;
      pauseTimer(id);
    },
    [pauseTimer]
  );

  const resumeToast = useCallback(
    (id: number) => {
      if (suspended.current) return;
      resumeTimer(id);
    },
    [resumeTimer]
  );

  // Hold every countdown back while the tab is backgrounded or unfocused, and
  // hand control back to the remaining budget on return.
  useEffect(() => {
    const suspendAll = () => {
      suspended.current = true;
      timers.current.forEach((_entry, id) => pauseTimer(id));
    };
    const resumeAll = () => {
      suspended.current = false;
      timers.current.forEach((_entry, id) => resumeTimer(id));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") suspendAll();
      else resumeAll();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", suspendAll);
    window.addEventListener("focus", resumeAll);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", suspendAll);
      window.removeEventListener("focus", resumeAll);
    };
  }, [pauseTimer, resumeTimer]);

  // Never let a pending timeout outlive the component that owns the queue.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((entry) => {
        if (entry.handle !== null) clearTimeout(entry.handle);
      });
      pending.clear();
    };
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", txHash?: string) => {
      const id = ++nextId;

      // Add to visible toast queue
      setToasts((prev) => [...prev, { id, message, variant, txHash }]);
      if (suspended.current) {
        // Queued while backgrounded: bank the full budget, start nothing.
        timers.current.set(id, {
          remaining: TOAST_DURATION_MS,
          startedAt: null,
          handle: null,
        });
      } else {
        startTimer(id, TOAST_DURATION_MS);
      }

      // Accumulate in notification history (capped at MAX_NOTIFICATIONS)
      setNotifications((prev) => {
        const newEntry: Notification = {
          id,
          message,
          variant,
          timestamp: new Date(),
          txHash,
          read: false,
        };

        let updated = [newEntry, ...prev];

        if (updated.length > MAX_NOTIFICATIONS) {
          const overflow = updated.length - MAX_NOTIFICATIONS;
          // Keep the first MAX_NOTIFICATIONS entries; drop the tail
          updated = updated.slice(0, MAX_NOTIFICATIONS);
          // Replace the last kept entry with a sentinel if the tail wasn't already one
          const last = updated[updated.length - 1];
          if (!last.message.includes("older notification")) {
            updated[updated.length - 1] = {
              id: last.id,
              message: `${overflow + 1} older notification${overflow + 1 !== 1 ? "s" : ""} cleared`,
              variant: "info",
              timestamp: last.timestamp,
              read: true,
            };
          }
        }

        saveToSession(updated);
        return updated;
      });
    },
    [startTimer]
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveToSession(updated);
      return updated;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }, []);

  return {
    toasts,
    notifications,
    unreadCount,
    addToast,
    removeToast,
    pauseToast,
    resumeToast,
    markAllRead,
    clearNotifications,
  };
}
