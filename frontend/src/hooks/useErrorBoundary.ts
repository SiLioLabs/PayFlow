import { useState, useCallback } from "react";

export function useErrorBoundary() {
  const [error, setError] = useState<Error | null>(null);

  const throwError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err : new Error(String(err)));
  }, []);

  if (error) throw error;

  return { throwError };
}
