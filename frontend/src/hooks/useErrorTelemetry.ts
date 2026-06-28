import { useState, useEffect, useCallback } from "react";

export function useErrorTelemetry() {
  const [errorCounts, setErrorCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const handleAnalyticsError = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const message = customEvent.detail;
      if (message) {
        setErrorCounts((prev) => ({
          ...prev,
          [message]: (prev[message] || 0) + 1,
        }));
      }
    };

    window.addEventListener("payflow:error", handleAnalyticsError);
    return () => {
      window.removeEventListener("payflow:error", handleAnalyticsError);
    };
  }, []);

  const clearCounts = useCallback(() => {
    setErrorCounts({});
  }, []);

  return { errorCounts, clearCounts };
}
