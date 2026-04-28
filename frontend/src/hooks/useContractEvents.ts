import { useState, useEffect, useCallback } from "react";
import { fetchEvents, type ContractEvent } from "../stellar";

interface UseContractEventsResult {
  events: ContractEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useContractEvents(
  eventName: string,
  address?: string
): UseContractEventsResult {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEvents(eventName, address);
      setEvents(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [eventName, address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { events, loading, error, refresh };
}
