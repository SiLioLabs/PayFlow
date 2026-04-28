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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchEvents(eventName, address);
      setEvents(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch events");
    } finally {
      setLoading(false);
    }
  }, [eventName, address]);

  useEffect(() => {
    load();
  }, [load]);

  return { events, loading, error, refresh: load };
}
