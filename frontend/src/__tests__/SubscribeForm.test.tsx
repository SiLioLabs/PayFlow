import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import SubscribeForm from "../components/SubscribeForm";
import {
  useFormValidation,
  validateStroopAmount,
  validateInterval,
  validateAddress,
} from "../hooks/useFormValidation";
import { CONTRACT_LIMITS } from "../constants";

// ---------------------------------------------------------------------------
// Mock stellar module — must include all exports used transitively
// ---------------------------------------------------------------------------
vi.mock("../stellar", () => ({
  getAllowance: vi.fn(() => Promise.resolve(0n)),
  fetchEvents: vi.fn(() => Promise.resolve({ events: [], nextCursor: undefined })),
  buildSubscribeTx: vi.fn().mockResolvedValue("mock-xdr"),
  DEFAULT_TOKEN: "CTOKEN",
  RPC_URL: "https://soroban-testnet.stellar.org",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  CONTRACT_ID: "CTEST",
  TOKEN_CONTRACT_ID: "CTOKEN",
  server: {
    getAccount: vi.fn().mockResolvedValue({}),
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", returnValue: null }),
    sendTransaction: vi.fn().mockResolvedValue({ hash: "mock-hash", errorResult: undefined }),
  },
  getServer: vi.fn(() => ({ getAccount: vi.fn().mockResolvedValue({}) })),
}));

// Grab mocked stellar module at module scope (hoisted mock is synchronous)
import * as stellarMock from "../stellar";
const mockServer = stellarMock.server as unknown as {
  getAccount: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
};
const mockBuildSubscribeTx = stellarMock.buildSubscribeTx as ReturnType<typeof vi.fn>;

// Mock child components that require external context / RPC calls
vi.mock("../components/BalanceDisplay", () => ({
  default: () => <div data-testid="balance-display" />,
}));

vi.mock("../components/AllowanceDisplay", () => ({
  default: () => <div data-testid="allowance-display" />,
}));

vi.mock("../components/IntervalSelector", () => ({
  default: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <select
      data-testid="interval-select"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value={86400}>Daily</option>
      <option value={604800}>Weekly</option>
      <option value={2592000}>Monthly</option>
      {/* sub-minimum value for testing validation */}
      <option value={3600}>Hourly (invalid)</option>
    </select>
  ),
}));

