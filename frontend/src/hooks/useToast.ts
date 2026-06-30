/**
 * useToast - Manages an auto-dismissing toast notification queue.
 *
 * Adds toasts with success, error, or info variants. Each toast automatically
 * disappears after 5 seconds. A module-level counter ensures unique IDs across
 * all toast instances.
 *
 * @returns {Object} Toast queue and control methods
 * @returns {Toast[]} returns.toasts - Current array of active toasts
 * @returns {Function} returns.addToast - Queues a new toast notification
 * @returns {Function} returns.removeToast - Immediately removes a toast by id
 *
 * @example
 * const { toasts, addToast, removeToast } = useToast();
 *
 * const notify = () => addToast("Subscription created!", "success");
 * const dismiss = (id) => removeToast(id);
 *
 * return (
 *   <div>
 *     {toasts.map(t => (
 *       <div key={t.id} className={`toast toast--${t.variant}`}>
 *         {t.message}
 *       </div>
 *     ))}
 *   </div>
 * );
 */
import { useState, useCallback } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  txHash?: string;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", txHash?: string) => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, message, variant, txHash }]);
      setTimeout(() => removeToast(id), 5000);
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
