import { useState, useEffect } from "react";
import { StrKey } from "@stellar/stellar-sdk";

interface UseContractIdResult {
  contractId: string;
  valid: boolean;
  error: string | null;
}

/**
 * useContractId - Reads and validates the configured Soroban contract id.
 *
 * Reads `import.meta.env.VITE_CONTRACT_ID` on mount and validates it using
 * `StrKey.isValidContract`.
 *
 * @returns {Object} Contract id state
 * @returns {string} returns.contractId - The validated contract id (empty string if invalid/unset)
 * @returns {boolean} returns.valid - True when the env var exists and is a valid contract id
 * @returns {string|null} returns.error - Validation error message (or null)
 *
 * @sideEffects
 * - Reads environment config.
 * - Updates React state.
 *
 * @example
 * const { contractId, valid, error } = useContractId();
 * if (!valid) return <div>{error}</div>;
 */
export function useContractId(): UseContractIdResult {
  const [contractId, setContractId] = useState<string>("");
  const [valid, setValid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = import.meta.env.VITE_CONTRACT_ID;

    if (!id) {
      setError("VITE_CONTRACT_ID environment variable is not set");
      setValid(false);
      return;
    }

    if (!StrKey.isValidContract(id)) {
      setError("VITE_CONTRACT_ID is not a valid Soroban contract address");
      setValid(false);
      return;
    }

    setContractId(id);
    setValid(true);
    setError(null);
  }, []);

  return { contractId, valid, error };
}
