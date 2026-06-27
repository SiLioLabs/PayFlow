import { useState, useEffect, useCallback, useRef } from "react";
import { fetchEvents, type ContractEvent } from "../stellar";

interface UseContractEventsResult {
  events: ContractEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

export function useContractEvents(
  eventName: string,
  address?: string,
  maxEvents: number = 50
): UseContractEventsResult {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const addressRef = useRef<string | undefined>(address);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    cursorRef.current = undefined;
    try {
      const result = await fetchEvents(eventName, address);
      // Keep only up to maxEvents, dropping oldest if needed
      const newEvents = result.events.slice(-maxEvents);
      setEvents(newEvents);
      setHasMore(!!result.nextCursor);
      cursorRef.current = result.nextCursor;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch events");
    } finally {
      setLoading(false);
    }
  }, [eventName, address, maxEvents]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await fetchEvents(eventName, address, cursorRef.current);
      setEvents((prev) => {
        const combined = [...prev, ...result.events];
        // Keep only up to maxEvents, dropping oldest if needed
        return combined.slice(-maxEvents);
      });
      setHasMore(!!result.nextCursor);
      cursorRef.current = result.nextCursor;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more events");
    } finally {
      setLoadingMore(false);
    }
  }, [eventName, address, maxEvents, hasMore, loadingMore]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (addressRef.current !== address) {
      addressRef.current = address;
      setEvents([]);
      cursorRef.current = undefined;
      setHasMore(false);
    }
    load();
  }, [load, address]);

  return { events, loading: loading || loadingMore, error, refresh, loadMore, hasMore };
}
