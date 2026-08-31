import { useState, useEffect, useCallback, useRef } from "react";
import { fetchEvents, type ContractEvent } from "../stellar";
import { PollingManager } from "../services/PollingManager";

interface UseContractEventsResult {
  events: ContractEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

/**
 * useContractEvents - Fetches and paginates contract events.
 * Uses centralized PollingManager to manage and de-duplicate active event polling.
 */
export function useContractEvents(
  eventName: string,
  address?: string,
  maxEvents: number = 50
): UseContractEventsResult {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef<string | undefined>(undefined);
  const [moreEvents, setMoreEvents] = useState<ContractEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setEvents([]);
    setMoreEvents([]);
    setError(null);
    setHasMore(false);
    cursorRef.current = undefined;

    const unsubscribe = PollingManager.subscribe(eventName, address, (state) => {
      setLoading(state.loading);
      if (state.error) {
        setError(state.error);
      } else {
        setError(null);
      }

      // Merge and deduplicate polled events with paginated moreEvents
      const polled = Array.isArray(state.events) ? state.events : [];
      const combined = [...polled, ...moreEvents];
      const seen = new Set<string>();
      const unique = combined.filter((e) => {
        const id = `${e.txHash || e.ledger}-${e.eventName}-${e.timestamp}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      setEvents(unique.slice(0, maxEvents));

      // If we haven't paginated yet, use the PollingManager's cursor
      if (moreEvents.length === 0) {
        setHasMore(!!state.nextCursor);
        cursorRef.current = state.nextCursor;
      }
    });

    return unsubscribe;
  }, [eventName, address, maxEvents, moreEvents]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const result = await fetchEvents(eventName, address, cursorRef.current);
      setMoreEvents((prev) => {
        const next = [...prev, ...result.events];
        return next.slice(-maxEvents);
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
    PollingManager.retry(eventName, address);
  }, [eventName, address]);

  return {
    events,
    loading: loading || loadingMore,
    error,
    refresh,
    loadMore,
    hasMore,
  };
}
