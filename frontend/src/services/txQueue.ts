/**
 * txQueue.ts — A singleton transaction queue service for FlowPay.
 *
 * Tracks the last MAX_ENTRIES transactions submitted through the app.
 * Components subscribe via addListener() to receive state updates whenever
 * the queue changes.  The panel auto-opens on a new submission.
 */

import { useState, useEffect } from "react";

export type TxEntryStatus = "pending" | "submitted" | "confirmed" | "failed";
export interface TxEntry {
  /** Unique entry id (monotonically increasing) */
  id: number;
  /** Human-readable label for the operation, e.g. "Subscribe" */
  operation: string;
  /** Stellar transaction hash — null while still pending */
  hash: string | null;
  /** ISO-8601 timestamp of when the entry was created */
  timestamp: string;
  /** Current status */
  status: TxEntryStatus;
  /** Error message — only set when status === "failed" */
  error: string | null;
  /** Optional retry callback — set by the caller when the op is retryable */
  retry: (() => Promise<void>) | null;
}

export type TxQueueListener = (entries: TxEntry[], open: boolean) => void;

const MAX_ENTRIES = 10;

let nextId = 1;
let entries: TxEntry[] = [];
let panelOpen = false;
const listeners = new Set<TxQueueListener>();

function notify() {
  const snapshot = [...entries];
  const open = panelOpen;
  listeners.forEach((fn) => fn(snapshot, open));
}

/** Subscribe to queue state changes. Returns an unsubscribe function. */
export function addListener(fn: TxQueueListener): () => void {
  listeners.add(fn);
  // Immediately invoke with current state so the subscriber is in sync.
  fn([...entries], panelOpen);
  return () => listeners.delete(fn);
}

/** Open or close the queue panel programmatically. */
export function setPanelOpen(open: boolean): void {
  panelOpen = open;
  notify();
}

/**
 * Add a new entry to the queue and auto-open the panel.
 * Returns the id of the new entry.
 */
export function enqueue(operation: string, retry: (() => Promise<void>) | null = null): number {
  const id = nextId++;
  const entry: TxEntry = {
    id,
    operation,
    hash: null,
    timestamp: new Date().toISOString(),
    status: "pending",
    error: null,
    retry,
  };

  // Prepend so newest is first; trim to MAX_ENTRIES.
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  panelOpen = true;
  notify();
  return id;
}

/** Mark an entry as submitted (hash now known, waiting for confirmation). */
export function markSubmitted(id: number, hash: string): void {
  entries = entries.map((e) => (e.id === id ? { ...e, hash, status: "submitted" } : e));
  notify();
}

/** Mark an entry as confirmed on-chain. */
export function markConfirmed(id: number): void {
  entries = entries.map((e) => (e.id === id ? { ...e, status: "confirmed" } : e));
  notify();
}

/** Mark an entry as failed with an error message. */
export function markFailed(id: number, error: string): void {
  entries = entries.map((e) => (e.id === id ? { ...e, status: "failed", error } : e));
  notify();
}

/** Update the retry callback on an existing entry (e.g. after re-building XDR). */
export function setRetry(id: number, retry: () => Promise<void>): void {
  entries = entries.map((e) => (e.id === id ? { ...e, retry } : e));
  notify();
}

/** Return a snapshot of the current queue. */
export function getEntries(): TxEntry[] {
  return [...entries];
}

/** Return whether the panel is currently open. */
export function isPanelOpen(): boolean {
  return panelOpen;
}

/** Reset queue state — used in tests. */
export function _reset(): void {
  nextId = 1;
  entries = [];
  panelOpen = false;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Queue serialization helpers (used by useTransaction)
// ---------------------------------------------------------------------------
// ── Simple promise-serialisation queue (used by useTransaction) ────────────────

type PromiseReturningCallback<T> = () => Promise<T>;

let queuePromise: Promise<void> = Promise.resolve();
let pendingLabel: string | null = null;
let queueDepth = 0;

type QueueStateListener = () => void;
const queueStateListeners = new Set<QueueStateListener>();

function notifyQueueState() {
  for (const listener of queueStateListeners) {
    listener();
  }
}

type QueueListener = () => void;
const queueListeners = new Set<QueueListener>();

function notifyQueue() {
  for (const listener of queueListeners) {
    listener();
  }
}

export function enqueueTransaction<T>(
  buildAndSign: PromiseReturningCallback<T>,
  label: string
): Promise<T> {
  queueDepth++;
  if (!pendingLabel) {
    pendingLabel = label;
  }
  notifyQueueState();
  notifyQueue();

  const currentPromise = queuePromise;

  const nextPromise = new Promise<T>((resolve, reject) => {
    currentPromise.finally(async () => {
      pendingLabel = label;
      notifyQueueState();
      notifyQueue();

      try {
        const result = await buildAndSign();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        queueDepth--;
        if (queueDepth === 0) {
          pendingLabel = null;
        }
        notifyQueueState();
        notifyQueue();
      }
    });
  });

  queuePromise = nextPromise.catch(() => {}).then(() => {});

  return nextPromise;
}

// ---------------------------------------------------------------------------
// React hook for consuming queue depth / pending label in UI components
// ---------------------------------------------------------------------------

export function useTxQueue() {
  const [state, setState] = useState({ pendingLabel, queueDepth });

  useEffect(() => {
    const listener = () => setState({ pendingLabel, queueDepth });
    queueStateListeners.add(listener);
    return () => {
      queueStateListeners.delete(listener);
    };
  }, []);

  return state;
}
