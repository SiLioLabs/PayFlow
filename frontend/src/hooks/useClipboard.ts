import { useState, useCallback } from "react";

/**
 * useClipboard - Copies text to the system clipboard.
 *
 * Exposes:
 * - `copy(text)` to write to `navigator.clipboard`
 * - `copied` for a short time after a successful copy
 * - `error` for a short time if the copy fails
 *
 * @param {number} [timeout=2000] - How long `copied`/`error` stay true (ms)
 *
 * @returns {Object} Clipboard status and copy function
 * @returns {boolean} returns.copied - True briefly after successful copy
 * @returns {boolean} returns.error - True briefly after a copy failure
 * @returns {(text: string) => Promise<void>} returns.copy - Writes text to the clipboard
 *
 * @sideEffects
 * - Uses the Clipboard API: `navigator.clipboard.writeText`
 * - Schedules timeouts to reset `copied` and `error`
 *
 * @example
 * const { copied, error, copy } = useClipboard(2000);
 *
 * return (
 *   <button onClick={() => copy("hello")}>
 *     {copied ? "Copied" : error ? "Failed" : "Copy"}
 *   </button>
 * );
 */
export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        setError(false);
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
      } catch {
        setError(true);
        setTimeout(() => setError(false), timeout);
      }
    },
    [timeout]
  );

  return { copied, error, copy };
}
