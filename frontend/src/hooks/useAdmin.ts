import { useState, useEffect, useCallback } from "react";
import { getContractAdmin } from "../stellar";

export interface UseAdminResult {
  adminAddress: string | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Resolves contract admin status by comparing the connected wallet
 * against the on-chain admin address returned by `get_admin`.
 */
export function useAdmin(publicKey: string | null): UseAdminResult {
  const [adminAddress, setAdminAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setAdminAddress(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const admin = await getContractAdmin(publicKey);
      setAdminAddress(admin);
      if (!admin) {
        setError("Contract admin is not configured.");
      }
    } catch (e: unknown) {
      setAdminAddress(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isAdmin = !!publicKey && !!adminAddress && publicKey === adminAddress;

  return { adminAddress, isAdmin, loading, error, refresh };
}
