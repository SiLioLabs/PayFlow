import { useCallback } from "react";
import { useTransaction } from "./useTransaction";
import { buildPauseTx, buildPauseUntilTx, buildResumeTx } from "../stellar";

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
  const puTx = useTransaction();
  const rTx = useTransaction();

  const pause = useCallback(async () => {
    await pTx.submit(async () => {
      const xdr = await buildPauseTx(userKey);
      return onSign(xdr);
    });
    onRefresh();
  }, [userKey, onSign, onRefresh, pTx]);

  /**
   * Pauses the subscription until `expiry` (Unix seconds). The contract
   * rejects any expiry that isn't strictly in the future (InvalidPauseExpiry),
   * so callers must validate that before invoking this.
   */
  const pauseUntil = useCallback(
    async (expiry: bigint) => {
      await puTx.submit(async () => {
        const xdr = await buildPauseUntilTx(userKey, expiry);
        return onSign(xdr);
      });
      onRefresh();
    },
    [userKey, onSign, onRefresh, puTx]
  );

  const resume = useCallback(async () => {
    await rTx.submit(async () => {
      const xdr = await buildResumeTx(userKey);
      return onSign(xdr);
    });
    onRefresh();
  }, [userKey, onSign, onRefresh, rTx]);

  return {
    pause,
    pauseUntil,
    resume,
    pauseTx: {
      state: pTx.status,
      error: pTx.error,
    },
    pauseUntilTx: {
      state: puTx.status,
      error: puTx.error,
    },
    resumeTx: {
      state: rTx.status,
      error: rTx.error,
    },
  };
}
