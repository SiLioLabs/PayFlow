import { useState, useCallback, useRef } from "react";
import { server } from "../stellar";
import { useRpcHealthContext } from "../context/RpcHealthContext";
import { enqueueTransaction } from "../services/txQueue";

export type TxStatus = "idle" | "pending" | "success" | "failed";

export interface UseTransactionResult {
  status: TxStatus;
  hash: string | null;
  error: string | null;
  submit: (buildAndSign: () => Promise<string>) => Promise<string>;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

export function useTransaction(): UseTransactionResult {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { circuitOpen } = useRpcHealthContext();

  const submit = useCallback(async (buildAndSign: () => Promise<string>): Promise<string> => {
    if (circuitOpen) {
      const msg = "RPC unavailable";
      setError(msg);
      setStatus("failed");
      throw new Error(msg);
    }
    setStatus("pending");
    setHash(null);
    setError(null);

    let txHash: string;
    try {
      txHash = await enqueueTransaction(buildAndSign, "Transaction");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("failed");
      throw e;
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
  }, [circuitOpen]);

  return { status, hash, error, submit };
}
