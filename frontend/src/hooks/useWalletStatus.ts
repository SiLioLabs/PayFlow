/**
 * useWalletStatus - Manages wallet connection state with explicit status union.
 *
 * Distinguishes between notStarted, connecting, connected, and error states
 * to provide clear user feedback and enable proper error recovery.
 *
 * @returns {Object} Wallet status state
 * @returns {"notStarted"|"connecting"|"connected"|"error"} returns.status - Current connection status
 * @returns {string|null} returns.error - Error message if status is "error"
 * @returns {Function} returns.setConnecting - Sets status to "connecting"
 * @returns {Function} returns.setConnected - Sets status to "connected"
 * @returns {Function} returns.setError - Sets status to "error" with message
 * @returns {Function} returns.reset - Resets to "notStarted"
 *
 * @example
 * const { status, error, setConnecting, setConnected, setError, reset } = useWalletStatus();
 *
 * // When user clicks connect
 * setConnecting();
 * try {
 *   await wallet.connect();
 *   setConnected();
 * } catch (err) {
 *   setError(err.message);
 * }
 */
import { useState, useCallback } from "react";

export type WalletStatus = "notStarted" | "connecting" | "connected" | "error";

export interface UseWalletStatusResult {
  status: WalletStatus;
  error: string | null;
  setConnecting: () => void;
  setConnected: () => void;
  setError: (message: string) => void;
  reset: () => void;
}

export function useWalletStatus(): UseWalletStatusResult {
  const [status, setStatus] = useState<WalletStatus>("notStarted");
  const [error, setErrorMessage] = useState<string | null>(null);

  const setConnecting = useCallback(() => {
    setStatus("connecting");
    setErrorMessage(null);
  }, []);

  const setConnected = useCallback(() => {
    setStatus("connected");
    setErrorMessage(null);
  }, []);

  const setError = useCallback((message: string) => {
    setStatus("error");
    setErrorMessage(message);
  }, []);

  const reset = useCallback(() => {
    setStatus("notStarted");
    setErrorMessage(null);
  }, []);

  return {
    status,
    error,
    setConnecting,
    setConnected,
    setError,
    reset,
  };
}
