import { useState, useCallback, useRef, useEffect } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { server } from "../stellar";
import { CONTRACT_LIMITS } from "../constants";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface FormFields {
  merchant: string;
  amount: string;
  interval: number;
  tokenAddress: string;
}

export interface FormErrors {
  merchant?: string;
  amount?: string;
  interval?: string;
  tokenAddress?: string;
}

interface UseFormValidationResult {
  errors: FormErrors;
  validate: (fields: FormFields) => boolean;
  isValid: boolean;
  /** True while the async server check (`server.getAccount`) is in flight. */
  isValidating: boolean;
  /** @deprecated Alias of `isValidating`. */
  validating: boolean;
  validateAsync: (fields: FormFields) => Promise<boolean>;
  /** Aborts any in-flight async check and clears `isValidating`. */
  cancelValidation: () => void;
}

const ACCOUNT_NOT_FOUND_ERROR = "Account not found on network.";

/**
 * validateStroopAmount - Validates a subscription amount entered as a decimal string.
 *
 * Converts the human amount to stroops (7 decimal places) and checks it:
 * - is a valid number
 * - is > 0
 * - does not exceed the protocol maximum.
 *
 * @param value - Amount as a decimal string (e.g., "12.34")
 * @param maxStroops - Maximum allowed amount in stroops
 * @returns {ValidationResult} Validation outcome
 */
export function validateStroopAmount(value: string, maxStroops: bigint): ValidationResult {
  const num = parseFloat(value);
  if (!value || isNaN(num) || num <= 0) {
    return { valid: false, error: "Amount must be greater than 0." };
  }

  const stroops = BigInt(Math.round(num * 10_000_000));
  if (stroops > maxStroops) {
    return { valid: false, error: `Amount exceeds maximum of ${maxStroops} stroops.` };
  }

  return { valid: true };
}

/**
 * validateInterval - Validates the subscription interval.
 *
 * @param seconds - Interval in seconds
 * @param minSeconds - Minimum allowed interval in seconds
 * @returns {ValidationResult} Validation outcome
 */
export function validateInterval(seconds: number, minSeconds: number): ValidationResult {
  if (!seconds || seconds <= 0) {
    return { valid: false, error: "Interval must be greater than 0." };
  }

  if (seconds < minSeconds) {
    return {
      valid: false,
      error: `Interval must be at least ${minSeconds} seconds.`,
    };
  }

  return { valid: true };
}

/**
 * validateAddress - Validates a Stellar Ed25519 public key.
 *
 * @param addr - Stellar public key
 * @returns {ValidationResult} Validation outcome
 */
export function validateAddress(addr: string): ValidationResult {
  if (!addr) {
    return { valid: false, error: "Address is required." };
  }

  if (!StrKey.isValidEd25519PublicKey(addr) && !StrKey.isValidContract(addr)) {
    return { valid: false, error: "Invalid Stellar address or contract ID." };
  }

  return { valid: true };
}

/**
 * useFormValidation - Validates subscription/checkout form fields.
 *
 * Purpose:
 * - Provides synchronous validation for:
 *   - Stellar address format
 *   - Amount in stroops within protocol limits
 *   - Interval within minimum seconds
 * - Provides validateAsync, which additionally verifies that the merchant
 *   account exists on the connected Stellar RPC endpoint.
 *
 * Side effects:
 * - Calls `server.getAccount` during `validateAsync`.
 * - Updates React state.
 * - Cancels in-flight async validation via `AbortController`.
 *
 * @returns {Object} Form validation state and functions
 * @returns {FormErrors} returns.errors - Field-level error messages
 * @returns {(fields: FormFields) => boolean} returns.validate - Synchronously validate and populate `errors`
 * @returns {boolean} returns.isValid - True when there are no validation errors
 * @returns {boolean} returns.isValidating - True while the `validateAsync` server check is in flight
 * @returns {boolean} returns.validating - Deprecated alias of `isValidating`
 * @returns {(fields: FormFields) => Promise<boolean>} returns.validateAsync - Async validation including RPC check;
 *   resolves `false` if superseded by a newer call, cancelled, or the component unmounts
 * @returns {() => void} returns.cancelValidation - Abort a stale in-flight check (e.g. when field values change)
 *
 * @example
 * const { validateAsync, isValidating } = useFormValidation();
 *
 * async function onSubmit() {
 *   if (isValidating) return;
 *   if (!(await validateAsync(fields))) return;
 *   submit();
 * }
 */
export function useFormValidation(): UseFormValidationResult {
  const [errors, setErrors] = useState<FormErrors>({});
  const [isValidating, setIsValidating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const validate = useCallback((fields: FormFields): boolean => {
    const next: FormErrors = {};

    const addressResult = validateAddress(fields.merchant);
    if (!addressResult.valid) {
      next.merchant = addressResult.error;
    }

    const tokenAddressResult = validateAddress(fields.tokenAddress);
    if (!tokenAddressResult.valid) {
      next.tokenAddress = tokenAddressResult.error;
    }

    const amountResult = validateStroopAmount(
      fields.amount,
      CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT
    );
    if (!amountResult.valid) {
      next.amount = amountResult.error;
    }

    const intervalResult = validateInterval(fields.interval, CONTRACT_LIMITS.MIN_INTERVAL_SECONDS);
    if (!intervalResult.valid) {
      next.interval = intervalResult.error;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, []);

  const cancelValidation = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsValidating(false);
  }, []);

  const validateAsync = useCallback(
    async (fields: FormFields): Promise<boolean> => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      if (!validate(fields)) {
        setIsValidating(false);
        return false;
      }

      // Contract IDs (C…) have no classic account entry, so there is nothing to look up.
      if (!StrKey.isValidEd25519PublicKey(fields.merchant)) {
        setIsValidating(false);
        return true;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsValidating(true);

      try {
        await server.getAccount(fields.merchant);

        if (controller.signal.aborted) {
          return false;
        }

        // Clear merchant error if we previously set it.
        setErrors((prev: FormErrors) => {
          if (prev.merchant === ACCOUNT_NOT_FOUND_ERROR) {
            const rest = { ...prev };
            delete rest.merchant;
            return rest;
          }
          return prev;
        });

        return true;
      } catch {
        if (controller.signal.aborted) {
          return false;
        }

        setErrors((prev: FormErrors) => ({
          ...prev,
          merchant: ACCOUNT_NOT_FOUND_ERROR,
        }));

        return false;
      } finally {
        // Only the latest, non-aborted check may settle the flag; a superseding call or
        // cancelValidation() owns it otherwise, and nothing may be set after unmount.
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setIsValidating(false);
        }
      }
    },
    [validate]
  );

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  return {
    errors,
    validate,
    isValid: Object.keys(errors).length === 0,
    isValidating,
    validating: isValidating,
    validateAsync,
    cancelValidation,
  };
}
