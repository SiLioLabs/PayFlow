import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import type { Toast, ToastVariant, Notification } from "../hooks/useToast";

interface ToastContextValue {
  toasts: Toast[];
  notifications: Notification[];
  unreadCount: number;
  addToast: (message: string, variant?: ToastVariant, txHash?: string) => void;
  removeToast: (id: number) => void;
  pauseToast: (id: number) => void;
  resumeToast: (id: number) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastContext must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try {
      const raw = sessionStorage.getItem("flowpay_notifications");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<
        Omit<Notification, "timestamp"> & { timestamp: string }
      >;
      return parsed.map((n) => ({ ...n, timestamp: new Date(n.timestamp) }));
    } catch {
      return [];
    }
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const timers = useRef(new Map<number, { remaining: number; startedAt: number | null; handle: ReturnType<typeof setTimeout> | null }>());

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
    if (!entry || entry.startedAt === null) return;
    entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
    if (entry.handle !== null) clearTimeout(entry.handle);
    entry.handle = null;
    entry.startedAt = null;
  }, []);

  const resumeTimer = useCallback(
    (id: number) => {
      const entry = timers.current.get(id);
      if (!entry || entry.startedAt !== null) return;
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

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((entry) => {
        if (entry.handle !== null) clearTimeout(entry.handle);
      });
      pending.clear();
    };
  }, []);

  let nextId = 0;

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", txHash?: string) => {
      const id = ++nextId;

      setToasts((prev) => [...prev, { id, message, variant, txHash }]);
      if (suspended.current) {
        timers.current.set(id, {
          remaining: 5000,
          startedAt: null,
          handle: null,
        });
      } else {
        startTimer(id, 5000);
      }

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

        if (updated.length > 50) {
          const overflow = updated.length - 50;
          updated = updated.slice(0, 50);
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

        try {
          sessionStorage.setItem("flowpay_notifications", JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    },
    [startTimer]
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      try {
        sessionStorage.setItem("flowpay_notifications", JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    try {
      sessionStorage.removeItem("flowpay_notifications");
    } catch {
      // ignore
    }
  }, []);

  const value: ToastContextValue = {
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

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}