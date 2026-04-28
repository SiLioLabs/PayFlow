import { useState, useEffect } from "react";
import { server, CONTRACT_ID } from "../stellar";

interface SubscriberCountResult {
  count: number;
  loading: boolean;
}

/**
 * Fetches the total number of active subscribers from contract events.
 * Counts unique addresses in "subscribed" events minus "cancelled" events.
 */
export function useSubscriberCount(): SubscriberCountResult {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSubscriberCount() {
      try {
        setLoading(true);

        const response = await server.getEvents({
          startLedger: undefined,
          filters: [
            {
              type: "contract",
              contractIds: [CONTRACT_ID],
            },
          ],
          limit: 1000, // Fetch more events to get accurate count
        });

        // Track unique subscribers
        const subscribers = new Set<string>();
        const cancelledUsers = new Set<string>();

        for (const event of response.events) {
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

        // Calculate active subscribers: subscribed minus cancelled
        const activeSubscribers = new Set(
          [...subscribers].filter((user) => !cancelledUsers.has(user))
        );

        if (!cancelled) {
          setCount(activeSubscribers.size);
          setLoading(false);
        }
      } catch (error) {
        console.error("Error fetching subscriber count:", error);
        if (!cancelled) {
          setCount(0);
          setLoading(false);
        }
      }
    }

    fetchSubscriberCount();

    return () => {
      cancelled = true;
    };
  }, []);

  return { count, loading };
}
