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

/**
 * useContractEvents - Fetches and paginates contract events.
 *
 * Loads events for a given `eventName` and optional `address`. Supports
 * cursor-based pagination via `loadMore()`.
 *
 * @param {string} eventName - Event name/topic to fetch
 * @param {string} [address] - Optional contract/account address filter
 * @param {number} [maxEvents=50] - Max number of events to keep in state
 *
 * @returns {Object} Contract events state and pagination controls
 * @returns {ContractEvent[]} returns.events - Current events (latest up to `maxEvents`)
 * @returns {boolean} returns.loading - True while fetching or loading more
 * @returns {string|null} returns.error - Error message, or null
 * @returns {() => void} returns.refresh - Re-fetch from the beginning
 * @returns {() => Promise<void>} returns.loadMore - Fetch the next page
 * @returns {boolean} returns.hasMore - True if the backend returned a next cursor
 *
 * @sideEffects
 * - Performs network requests via `fetchEvents`.
 * - Maintains a cursor in a ref and updates React state.
 *
 * @example
 * const { events, loading, loadMore } = useContractEvents("subscribed", userPk, 50);
 * return (
 *   <div>
 *     {events.map((e) => <div key={String(e.id)}>{String(e.topic?.[0])}</div>)}
 *     <button disabled={loading} onClick={loadMore}>Load more</button>
 *   </div>
 * );
 */
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

