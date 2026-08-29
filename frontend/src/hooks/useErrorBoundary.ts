import { useState, useCallback } from "react";

interface UseErrorBoundaryResult {
  error: Error | null;
  captureError: (error: Error) => void;
  reset: () => void;
}

/**
 * useErrorBoundary - Captures an error in component state and provides a reset.
 *
 * This is not a React Error Boundary component. Instead, it is a small state
 * helper you can use in event handlers and async flows.
 *
 * @returns {Object} Error state and handlers
 * @returns {Error|null} returns.error - The last captured error (or null)
 * @returns {(error: Error) => void} returns.captureError - Store an error
 * @returns {() => void} returns.reset - Clear the stored error
 *
 * @sideEffects
 * - Updates React state.
 *
 * @example
 * const { error, captureError, reset } = useErrorBoundary();
 *
 * async function onSubmit() {
 *   try { await doSomething(); }
 *   catch (e) { captureError(e as Error); }
 * }
 *
 * return error ? <div>{error.message} <button onClick={reset}>Retry</button></div> : null;
 */
export function useErrorBoundary(): UseErrorBoundaryResult {
  const [error, setError] = useState<Error | null>(null);

  const captureError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { error, captureError, reset };
}
