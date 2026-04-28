import { useState, useCallback } from "react";
import { StrKey } from "@stellar/stellar-sdk";

export interface FormFields {
  merchant: string;
  amount: string;
  interval: number;
}

export interface FormErrors {
  merchant?: string;
  amount?: string;
  interval?: string;
}

interface UseFormValidationResult {
  errors: FormErrors;
  validate: (fields: FormFields) => boolean;
  isValid: boolean;
}

export function useFormValidation(): UseFormValidationResult {
  const [errors, setErrors] = useState<FormErrors>({});

  const validate = useCallback((fields: FormFields): boolean => {
    const next: FormErrors = {};

    if (!fields.merchant) {
      next.merchant = "Merchant address is required.";
    } else if (!StrKey.isValidEd25519PublicKey(fields.merchant)) {
      next.merchant = "Invalid Stellar address.";
    }

    const amt = parseFloat(fields.amount);
    if (!fields.amount || isNaN(amt) || amt <= 0) {
      next.amount = "Amount must be greater than 0.";
    }

    if (!fields.interval || fields.interval <= 0) {
      next.interval = "Interval must be greater than 0.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, []);

  return { errors, validate, isValid: Object.keys(errors).length === 0 };
}
