import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../stellar", () => ({
  server: {
    getAccount: vi.fn(),
  },
}));

import {
  useFormValidation,
  type FormFields,
  validateStroopAmount,
  validateInterval,
  validateAddress,
} from "../hooks/useFormValidation";
import { server } from "../stellar";
import { CONTRACT_LIMITS } from "../constants";

const mockedServer = vi.mocked(server);

const validFields: FormFields = {
  merchant: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  amount: "10",
  interval: 3600,
};

function validateFields(fields: FormFields) {
  const hook = renderHook(() => useFormValidation());
  let isValid = false;

  act(() => {
    isValid = hook.result.current.validate(fields);
  });

  return { ...hook, isValid };
}

describe("useFormValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a merchant error when merchant address is empty", () => {
    const { result, isValid } = validateFields({
      ...validFields,
      merchant: "",
    });

    expect(isValid).toBe(false);
    expect(result.current.errors.merchant).toBe("Address is required.");
  });

  it("returns a merchant error when merchant address is not a valid Stellar address", () => {
    const { result, isValid } = validateFields({
      ...validFields,
      merchant: "not-a-stellar-address",
    });

    expect(isValid).toBe(false);
    expect(result.current.errors.merchant).toBe("Invalid Stellar address.");
  });

  it("returns an amount error when amount is zero", () => {
    const { result, isValid } = validateFields({
      ...validFields,
      amount: "0",
    });

    expect(isValid).toBe(false);
    expect(result.current.errors.amount).toBe("Amount must be greater than 0.");
  });

  it("returns no errors for valid fields", () => {
    const { result, isValid } = validateFields({
      ...validFields,
      interval: CONTRACT_LIMITS.MIN_INTERVAL_SECONDS,
    });

    expect(isValid).toBe(true);
    expect(result.current.errors).toEqual({});
  });

  describe("validateAsync", () => {
    it("returns true and clears merchant error if on-chain account exists", async () => {
      mockedServer.getAccount.mockResolvedValue({} as any);

      const hook = renderHook(() => useFormValidation());

      let isValid: boolean | null = null;
      let promise: Promise<boolean>;

      act(() => {
        promise = hook.result.current.validateAsync({
          ...validFields,
          interval: CONTRACT_LIMITS.MIN_INTERVAL_SECONDS,
        });
      });

      expect(hook.result.current.validating).toBe(true);

      await act(async () => {
        isValid = await promise;
      });

      expect(isValid).toBe(true);
      expect(hook.result.current.validating).toBe(false);
      expect(hook.result.current.errors.merchant).toBeUndefined();
      expect(mockedServer.getAccount).toHaveBeenCalledWith(validFields.merchant);
    });

    it("returns false and sets merchant error if on-chain account does not exist", async () => {
      mockedServer.getAccount.mockRejectedValue(new Error("Account not found"));

      const hook = renderHook(() => useFormValidation());

      let isValid: boolean | null = null;
      let promise: Promise<boolean>;

      act(() => {
        promise = hook.result.current.validateAsync({
          ...validFields,
          interval: CONTRACT_LIMITS.MIN_INTERVAL_SECONDS,
        });
      });

      expect(hook.result.current.validating).toBe(true);

      await act(async () => {
        isValid = await promise;
      });

      expect(isValid).toBe(false);
      expect(hook.result.current.validating).toBe(false);
      expect(hook.result.current.errors.merchant).toBe("Account not found on network.");
    });

    it("returns false and does not call RPC if sync validation fails", async () => {
      const hook = renderHook(() => useFormValidation());

      let isValid: boolean | null = null;
      let promise: Promise<boolean>;

      act(() => {
        promise = hook.result.current.validateAsync({
          ...validFields,
          merchant: "invalid-addr",
        });
      });

      expect(hook.result.current.validating).toBe(false);

      await act(async () => {
        isValid = await promise;
      });

      expect(isValid).toBe(false);
      expect(mockedServer.getAccount).not.toHaveBeenCalled();
      expect(hook.result.current.errors.merchant).toBe("Invalid Stellar address.");
    });

    it("aborts previous validation request when a new validation starts", async () => {
      let resolve1: any;
      const p1 = new Promise<any>((resolve) => {
        resolve1 = resolve;
      });
      mockedServer.getAccount.mockReturnValueOnce(p1);
      mockedServer.getAccount.mockResolvedValueOnce({} as any);

      const hook = renderHook(() => useFormValidation());

      let res1: boolean | null = null;
      let res2: boolean | null = null;
      let promise1: Promise<boolean>;
      let promise2: Promise<boolean>;

      act(() => {
        promise1 = hook.result.current.validateAsync({
          ...validFields,
          interval: CONTRACT_LIMITS.MIN_INTERVAL_SECONDS,
        });
      });

      expect(hook.result.current.validating).toBe(true);

      // Trigger second validation immediately
      act(() => {
        promise2 = hook.result.current.validateAsync({
          ...validFields,
          interval: CONTRACT_LIMITS.MIN_INTERVAL_SECONDS,
        });
      });

      // Resolve the first one (should be ignored)
      await act(async () => {
        resolve1({});
        res1 = await promise1;
      });

      // Wait for second one to resolve
      await act(async () => {
        res2 = await promise2;
      });

      expect(res1).toBe(false); // Aborted call returns false
      expect(res2).toBe(true);
      expect(hook.result.current.validating).toBe(false);
    });
  });
});

