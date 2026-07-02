import { useCallback } from "react";
import { useTransaction } from "./useTransaction";
import { buildPauseTx, buildResumeTx } from "../stellar";

/**
 * Hook managing subscription pause/resume operations.
 *
 * @param userKey - The subscriber's public key.
 * @param onSign - Callback function to sign transactions.
 * @param onRefresh - Callback function to refresh subscription details.
 */
export function usePauseResume(
  userKey: string,
  onSign: (xdr: string) => Promise<string>,
  onRefresh: () => void
) {
  const pTx = useTransaction();
  const rTx = useTransaction();

  const pause = useCallback(async () => {
    await pTx.submit(async () => {
      const xdr = await buildPauseTx(userKey);
      return onSign(xdr);
    });
    onRefresh();
  }, [userKey, onSign, onRefresh, pTx]);

  const resume = useCallback(async () => {
    await rTx.submit(async () => {
      const xdr = await buildResumeTx(userKey);
      return onSign(xdr);
    });
    onRefresh();
  }, [userKey, onSign, onRefresh, rTx]);

  return {
    pause,
    resume,
    pauseTx: {
      state: pTx.status,
      error: pTx.error,
    },
    resumeTx: {
      state: rTx.status,
      error: rTx.error,
    },
  };
}
