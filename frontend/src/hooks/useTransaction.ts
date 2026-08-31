/**
 * useTransaction - Submits a signed Stellar transaction and polls for confirmation.
 *
 * Wraps transaction submission with RPC health checking, queue integration,
 * and polling until the transaction reaches a terminal state (SUCCESS or FAILED).
 *
 * @returns {Object} Transaction state and submission handler
 * @returns {"idle"|"pending"|"success"|"failed"} returns.status - Current transaction status
 * @returns {string|null} returns.hash - Transaction hash after submission
 * @returns {string|null} returns.error - Error message if submission or confirmation failed
 * @returns {Function} returns.submit - Builds, signs, and submits the transaction
 *
 * @example
 * const { status, hash, error, submit } = useTransaction();
 *
 * const handlePurchase = async () => {
 *   try {
 *     const txHash = await submit(async () => {
 *       const xdr = await buildPurchaseXdr();
 *       return await wallet.signAndSubmit(xdr);
 *     });
 *     console.log("Confirmed:", txHash);
 *   } catch (err) {
 *     console.error("Transaction failed:", error);
 *   }
 * };
 */
import { useState, useCallback, useRef } from "react";
import { server } from "../stellar";
import { useRpcHealthContext } from "../context/RpcHealthContext";
import {
  enqueueTransaction,
  enqueue,
  markSubmitted,
  markConfirmed,
  markFailed,
  setRetry,
} from "../services/txQueue";
import { ensureMainnetConfirmed } from "../utils/network";

export type TxStatus = "idle" | "pending" | "success" | "failed";

export interface UseTransactionResult {
  status: TxStatus;
  hash: string | null;
  error: string | null;
  submit: (buildAndSign: () => Promise<string>, label?: string) => Promise<string>;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

export function useTransaction(): UseTransactionResult {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { circuitOpen } = useRpcHealthContext();

  const submit = useCallback(
    async (buildAndSign: () => Promise<string>, label = "Transaction"): Promise<string> => {
      if (circuitOpen) {
        const msg = "RPC unavailable";
        setError(msg);
        setStatus("failed");
        throw new Error(msg);
      }
      // Mainnet safety gate — require explicit confirmation once per session before any mutating tx
      if (!ensureMainnetConfirmed()) {
        const msg = "Mainnet transaction cancelled";
        setError(msg);
        setStatus("failed");
        throw new Error(msg);
      }
      setStatus("pending");
      setHash(null);
      setError(null);

      // Create a persisted UI queue entry so interrupted signings survive reload.
      // The retry callback re-simulates before resubmitting (caller rebuilds XDR with simulate).
      const uiId = enqueue(label, null);
      const retryFn = async () => {
        // Re-run the original buildAndSign with a fresh simulation; useTransaction will re-enter its own queue
        await submit(buildAndSign, label);
      };
      setRetry(uiId, retryFn);

      let txHash: string;
      try {
        txHash = await enqueueTransaction(buildAndSign, label);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Distinguish Freighter close / user reject (interrupted) from other failures
        const isInterrupted = /close|reject|cancel|dismiss/i.test(msg);
        // Keep pending entry as failed but retain retry; panel will show Resume/Discard + warning
        markFailed(uiId, msg);
        // Preserve retry for interrupted states so user can resume safely (re-simulates)
        if (isInterrupted) {
          setRetry(uiId, retryFn);
        }
        setError(msg);
        setStatus("failed");
        throw e;
      }

      markSubmitted(uiId, txHash);
      // Retry stays available until confirmed, so user can resume if polling is lost
      setRetry(uiId, retryFn);
      setHash(txHash);

      // Poll until confirmed or timed out
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      await new Promise<void>((resolve) => {
        function poll() {
          if (Date.now() > deadline) {
            const timeoutMsg = "Transaction confirmation timed out";
            markFailed(uiId, timeoutMsg);
            setError(timeoutMsg);
            setStatus("failed");
            resolve();
            return;
          }

          server
            .getTransaction(txHash)
            .then((result) => {
              if (result.status === "SUCCESS") {
                markConfirmed(uiId);
                setStatus("success");
                resolve();
              } else if (result.status === "FAILED") {
                const failMsg = "Transaction failed on-chain";
                markFailed(uiId, failMsg);
                setError(failMsg);
                setStatus("failed");
                resolve();
              } else {
                // NOT_FOUND or still pending — keep polling
                timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
              }
            })
            .catch(() => {
              // RPC error — keep polling
              timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
            });
        }

        poll();
      });

      return txHash;
    },
    [circuitOpen]
  );

  return { status, hash, error, submit };
}
