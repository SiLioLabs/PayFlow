import { useState, useEffect } from "react";
import { server } from "../stellar";

interface UseRpcHealthResult {
  healthy: boolean;
  error: string | null;
}

export function useRpcHealth(): UseRpcHealthResult {
  const [healthy, setHealthy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        await server.getHealth();
        setHealthy(true);
        setError(null);
      } catch (e: unknown) {
        setHealthy(false);
        setError(e instanceof Error ? e.message : "RPC endpoint unreachable");
      }
    }

    checkHealth();
  }, []);

  return { healthy, error };
}
