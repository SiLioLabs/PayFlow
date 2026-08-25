/**
 * useToast - Manages an auto-dismissing toast notification queue and a
 * persistent notification centre.
 *
 * Toasts auto-dismiss after 5 s but are kept in the notification list for the
 * whole session (persisted to sessionStorage so a page refresh does not clear
 * mid-session activity). The notification list is capped at 50 entries; older
 * items are dropped with a single "X older notifications cleared" sentinel.
 *
 * @returns {Object} Toast queue and control methods
 * @returns {Toast[]}         returns.toasts          - Active (visible) toasts
 * @returns {Notification[]}  returns.notifications   - Full session history
 * @returns {number}          returns.unreadCount     - Count of unread notifications
 * @returns {Function}        returns.addToast        - Queues a new toast & notification
 * @returns {Function}        returns.removeToast     - Immediately removes a toast by id
 * @returns {Function}        returns.markAllRead     - Marks all notifications as read
 * @returns {Function}        returns.clearNotifications - Empties the notification list
 */
import { useState, useCallback } from "react";

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

const MAX_NOTIFICATIONS = 50;
const SESSION_KEY = "flowpay_notifications";

let nextId = 0;

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

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", txHash?: string) => {
      const id = ++nextId;

      // Add to visible toast queue
      setToasts((prev) => [...prev, { id, message, variant, txHash }]);
      setTimeout(() => removeToast(id), 5000);

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
    [removeToast]
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
    markAllRead,
    clearNotifications,
  };
}
