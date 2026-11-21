/**
 * event-dedup.ts — Reusable LRU deduplication cache for contract events.
 *
 * Provides an LRU cache keyed by `${txHash}:${eventName}:${ledger}` to
 * detect and skip duplicate event processing. Designed for reuse by
 * watch-events.ts, the indexer pipeline, and other event consumers.
 *
 * Configuration via environment variables:
 *   EVENT_DEDUP_CACHE_SIZE  — Max cache entries (default: 1000)
 *   EVENT_DEDUP_TTL_MS      — Entry TTL in milliseconds (default: 0 = no TTL)
 *
 * LRU eviction is used: when the cache is full, the oldest (least recently
 * used) entry is evicted. This means events at the cache boundary could be
 * re-processed if they are evicted and later refetched — this is acceptable
 * and documented behavior.
 *
 * Usage:
 *   ```ts
 *   import { EventDedupCache } from "./event-dedup.js";
 *
 *   const dedup = new EventDedupCache();
 *
 *   // Single atomic check-and-record
 *   if (dedup.checkAndRecord(txHash, eventName, ledger)) {
 *     // duplicate — skip processing
 *   } else {
 *     // new event — process it
 *   }
 *
 *   // Inspect stats
 *   console.log(dedup.stats);
 *   ```
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface DedupStats {
  /** Number of duplicate events detected (hits) */
  hits: number;
  /** Number of unique events recorded (misses) */
  misses: number;
  /** Number of LRU evictions performed */
  evictions: number;
  /** Total unique events processed (= misses) */
  totalProcessed: number;
  /** Total duplicates skipped (= hits) */
  deduplicatedTotal: number;
  /** Current cache size */
  size: number;
  /** Maximum cache capacity */
  maxSize: number;
}

interface CacheEntry {
  /** Timestamp when the entry was last added/refreshed (ms since epoch) */
  timestamp: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_SIZE = 1000;
const DEFAULT_TTL_MS = 0; // 0 = no TTL

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a consistent cache key from event identifiers.
 *
 * Key format: `${txHash}:${eventName}:${ledger}`
 * This combination uniquely identifies a contract event. The same event
 * at a different ledger is treated as a different event.
 */
export function createCacheKey(
  txHash: string,
  eventName: string,
  ledger: number,
): string {
  return `${txHash}:${eventName}:${ledger}`;
}

/**
 * Parse an environment variable as a positive integer, returning the
 * default if unset, empty, or invalid.
 */
function envInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultVal;
}

// ── LRU Cache ────────────────────────────────────────────────────────────────

/**
 * LRU event deduplication cache.
 *
 * Implemented using a plain `Map` which preserves insertion order in
 * JavaScript engines, giving O(1) get/set/delete with natural LRU semantics.
 * On a cache hit, the entry is deleted and re-inserted to move it to the
 * most-recently-used position (Map tail). On overflow, the first entry
 * (Map head) is evicted.
 */
export class EventDedupCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  /**
   * @param maxSize  Maximum number of entries (default: EVENT_DEDUP_CACHE_SIZE env or 1000)
   * @param ttlMs    Entry TTL in ms (default: EVENT_DEDUP_TTL_MS env or 0 = no TTL)
   */
  constructor(maxSize?: number, ttlMs?: number) {
    this.cache = new Map();
    this.maxSize =
      maxSize ?? envInt("EVENT_DEDUP_CACHE_SIZE", DEFAULT_CACHE_SIZE);
    this.ttlMs = ttlMs ?? envInt("EVENT_DEDUP_TTL_MS", DEFAULT_TTL_MS);
  }

  // ── Public Accessors ─────────────────────────────────────────────────────

  /** Current cache statistics snapshot. */
  get stats(): DedupStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      totalProcessed: this.misses,
      deduplicatedTotal: this.hits,
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  /** Number of unique events processed (cache misses). */
  get totalProcessed(): number {
    return this.misses;
  }

  /** Number of duplicates skipped (cache hits). */
  get deduplicatedTotal(): number {
    return this.hits;
  }

  /** Current number of entries in the cache. */
  get size(): number {
    return this.cache.size;
  }

  // ── Core Operations ──────────────────────────────────────────────────────

  /**
   * Atomically check if an event is already known and record it if not.
   *
   * @returns `true` if the event is a duplicate (already cached), `false` if
   *          it is new (and has been added to the cache).
   *
   * Handles:
   *   - Cache hit: move entry to MRU position, increment hit count
   *   - Cache hit but expired (TTL): remove old entry, add new, treat as miss
   *   - Cache miss: add entry, evict LRU if at capacity, increment miss count
   */
  checkAndRecord(txHash: string, eventName: string, ledger: number): boolean {
    const key = createCacheKey(txHash, eventName, ledger);
    const entry = this.cache.get(key);

    if (entry !== undefined) {
      // TTL expiry check
      if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        this.cache.set(key, { timestamp: Date.now() });
        this.misses++;
        return false;
      }

      // Cache hit — move to MRU position
      this.cache.delete(key);
      this.cache.set(key, entry);
      this.hits++;
      return true;
    }

    // Cache miss — add new entry
    if (this.cache.size >= this.maxSize) {
      this.evictLru();
    }
    this.cache.set(key, { timestamp: Date.now() });
    this.misses++;
    return false;
  }

  /**
   * Check whether an event is in the cache without recording it.
   * Does NOT update LRU position or stats.
   */
  has(txHash: string, eventName: string, ledger: number): boolean {
    const key = createCacheKey(txHash, eventName, ledger);
    const entry = this.cache.get(key);
    if (entry === undefined) return false;
    if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Manually insert or refresh an entry. Useful for pre-warming the cache.
   * Evicts LRU if at capacity.
   */
  set(txHash: string, eventName: string, ledger: number): void {
    const key = createCacheKey(txHash, eventName, ledger);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      this.evictLru();
    }
    this.cache.set(key, { timestamp: Date.now() });
  }

  /**
   * Remove all entries and reset statistics.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Remove a specific event from the cache.
   */
  delete(txHash: string, eventName: string, ledger: number): boolean {
    const key = createCacheKey(txHash, eventName, ledger);
    return this.cache.delete(key);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Evict the least recently used entry (the first key in Map iteration order).
   */
  private evictLru(): void {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }
}

export default EventDedupCache;
