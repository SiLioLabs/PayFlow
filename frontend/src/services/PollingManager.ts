import { fetchEvents, type ContractEvent } from "../stellar";

type Listener = (data: {
  events: ContractEvent[];
  error: string | null;
  loading: boolean;
  nextCursor: string | undefined;
}) => void;

interface PollEntry {
  eventName: string;
  address?: string;
  listeners: Set<Listener>;
  timerId: ReturnType<typeof setTimeout> | null;
  currentInterval: number;
  lastEvents: ContractEvent[];
  lastError: string | null;
  nextCursor: string | undefined;
  loading: boolean;
}

class PollingManagerClass {
  private entries = new Map<string, PollEntry>();
  private baseInterval = 5000;
  private maxInterval = 60000;
  private isVisible = true;

  constructor() {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("visibilitychange", this.handleVisibilityChange);
      this.isVisible = document.visibilityState === "visible";
    }
  }

  private handleVisibilityChange = () => {
    this.isVisible = document.visibilityState === "visible";
    if (this.isVisible) {
      for (const [key, entry] of this.entries.entries()) {
        if (entry.listeners.size > 0 && !entry.timerId) {
          this.schedulePoll(key, entry);
        }
      }
    } else {
      for (const entry of this.entries.values()) {
        if (entry.timerId) {
          clearTimeout(entry.timerId);
          entry.timerId = null;
        }
      }
    }
  };

  private getKey(eventName: string, address?: string): string {
    return `${eventName}:${address || ""}`;
  }

  public subscribe(eventName: string, address: string | undefined, listener: Listener): () => void {
    const key = this.getKey(eventName, address);
    let entry = this.entries.get(key);

    if (!entry) {
      entry = {
        eventName,
        address,
        listeners: new Set(),
        timerId: null,
        currentInterval: this.baseInterval,
        lastEvents: [],
        lastError: null,
        nextCursor: undefined,
        loading: false,
      };
      this.entries.set(key, entry);
    }

    entry.listeners.add(listener);

    // Immediately notify with current state
    listener({
      events: entry.lastEvents,
      error: entry.lastError,
      loading: entry.loading,
      nextCursor: entry.nextCursor,
    });

    if (entry.listeners.size === 1) {
      this.poll(key, entry);
    }

    return () => {
      if (entry) {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) {
          if (entry.timerId) {
            clearTimeout(entry.timerId);
          }
          this.entries.delete(key);
        }
      }
    };
  }

  public retry(eventName: string, address?: string) {
    const key = this.getKey(eventName, address);
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.timerId) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
      entry.currentInterval = this.baseInterval;
      this.poll(key, entry);
    }
  }

  private async poll(key: string, entry: PollEntry) {
    if (!this.isVisible) return;

    entry.loading = true;
    this.notify(entry);

    try {
      const result = await fetchEvents(entry.eventName, entry.address);
      entry.lastEvents = Array.isArray(result?.events) ? result.events : [];
      entry.nextCursor = result?.nextCursor;
      entry.lastError = null;
      entry.currentInterval = this.baseInterval;
    } catch (e) {
      entry.lastError = e instanceof Error ? e.message : "Failed to fetch events";
      entry.currentInterval = Math.min(entry.currentInterval * 2, this.maxInterval);
    } finally {
      entry.loading = false;
      this.notify(entry);
      this.schedulePoll(key, entry);
    }
  }

  private schedulePoll(key: string, entry: PollEntry) {
    if (entry.timerId) {
      clearTimeout(entry.timerId);
    }
    if (this.isVisible && entry.listeners.size > 0) {
      entry.timerId = setTimeout(() => this.poll(key, entry), entry.currentInterval);
    }
  }

  private notify(entry: PollEntry) {
    const state = {
      events: entry.lastEvents,
      error: entry.lastError,
      loading: entry.loading,
      nextCursor: entry.nextCursor,
    };
    entry.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (e) {
        console.error("Error in PollingManager listener:", e);
      }
    });
  }
}

export const PollingManager = new PollingManagerClass();
