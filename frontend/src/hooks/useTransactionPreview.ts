import { useCallback, useEffect, useRef, useState } from "react";
import { simulateTransactionPreview, type TxSimulationPreview } from "../stellar";

export interface UseTransactionPreviewResult {
  preview: TxSimulationPreview | null;
  loading: boolean;
  error: string | null;
  override: boolean;
  setOverride: (value: boolean) => void;
  /** Signing must be blocked until the user explicitly overrides a safe failure. */
  blocked: boolean;
  refresh: () => void;
}

export type TransactionPreviewState = UseTransactionPreviewResult;

/**
 * Simulates a mutation when a confirmation UI opens.
 *
 * `buildXdr` should be memoized (e.g. with `useCallback`) so the simulation
 * only re-runs when the operation's inputs actually change.
 */
export function useTransactionPreview(
  buildXdr: (() => Promise<string>) | null,
  enabled = true
): UseTransactionPreviewResult {
  const [preview, setPreview] = useState<TxSimulationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [nonce, setNonce] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setPreview(null);
    setError(null);
    setOverride(false);
    setLoading(false);

    if (!enabled || !buildXdr) return;

    let cancelled = false;
    setLoading(true);

    buildXdr()
      .then((xdr) => simulateTransactionPreview(xdr))
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        if (result) {
          setPreview(result);
          setError(result.rpcError);
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [buildXdr, enabled, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return {
    preview,
    loading,
    error,
    override,
    setOverride,
    blocked: !!preview?.blockSigning && !override,
    refresh,
  };
}
