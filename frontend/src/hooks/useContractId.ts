import { useState, useEffect } from "react";
import { StrKey } from "@stellar/stellar-sdk";

interface UseContractIdResult {
  contractId: string;
  valid: boolean;
  error: string | null;
}

function isValidContractIdShape(id: string): boolean {
  return (
    typeof id === "string" && id.startsWith("C") && id.length === 56 && /^[A-Z0-9]+$/i.test(id)
  );
}

/**
 * useContractId - Reads and validates the configured Soroban contract id.
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

    if (!isValidContractIdShape(id) || !StrKey.isValidContract(id)) {
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
