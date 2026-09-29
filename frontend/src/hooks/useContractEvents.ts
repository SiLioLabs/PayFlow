import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
 * Stable identity for a contract event, independent of which source it arrived
 * from (a poll tick or a paginated page).
 *
 * This single key drives both the de-duplication of the merged window and the
 * React list key in `EventFeed`. Because the visible list is de-duplicated by
 * this key, a duplicate can never reach the DOM as a colliding React key.
 */
export function contractEventKey(event: ContractEvent): string {
  return `${event.txHash || event.ledger}-${event.eventName}-${event.timestamp}`;
}

/**
 * useContractEvents - Fetches and paginates contract events.
 * Uses centralized PollingManager to manage and de-duplicate active event polling.
 *
 * The subscription and the fetch window are deliberately decoupled:
 *
 *   - The effect below is keyed on the *stream identity* (`eventName`,
 *     `address`) only, so it binds the PollingManager listener exactly once per
 *     stream. Neither paging nor a `maxEvents` change rebinds it.
 *   - Paginating only appends to `moreEvents`; the visible window is derived
 *     from `polledEvents` + `moreEvents` during render.
 *
 * Previously `moreEvents` and `maxEvents` were effect dependencies, so every
 * page the user loaded tore down and re-created the listener. A rebind replays
 * the manager's current state and can drop events that arrived during the gap,
 * which surfaced as duplicated or missing rows at page boundaries.
 */
export function useContractEvents(
  eventName: string,
  address?: string,
  maxEvents: number = 50
): UseContractEventsResult {
  // Latest snapshot delivered by the polling subscription.
  const [polledEvents, setPolledEvents] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Events fetched by explicit pagination, oldest last. Kept out of the
  // subscription effect's dependencies on purpose.
  const [moreEvents, setMoreEvents] = useState<ContractEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const cursorRef = useRef<string | undefined>(undefined);
  // Once a page has been fetched this hook owns the cursor, so a later poll
  // tick must not rewind it to the manager's position.
  const hasPaginatedRef = useRef(false);
  // Mirrors `loadingMore` for the synchronous re-entrancy guard: two calls in
  // the same tick both see the pre-update state value.
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    // A new stream is a new world: drop the previous stream's window and
    // re-prime the cursor from this stream's own poll ticks.
    setPolledEvents([]);
    setMoreEvents([]);
    setError(null);
    setHasMore(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    cursorRef.current = undefined;
    hasPaginatedRef.current = false;
    mountedRef.current = true;

    const unsubscribe = PollingManager.subscribe(eventName, address, (state) => {
      // A tick can already be in flight when the listener is torn down.
      if (!mountedRef.current) return;

      setLoading(!!state.loading);
      setError(state.error ?? null);
      setPolledEvents(Array.isArray(state.events) ? state.events : []);

      if (!hasPaginatedRef.current) {
        cursorRef.current = state.nextCursor;
        setHasMore(!!state.nextCursor);
      }
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [eventName, address]);

  /**
   * Merged view window: polled events first (newest), then paginated history.
   * De-duplicated by event identity so a page that overlaps the poll's window
   * at the page boundary cannot produce a duplicate.
   */
  const events = useMemo(() => {
    const seen = new Set<string>();
    const merged: ContractEvent[] = [];

    for (const event of [...polledEvents, ...moreEvents]) {
      const key = contractEventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }

    return merged.length > maxEvents ? merged.slice(0, maxEvents) : merged;
  }, [polledEvents, moreEvents, maxEvents]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !cursorRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const result = await fetchEvents(eventName, address, cursorRef.current);
      if (!mountedRef.current) return;

      hasPaginatedRef.current = true;
      cursorRef.current = result.nextCursor;
      setHasMore(!!result.nextCursor);
      setMoreEvents((prev) => [...prev, ...result.events].slice(-maxEvents));
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load more events");
      }
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [eventName, address, maxEvents, hasMore]);

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
