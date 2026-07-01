import { useState, useEffect, useRef } from "react";
import { server, CONTRACT_ID } from "../stellar";

interface SubscriberCountResult {
  count: number;
  loading: boolean;
  /** True while a background refresh is in progress (stale data is shown). */
  stale: boolean;
}

/** Maximum number of events to fetch per RPC page. */
const PAGE_LIMIT = 1000;
/** Safety cap to prevent runaway pagination loops. */
const MAX_PAGES = 50;

/**
 * Fetches the total number of active subscribers from contract events using
 * cursor-based pagination to bypass the 1,000-event RPC cap.
 *
 * Counts unique addresses from "subscribed" events minus "cancelled" events
 * across all pages. Exposes `stale: true` during background refreshes so the
 * previous count remains visible while new data loads.
 */
export function useSubscriberCount(): SubscriberCountResult {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  // Track whether we already have a count from a previous fetch.
  const hasData = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchSubscriberCount() {
      try {
        // If we already have data, show stale indicator instead of full loading.
        if (hasData.current) {
          setStale(true);
        } else {
          setLoading(true);
        }

        const subscribers = new Set<string>();
        const cancelledUsers = new Set<string>();

        let cursor: string | undefined = undefined;
        let pages = 0;

        // Paginate until we get a partial page or hit the safety cap.
        while (pages < MAX_PAGES) {
          const response = await server.getEvents({
            startLedger: undefined,
            filters: [
              {
                type: "contract",
                contractIds: [CONTRACT_ID],
              },
            ],
            limit: PAGE_LIMIT,
            ...(cursor ? { startAfter: cursor } : {}),
          } as Parameters<typeof server.getEvents>[0]);

          if (cancelled) return;

          const events = response.events ?? [];

          for (const event of events) {
            try {
              if (!event.topic || event.topic.length < 2) continue;

              const eventType = event.topic[0]?.toString();
              const userAddress = event.topic[1]?.toString();

              if (!userAddress) continue;

              if (eventType === "subscribed") {
                subscribers.add(userAddress);
              } else if (eventType === "cancelled") {
                cancelledUsers.add(userAddress);
              }
            } catch (e) {
              console.warn("Event parsing failed:", e);
            }
          }

          pages++;

          // Stop when this page is smaller than the limit — no more pages.
          if (events.length < PAGE_LIMIT) break;

          // Advance the cursor using the last event's id/cursor.
          const lastEvent = events[events.length - 1] as any;
          const nextCursor: string | undefined =
            lastEvent?.cursor ?? lastEvent?.pagingToken ?? lastEvent?.id;

          if (!nextCursor || nextCursor === cursor) break;
          cursor = nextCursor;
        }

        // Active subscribers = subscribed minus cancelled.
        const activeSubscribers = new Set(
          [...subscribers].filter((user) => !cancelledUsers.has(user))
        );

        if (!cancelled) {
          setCount(activeSubscribers.size);
          hasData.current = true;
          setLoading(false);
          setStale(false);
        }
      } catch (error) {
        console.error("Error fetching subscriber count:", error);
        if (!cancelled) {
          if (!hasData.current) {
            setCount(0);
          }
          setLoading(false);
          setStale(false);
        }
      }
    }

    fetchSubscriberCount();

    return () => {
      cancelled = true;
    };
  }, []);

  return { count, loading, stale };
}
