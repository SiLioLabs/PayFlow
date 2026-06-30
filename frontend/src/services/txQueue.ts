import { useState, useEffect } from "react";

type PromiseReturningCallback<T> = () => Promise<T>;

let queuePromise: Promise<void> = Promise.resolve();
let pendingLabel: string | null = null;
let queueDepth = 0;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) {
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
  notify();

  const currentPromise = queuePromise;

  const nextPromise = new Promise<T>((resolve, reject) => {
    currentPromise.finally(async () => {
      pendingLabel = label;
      notify();

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
        notify();
      }
    });
  });

  queuePromise = nextPromise.catch(() => {}).then(() => {});

  return nextPromise;
}

export function useTxQueue() {
  const [state, setState] = useState({ pendingLabel, queueDepth });

  useEffect(() => {
    const listener = () => setState({ pendingLabel, queueDepth });
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return state;
}
