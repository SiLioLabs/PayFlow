import { useState, useCallback, useRef } from "react";
import { server } from "../stellar";

export type TxStatus = "idle" | "pending" | "success" | "failed";

export interface UseTransactionResult {
  status: TxStatus;
  hash: string | null;
  error: string | null;
  submit: (buildAndSign: () => Promise<string>) => Promise<string | null>;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

export function useTransaction(): UseTransactionResult {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = useCallback(async (buildAndSign: () => Promise<string>): Promise<string | null> => {
    setStatus("pending");
    setHash(null);
    setError(null);

    let txHash: string;
    try {
      txHash = await buildAndSign();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("failed");
      return null;
    }

    setHash(txHash);

    // Poll until confirmed or timed out
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    await new Promise<void>((resolve) => {
      function poll() {
        if (Date.now() > deadline) {
          setError("Transaction confirmation timed out");
          setStatus("failed");
          resolve();
          return;
        }

        server.getTransaction(txHash).then((result) => {
          if (result.status === "SUCCESS") {
            setStatus("success");
            resolve();
          } else if (result.status === "FAILED") {
            setError("Transaction failed on-chain");
            setStatus("failed");
            resolve();
          } else {
            // NOT_FOUND or still pending — keep polling
            timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          }
        }).catch(() => {
          // RPC error — keep polling
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        });
      }

      poll();
    });

    return txHash;
  }, []);

  return { status, hash, error, submit };
}
