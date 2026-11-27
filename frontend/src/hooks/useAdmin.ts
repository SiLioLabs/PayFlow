import { useState, useEffect, useCallback } from "react";
import { getContractAdmin, getContractPendingAdmin } from "../stellar";

export interface UseAdminResult {
  adminAddress: string | null;
  pendingAdminAddress: string | null;
  isAdmin: boolean;
  isPendingAdmin: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Resolves contract admin status by comparing the connected wallet
 * against the on-chain admin address returned by `get_admin` and
 * the pending admin from `get_pending_admin`.
 */
export function useAdmin(publicKey: string | null): UseAdminResult {
  const [adminAddress, setAdminAddress] = useState<string | null>(null);
  const [pendingAdminAddress, setPendingAdminAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setAdminAddress(null);
      setPendingAdminAddress(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [admin, pending] = await Promise.all([
        getContractAdmin(publicKey),
        getContractPendingAdmin(publicKey),
      ]);
      setAdminAddress(admin);
      setPendingAdminAddress(pending ?? null);
      if (!admin) {
        setError("Contract admin is not configured.");
      }
    } catch (e: unknown) {
      setAdminAddress(null);
      setPendingAdminAddress(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isAdmin = !!publicKey && !!adminAddress && publicKey === adminAddress;
  const isPendingAdmin =
    !!publicKey && !!pendingAdminAddress && publicKey === pendingAdminAddress;

  return { adminAddress, pendingAdminAddress, isAdmin, isPendingAdmin, loading, error, refresh };
}