describe("validateStroopAmount", () => {
  it("returns invalid for empty string", () => {
    const result = validateStroopAmount("", CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    expect(result.valid).toBe(false);
  });

  it("returns invalid for zero", () => {
    const result = validateStroopAmount("0", CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    expect(result.valid).toBe(false);
  });

  it("returns invalid for negative amount", () => {
    const result = validateStroopAmount("-10", CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    expect(result.valid).toBe(false);
  });

  it("returns invalid for amount over max", () => {
    const result = validateStroopAmount("100000000001", CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT);
    expect(result.valid).toBe(false);
  });

  it("returns valid for amount exactly at max", () => {
    const result = validateStroopAmount("10000", CONTRACT_LIMITS.MAX_PAY_PER_USE_AMOUNT); // 10000 XLM = 10000 * 10^7 = 1e11 stroops
    expect(result.valid).toBe(true);
  });
});

describe("validateInterval", () => {
  it("returns invalid for 0", () => {
    const result = validateInterval(0, CONTRACT_LIMITS.MIN_INTERVAL_SECONDS);
    expect(result.valid).toBe(false);
  });

  it("returns invalid for less than min", () => {
    const result = validateInterval(
      CONTRACT_LIMITS.MIN_INTERVAL_SECONDS - 1,
      CONTRACT_LIMITS.MIN_INTERVAL_SECONDS
    );
    expect(result.valid).toBe(false);
  });

  it("returns valid for exactly min", () => {
    const result = validateInterval(
      CONTRACT_LIMITS.MIN_INTERVAL_SECONDS,
      CONTRACT_LIMITS.MIN_INTERVAL_SECONDS
    );
    expect(result.valid).toBe(true);
  });

  it("returns valid for more than min", () => {
    const result = validateInterval(
      CONTRACT_LIMITS.MIN_INTERVAL_SECONDS + 1,
      CONTRACT_LIMITS.MIN_INTERVAL_SECONDS
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateAddress", () => {
  it("returns invalid for empty string", () => {
    const result = validateAddress("");
    expect(result.valid).toBe(false);
  });

  it("returns invalid for invalid address", () => {
    const result = validateAddress("invalid");
    expect(result.valid).toBe(false);
  });

  it("returns valid for valid address", () => {
    const result = validateAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(result.valid).toBe(true);
  });
});
