import { useState, useCallback } from "react";
import { StrKey } from "@stellar/stellar-sdk";

interface ValidationErrors {
  merchant?: string;
  amount?: string;
  interval?: string;
}

export function useFormValidation() {
  const [errors, setErrors] = useState<ValidationErrors>({});

  const validate = useCallback((data: { merchant: string; amount: string; interval: number }) => {
    const newErrors: ValidationErrors = {};

    if (!data.merchant) {
      newErrors.merchant = "Merchant address is required";
    } else if (!StrKey.isValidEd25519PublicKey(data.merchant)) {
      newErrors.merchant = "Invalid Stellar address";
    }

    if (!data.amount) {
      newErrors.amount = "Amount is required";
    } else if (parseFloat(data.amount) <= 0) {
      newErrors.amount = "Amount must be greater than 0";
    }

    if (data.interval <= 0) {
      newErrors.interval = "Interval must be greater than 0";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, []);

  const isValid = Object.keys(errors).length === 0;

  return { errors, validate, isValid };
}