vi.mock("../components/AddressBook", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="address-book">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock("../components/Toast", () => ({
  default: () => <div data-testid="toast-container" />,
}));

// ---------------------------------------------------------------------------
// Valid Stellar addresses for tests (generated via Keypair.random())
// ---------------------------------------------------------------------------
const VALID_MERCHANT = "GARWT7ZMBP23JGTISGFVDSX55SC3LMAAD5PSFBYTS3EDTMDNY4XHW3SZ";
const VALID_USER = "GB5RRJJAWEZVPYO2RW5FGYP5M2YGI3T4Q53CAA3FPIJJG4ZOFMJYGMDM";

// ---------------------------------------------------------------------------
// Constants verification
// ---------------------------------------------------------------------------

describe("CONTRACT_LIMITS constants", () => {
  it("MIN_INTERVAL_SECONDS is 86400 (1 day)", () => {
    expect(CONTRACT_LIMITS.MIN_INTERVAL_SECONDS).toBe(86400);
  });

  it("MAX_SUBSCRIPTION_AMOUNT is 100 trillion stroops", () => {
    expect(CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).toBe(100_000_000_000_000n);
  });
});

// ---------------------------------------------------------------------------
// Pure validation function unit tests
// ---------------------------------------------------------------------------

describe("validateStroopAmount", () => {
  const max = CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT;

  it("rejects empty string", () => {
    const result = validateStroopAmount("", max);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it("rejects zero", () => {
    const result = validateStroopAmount("0", max);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it("rejects negative value", () => {
    const result = validateStroopAmount("-1", max);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it("rejects non-numeric string", () => {
    const result = validateStroopAmount("abc", max);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it("accepts a small positive amount (1 stroop = 0.0000001 XLM)", () => {
    const result = validateStroopAmount("0.0000001", max);
    expect(result.valid).toBe(true);
  });

  it("accepts amount exactly at max (10_000_000 XLM = 100_000_000_000_000 stroops)", () => {
    const result = validateStroopAmount("10000000", max);
    expect(result.valid).toBe(true);
  });

  it("rejects amount exceeding MAX_SUBSCRIPTION_AMOUNT (10_000_001 XLM)", () => {
    // 10_000_001 XLM → 100_000_010_000_000 stroops > 100_000_000_000_000n
    const result = validateStroopAmount("10000001", max);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/exceeds maximum/i);
  });

  it("accepts a typical subscription amount (5 XLM)", () => {
    const result = validateStroopAmount("5", max);
    expect(result.valid).toBe(true);
  });
});

describe("validateInterval", () => {
  const min = CONTRACT_LIMITS.MIN_INTERVAL_SECONDS; // 86400

  it("rejects zero", () => {
    const result = validateInterval(0, min);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it("rejects negative value", () => {
    const result = validateInterval(-1, min);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/greater than 0/i);
  });

  it("rejects interval below minimum (3600 < 86400)", () => {
    const result = validateInterval(3600, min);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 86400/i);
  });

  it("rejects interval of 86399 (one second short of minimum)", () => {
    const result = validateInterval(86399, min);
    expect(result.valid).toBe(false);
  });

  it("accepts interval exactly at minimum (86400)", () => {
    const result = validateInterval(86400, min);
    expect(result.valid).toBe(true);
  });

  it("accepts weekly interval (604800)", () => {
    const result = validateInterval(604800, min);
    expect(result.valid).toBe(true);
  });

  it("accepts monthly interval (2592000)", () => {
    const result = validateInterval(2592000, min);
    expect(result.valid).toBe(true);
  });
});

describe("validateAddress", () => {
  it("rejects empty string", () => {
    const result = validateAddress("");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it("rejects address shorter than 56 chars", () => {
    const result = validateAddress("GABCDE");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid stellar address/i);
  });

  it("rejects a string that does not have a valid Stellar checksum", () => {
    // 56 chars but invalid checksum
    const result = validateAddress("G" + "A".repeat(55));
    expect(result.valid).toBe(false);
  });

  it("accepts VALID_MERCHANT — a real valid Stellar Ed25519 public key", () => {
    const result = validateAddress(VALID_MERCHANT);
    expect(result.valid).toBe(true);
  });

  it("accepts VALID_USER — another real valid Stellar Ed25519 public key", () => {
    const result = validateAddress(VALID_USER);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useFormValidation hook tests
// ---------------------------------------------------------------------------

describe("useFormValidation hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServer.getAccount.mockResolvedValue({});
    mockServer.getTransaction.mockResolvedValue({ status: "SUCCESS", returnValue: null });
    mockServer.sendTransaction.mockResolvedValue({ hash: "mock-hash", errorResult: undefined });
  });

  it("starts with no errors and isValid true", () => {
    const { result } = renderHook(() => useFormValidation());
    expect(result.current.errors).toEqual({});
    expect(result.current.isValid).toBe(true);
  });

  it("validate() returns false and sets errors for invalid merchant", () => {
    const { result } = renderHook(() => useFormValidation());
    let valid: boolean;
    act(() => {
      valid = result.current.validate({
        merchant: "INVALID",
        amount: "5",
        interval: 86400,
      });
    });
    expect(valid!).toBe(false);
    expect(result.current.errors.merchant).toBeTruthy();
    expect(result.current.isValid).toBe(false);
  });

  it("validate() returns false and sets errors for zero amount", () => {
    const { result } = renderHook(() => useFormValidation());
    let valid: boolean;
    act(() => {
      valid = result.current.validate({
        merchant: VALID_MERCHANT,
        amount: "0",
        interval: 86400,
      });
    });
    expect(valid!).toBe(false);
    expect(result.current.errors.amount).toBeTruthy();
  });

  it("validate() returns false and sets errors for amount exceeding max", () => {
    const { result } = renderHook(() => useFormValidation());
    let valid: boolean;
    act(() => {
      valid = result.current.validate({
        merchant: VALID_MERCHANT,
        amount: "10000001", // > 10_000_000 XLM = 100_000_010_000_000 stroops > max
        interval: 86400,
      });
    });
    expect(valid!).toBe(false);
    expect(result.current.errors.amount).toMatch(/exceeds maximum/i);
  });

  it("validate() returns false and sets errors for interval below min (3600 < 86400)", () => {
    const { result } = renderHook(() => useFormValidation());
    let valid: boolean;
    act(() => {
      valid = result.current.validate({
        merchant: VALID_MERCHANT,
        amount: "5",
        interval: 3600, // below MIN_INTERVAL_SECONDS=86400
      });
    });
    expect(valid!).toBe(false);
    expect(result.current.errors.interval).toBeTruthy();
  });

  it("validate() returns true and clears errors when all fields are valid", () => {
    const { result } = renderHook(() => useFormValidation());
    // First make it invalid
    act(() => {
      result.current.validate({
        merchant: "INVALID",
        amount: "0",
        interval: 100,
      });
    });
    expect(result.current.isValid).toBe(false);

    // Then fix all fields
    act(() => {
      result.current.validate({
        merchant: VALID_MERCHANT,
        amount: "5",
        interval: 86400,
      });
    });
    expect(result.current.isValid).toBe(true);
    expect(result.current.errors).toEqual({});
  });

  it("validateAsync() calls server.getAccount for a valid merchant", async () => {
    mockServer.getAccount.mockResolvedValue({});
    const { result } = renderHook(() => useFormValidation());
    let valid: boolean;
    await act(async () => {
      valid = await result.current.validateAsync({
        merchant: VALID_MERCHANT,
        amount: "5",
        interval: 86400,
      });
    });
    expect(valid!).toBe(true);
    expect(mockServer.getAccount).toHaveBeenCalledWith(VALID_MERCHANT);
  });

  it("validateAsync() returns false without calling getAccount for invalid merchant", async () => {
    const { result } = renderHook(() => useFormValidation());
    let valid: boolean;
    await act(async () => {
      valid = await result.current.validateAsync({
        merchant: "INVALID",
        amount: "5",
        interval: 86400,
      });
    });
    expect(valid!).toBe(false);
    expect(mockServer.getAccount).not.toHaveBeenCalled();
  });

  it("validateAsync() sets 'Account not found' error when getAccount throws", async () => {
    mockServer.getAccount.mockRejectedValueOnce(new Error("Not found"));
    const { result } = renderHook(() => useFormValidation());
    await act(async () => {
      await result.current.validateAsync({
        merchant: VALID_MERCHANT,
        amount: "5",
        interval: 86400,
      });
    });
    expect(result.current.errors.merchant).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// SubscribeForm component integration tests
// ---------------------------------------------------------------------------

function renderForm(props?: Partial<React.ComponentProps<typeof SubscribeForm>>) {
  const onSign = vi.fn().mockResolvedValue("mock-hash");
  const onSuccess = vi.fn();
  const announce = vi.fn();
  render(
    <SubscribeForm
      userKey={VALID_USER}
      onSign={onSign}
      onSuccess={onSuccess}
      announce={announce}
      {...props}
    />
  );
  return { onSign, onSuccess, announce };
}

describe("SubscribeForm component — inline validation on blur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServer.getAccount.mockResolvedValue({});
    mockServer.getTransaction.mockResolvedValue({ status: "SUCCESS", returnValue: null });
    mockServer.sendTransaction.mockResolvedValue({ hash: "mock-hash", errorResult: undefined });
    mockBuildSubscribeTx.mockResolvedValue("mock-xdr");
  });

  it("does not show merchant error before field is touched", () => {
    renderForm();
    expect(screen.queryByTestId("merchant-error")).not.toBeInTheDocument();
  });

  it("shows merchant error after blur with empty value", async () => {
    renderForm();
    const input = screen.getByTestId("merchant-input");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId("merchant-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("merchant-error")).toHaveAttribute("role", "alert");
  });

  it("shows merchant error after blur with invalid address", async () => {
    renderForm();
    const input = screen.getByTestId("merchant-input");
    await userEvent.type(input, "INVALID_ADDRESS");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId("merchant-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("merchant-error")).toHaveTextContent(/invalid stellar address/i);
  });

  it("merchant input has aria-invalid=true after blur with invalid address", async () => {
    renderForm();
    const input = screen.getByTestId("merchant-input");
    await userEvent.type(input, "BADADDR");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("merchant input has aria-describedby pointing to error element", async () => {
    renderForm();
    const input = screen.getByTestId("merchant-input");
    await userEvent.type(input, "BADADDR");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-describedby", "merchant-error");
    });
  });

  it("clears merchant error after entering a valid address", async () => {
    renderForm();
    const input = screen.getByTestId("merchant-input");
    // First trigger an error
    await userEvent.type(input, "BADADDR");
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByTestId("merchant-error")).toBeInTheDocument());

    // Clear and type a valid address — validate() runs on change via useEffect
    await userEvent.clear(input);
    await userEvent.type(input, VALID_MERCHANT);
    await waitFor(() => {
      expect(screen.queryByTestId("merchant-error")).not.toBeInTheDocument();
    });
  });

  it("does not show amount error before field is touched", () => {
    renderForm();
    expect(screen.queryByTestId("amount-error")).not.toBeInTheDocument();
  });

  it("shows amount error after blur with empty value", async () => {
    renderForm();
    const input = screen.getByTestId("amount-input");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId("amount-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("amount-error")).toHaveAttribute("role", "alert");
  });

  it("shows amount error for zero value after blur", async () => {
    renderForm();
    const input = screen.getByTestId("amount-input");
    await userEvent.type(input, "0");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId("amount-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("amount-error")).toHaveTextContent(/greater than 0/i);
  });

  it("shows amount error for value exceeding MAX_SUBSCRIPTION_AMOUNT (10_000_001 XLM)", async () => {
    renderForm();
    const input = screen.getByTestId("amount-input");
    // 10_000_001 XLM → 100_000_010_000_000 stroops > max of 100_000_000_000_000n
    await userEvent.type(input, "10000001");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId("amount-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("amount-error")).toHaveTextContent(/exceeds maximum/i);
  });

  it("amount input has aria-invalid=true after blur with invalid value", async () => {
    renderForm();
    const input = screen.getByTestId("amount-input");
    await userEvent.type(input, "-5");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("amount input has aria-describedby pointing to error element", async () => {
    renderForm();
    const input = screen.getByTestId("amount-input");
    await userEvent.type(input, "0");
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-describedby", "amount-error");
    });
  });

  it("shows interval error after blur with sub-minimum value (3600 < 86400)", async () => {
    renderForm();
    const select = screen.getByTestId("interval-select");
    // Select the sub-minimum option
    await userEvent.selectOptions(select, "3600");
    const wrapper = screen.getByTestId("interval-wrapper");
    fireEvent.blur(wrapper);
    await waitFor(() => {
      expect(screen.getByTestId("interval-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("interval-error")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("interval-error")).toHaveTextContent(/at least 86400/i);
  });

  it("submit button is disabled when form is invalid (empty fields on mount)", () => {
    renderForm();
    const btn = screen.getByRole("button", { name: /subscribe/i });
    expect(btn).toBeDisabled();
  });

  it("submit button becomes enabled when all fields are valid", async () => {
    renderForm();
    const merchantInput = screen.getByTestId("merchant-input");
    const amountInput = screen.getByTestId("amount-input");

    // Default interval is Monthly (2592000) which passes validation
    await userEvent.type(merchantInput, VALID_MERCHANT);
    await userEvent.type(amountInput, "5");

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /subscribe/i })).not.toBeDisabled();
      },
      { timeout: 3000 }
    );
  });

  it("submit marks all fields as touched — merchant error shown when merchant is empty", async () => {
    renderForm();
    const amountInput = screen.getByTestId("amount-input");
    await userEvent.type(amountInput, "5");

    // Form is disabled because merchant is empty — submit via form.submit to bypass disabled check
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    // After submit attempt all fields are touched — merchant error must appear
    await waitFor(() => {
      expect(screen.getByTestId("merchant-error")).toBeInTheDocument();
    });
  });

  it("submit is blocked when amount is 0 — amount error shown after submit attempt", async () => {
    renderForm();
    const merchantInput = screen.getByTestId("merchant-input");
    const amountInput = screen.getByTestId("amount-input");

    await userEvent.type(merchantInput, VALID_MERCHANT);
    await userEvent.type(amountInput, "0");

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByTestId("amount-error")).toBeInTheDocument();
    });
  });

  it("calls buildSubscribeTx and onSign when valid form is submitted", async () => {
    mockBuildSubscribeTx.mockResolvedValue("mock-xdr");
    const onSign = vi.fn().mockResolvedValue("mock-hash");
    const onSuccess = vi.fn();

    render(
      <SubscribeForm
        userKey={VALID_USER}
        onSign={onSign}
        onSuccess={onSuccess}
        announce={vi.fn()}
      />
    );

    const merchantInput = screen.getByTestId("merchant-input");
    const amountInput = screen.getByTestId("amount-input");

    await userEvent.type(merchantInput, VALID_MERCHANT);
    await userEvent.type(amountInput, "5");

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: /subscribe/i })).not.toBeDisabled();
      },
      { timeout: 3000 }
    );

    await userEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    await waitFor(() => {
      expect(mockBuildSubscribeTx).toHaveBeenCalled();
      expect(onSign).toHaveBeenCalledWith("mock-xdr");
    });
  });
});
