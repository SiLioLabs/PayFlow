/**
 * rpcCache.ts — RPC deduplication and short-lived TTL cache with LRU eviction.
 *
 * Solves parallel HTTP fan-out and excess memory pressure on 4 GB RAM devices by:
 *   1. Collapsing concurrent calls with the same key into one in-flight Promise.
 *   2. Returning cached results for sequential reads within the TTL window.
 *   3. Capping the cache at MAX_CACHE_SIZE entries via LRU eviction.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default TTL for cached responses (milliseconds). */
export const DEFAULT_TTL_MS = 5_000;

/** Maximum number of entries kept in the LRU cache. */
const MAX_CACHE_SIZE = 100;

// ── Internal data structures ──────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Date.now() + ttlMs
}

/**
 * LRU cache backed by a Map.
 * Map insertion order == access order because we delete-and-re-insert on every
 * read, so the oldest (least-recently-used) key is always Map.keys().next().
 */
const cache = new Map<string, CacheEntry<unknown>>();

/**
 * In-flight request registry: maps a cache key to the Promise currently
 * resolving it.  Entries are removed once the Promise settles.
 */
const inFlight = new Map<string, Promise<unknown>>();

// ── LRU helpers ───────────────────────────────────────────────────────────────

/**
 * Retrieve a cache entry and promote it to "most-recently-used" by
 * reinserting it at the tail of the Map.
 */
function lruGet<T>(key: string): CacheEntry<T> | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry !== undefined) {
    // Re-insert at tail to mark as most-recently used.
    cache.delete(key);
    cache.set(key, entry as CacheEntry<unknown>);
  }
  return entry;
}

/**
 * Insert a new entry, evicting the least-recently-used entry when the cache
 * is at capacity.
 */
function lruSet<T>(key: string, entry: CacheEntry<T>): void {
  if (cache.has(key)) {
    cache.delete(key); // Remove old position so it lands at the tail.
  } else if (cache.size >= MAX_CACHE_SIZE) {
    // Evict the head (oldest / least-recently-used) entry.
    const lruKey = cache.keys().next().value;
    if (lruKey !== undefined) {
      cache.delete(lruKey);
    }
  }
  cache.set(key, entry as CacheEntry<unknown>);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wraps an async factory function `fn` with:
 *   - **In-flight deduplication**: concurrent calls sharing the same `key`
 *     receive the same Promise without invoking `fn` more than once.
 *   - **TTL caching**: successful results are cached for `ttlMs` milliseconds
 *     (default 5 s).  Reads within that window never call `fn`.
 *   - **LRU eviction**: the cache never grows beyond 100 entries.
 *
 * @param key   Unique string that identifies this request (include all
 *              arguments that affect the result, e.g. `"getSubscription:GABC…"`).
 * @param fn    Zero-argument async factory that performs the actual network call.
 * @param ttlMs How long (ms) a successful result should be cached.
 *              Defaults to {@link DEFAULT_TTL_MS} (5 000 ms).
 */
export function dedupedCall<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  // 1. Cache hit — return without touching the network.
  const cached = lruGet<T>(key);
  if (cached !== undefined && Date.now() < cached.expiresAt) {
    return Promise.resolve(cached.value);
  }

  // 2. In-flight deduplication — join the existing Promise.
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing !== undefined) {
    return existing;
  }

  // 3. Cold call — invoke `fn`, register in-flight, populate cache on success.
  const promise: Promise<T> = fn().then(
    (value) => {
      inFlight.delete(key);
      lruSet<T>(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
    (err: unknown) => {
      inFlight.delete(key);
      throw err;
    }
  );

  inFlight.set(key, promise as Promise<unknown>);
  return promise;
}

// ── Test helpers (not part of the public API surface) ────────────────────────

/** Clear all cache entries and in-flight requests.  Intended for tests only. */
export function _clearCacheForTesting(): void {
  cache.clear();
  inFlight.clear();
}
