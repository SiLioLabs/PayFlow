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
import type { Account } from "@stellar/stellar-sdk";
import { CONTRACT_LIMITS } from "../constants";

const mockedServer = vi.mocked(server);

const validFields: FormFields = {
  merchant: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  amount: "10",
  interval: 3600,
  tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
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
    expect(result.current.errors.merchant).toBe("Invalid Stellar address or contract ID.");
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
      expect(hook.result.current.errors.merchant).toBe("Invalid Stellar address or contract ID.");
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

  describe("isValidating", () => {
    const fields = { ...validFields, interval: CONTRACT_LIMITS.MIN_INTERVAL_SECONDS };

    function deferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("is true only while the server check is in flight", async () => {
      const d = deferred<Account>();
      mockedServer.getAccount.mockReturnValueOnce(d.promise);
      const hook = renderHook(() => useFormValidation());

      expect(hook.result.current.isValidating).toBe(false);

      let promise!: Promise<boolean>;
      act(() => {
        promise = hook.result.current.validateAsync(fields);
      });
      expect(hook.result.current.isValidating).toBe(true);
      expect(hook.result.current.validating).toBe(true);

      await act(async () => {
        d.resolve({} as Account);
        await promise;
      });
      expect(hook.result.current.isValidating).toBe(false);
    });

    it("resets when a newer call fails sync validation after aborting a pending check", async () => {
      const d = deferred<Account>();
      mockedServer.getAccount.mockReturnValueOnce(d.promise);
      const hook = renderHook(() => useFormValidation());

      let first!: Promise<boolean>;
      act(() => {
        first = hook.result.current.validateAsync(fields);
      });
      expect(hook.result.current.isValidating).toBe(true);

      let second!: Promise<boolean>;
      act(() => {
        second = hook.result.current.validateAsync({ ...fields, merchant: "bad" });
      });
      expect(hook.result.current.isValidating).toBe(false);

      await act(async () => {
        d.resolve({} as Account);
        expect(await first).toBe(false);
        expect(await second).toBe(false);
      });
      expect(hook.result.current.isValidating).toBe(false);
    });

    it("stays true while a superseding check is still in flight", async () => {
      const d1 = deferred<Account>();
      const d2 = deferred<Account>();
      mockedServer.getAccount.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
      const hook = renderHook(() => useFormValidation());

      let first!: Promise<boolean>;
      let second!: Promise<boolean>;
      act(() => {
        first = hook.result.current.validateAsync(fields);
      });
      act(() => {
        second = hook.result.current.validateAsync(fields);
      });

      // The stale check settling must not clear the flag owned by the newer one.
      await act(async () => {
        d1.resolve({} as Account);
        expect(await first).toBe(false);
      });
      expect(hook.result.current.isValidating).toBe(true);

      await act(async () => {
        d2.resolve({} as Account);
        expect(await second).toBe(true);
      });
      expect(hook.result.current.isValidating).toBe(false);
    });

    it("cancelValidation aborts the stale check and ignores its failure", async () => {
      const d = deferred<Account>();
      mockedServer.getAccount.mockReturnValueOnce(d.promise);
      const hook = renderHook(() => useFormValidation());

      let promise!: Promise<boolean>;
      act(() => {
        promise = hook.result.current.validateAsync(fields);
      });
      act(() => {
        hook.result.current.cancelValidation();
      });
      expect(hook.result.current.isValidating).toBe(false);

      await act(async () => {
        d.reject(new Error("Account not found"));
        expect(await promise).toBe(false);
      });
      expect(hook.result.current.errors.merchant).toBeUndefined();
      expect(hook.result.current.isValidating).toBe(false);
    });

    it("aborts the in-flight check on unmount", async () => {
      const d = deferred<Account>();
      mockedServer.getAccount.mockReturnValueOnce(d.promise);
      const hook = renderHook(() => useFormValidation());

      let promise!: Promise<boolean>;
      act(() => {
        promise = hook.result.current.validateAsync(fields);
      });
      hook.unmount();

      d.resolve({} as Account);
      await expect(promise).resolves.toBe(false);
    });

    it("skips the account lookup for contract-ID merchants", async () => {
      const hook = renderHook(() => useFormValidation());

      let ok = false;
      await act(async () => {
        ok = await hook.result.current.validateAsync({
          ...fields,
          merchant: validFields.tokenAddress,
        });
      });

      expect(ok).toBe(true);
      expect(mockedServer.getAccount).not.toHaveBeenCalled();
      expect(hook.result.current.isValidating).toBe(false);
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
