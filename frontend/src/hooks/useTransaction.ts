import { useState, useCallback, useRef } from "react";
import { server } from "../stellar";
import { enqueueTransaction } from "../services/txQueue";

export type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; hash: string }
  | { status: "failed"; error: string };

export interface UseTransactionResult {
  state: TxState;
  status: TxState["status"];
  hash: string | null;
  error: string | null;
  submit: (buildAndSign: () => Promise<string>) => Promise<string>;
  reset: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_MS = 30000;

interface UseTransactionOptions {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export function useTransaction(options?: UseTransactionOptions): UseTransactionResult {
  const [state, setState] = useState<TxState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = options?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const submit = useCallback(async (buildAndSign: () => Promise<string>): Promise<string> => {
    setState({ status: "pending" });

    let txHash: string;
    try {
      txHash = await enqueueTransaction(buildAndSign, "Transaction");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: "failed", error: msg });
      throw e;
    }

    // Poll until confirmed or timed out
    const deadline = Date.now() + pollTimeoutMs;

    await new Promise<void>((resolve) => {
      function poll() {
        if (Date.now() > deadline) {
          setState({ status: "failed", error: "Transaction confirmation timed out" });
          resolve();
          return;
        }

        server.getTransaction(txHash).then((result) => {
          if (result.status === "SUCCESS") {
            setState({ status: "success", hash: txHash });
            resolve();
          } else if (result.status === "FAILED") {
            setState({ status: "failed", error: "Transaction failed on-chain" });
            resolve();
          } else {
            // NOT_FOUND or still pending — keep polling
            timerRef.current = setTimeout(poll, pollIntervalMs);
          }
        }).catch(() => {
          // RPC error — keep polling
          timerRef.current = setTimeout(poll, pollIntervalMs);
        });
      }

      poll();
    });

    return txHash;
  }, [pollIntervalMs, pollTimeoutMs]);

  // Derive backward-compatible fields
  const status = state.status;
  const hash = state.status === "success" ? state.hash : null;
  const error = state.status === "failed" ? state.error : null;

  return { state, status, hash, error, submit, reset };
}
