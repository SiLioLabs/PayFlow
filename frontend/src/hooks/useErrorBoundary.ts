import { useState, useCallback } from "react";

interface UseErrorBoundaryResult {
  error: Error | null;
  captureError: (error: Error) => void;
  reset: () => void;
}

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
