import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { getBalance } from "../stellar";
import { useStellarBalance } from "../hooks/useStellarBalance";

// Create a spy to intercept global fetch calls
const globalFetchMock = vi.spyOn(globalThis, "fetch");

describe("getBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns native XLM balance as string", async () => {
    // 1. Arrange: Simulate a successful Horizon account payload with a native XLM asset
    const mockHorizonResponse = {
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "50.0000000" },
        { asset_type: "native", balance: "142.5000000" } // The target asset your code looks for
      ]
    };

    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockHorizonResponse,
    } as Response);

    // 2. Act: Execute your balance pipeline
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Verify your array parsing logic works perfectly
    expect(balance).toBe("142.5000000");
    expect(globalFetchMock).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org/accounts/GBX...MOCK_PUBLIC_KEY"
    );
  });

  it("returns '0' when no native balance found", async () => {
    // 1. Arrange: Simulate an account that exists but does not hold a native balance object
    const mockHorizonResponse = {
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "10.0000000" }
      ]
    };

    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockHorizonResponse,
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Your code should safely fall back to "0"
    expect(balance).toBe("0");
  });

  it("returns '0' on network error", async () => {
    // 1. Arrange: Force fetch to throw an unhandled system/network exception
    globalFetchMock.mockRejectedValue(new Error("Horizon API Outage"));

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Your internal try/catch block should gracefully absorb the error and return "0"
    expect(balance).toBe("0");
  });

  it("returns '0' on HTTP error responses (4xx/5xx)", async () => {
    // 1. Arrange: Simulate Horizon returning a 500 Internal Server Error
    globalFetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ status: 500, title: "Internal Server Error" }),
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Implementation should throw and catch, returning "0"
    expect(balance).toBe("0");
  });

  it("returns '0' on HTTP 404 Not Found", async () => {
    // 1. Arrange: Simulate account not found
    globalFetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ status: 404, title: "Resource Missing" }),
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...INVALID_ACCOUNT");

    // 3. Assert
    expect(balance).toBe("0");
  });

  it("returns '0' when Horizon returns invalid JSON", async () => {
    // 1. Arrange: Simulate malformed JSON response
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); },
    } as unknown as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Malformed JSON should trigger catch block
    expect(balance).toBe("0");
  });

  it("returns '0' when response has no balances field", async () => {
    // 1. Arrange: Simulate a valid Horizon response missing the balances field
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ABC123", account_id: "GBX...", sequence: "1234" }),
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Optional chaining should handle undefined balances gracefully
    expect(balance).toBe("0");
  });

  it("returns '0' when balances array is empty", async () => {
    // 1. Arrange: Account exists but holds no assets
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [] }),
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Empty array find() should return undefined, fallback to "0"
    expect(balance).toBe("0");
  });

  it("returns native balance when multiple assets exist and native is not first", async () => {
    // 1. Arrange: Test find() logic across multiple array positions
    const mockHorizonResponse = {
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "50.0000000" },
        { asset_type: "credit_alphanum12", asset_code: "JPY", balance: "100.0000000" },
        { asset_type: "native", balance: "999.5000000" } // Native is at index 2
      ]
    };

    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockHorizonResponse,
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: find() must locate native regardless of position
    expect(balance).toBe("999.5000000");
  });

  it("returns '0' when native asset object exists but balance field is missing", async () => {
    // 1. Arrange: Malformed native balance object (missing balance field)
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        balances: [
          { asset_type: "native" } // Missing balance field
        ]
      }),
    } as Response);

    // 2. Act
    const balance = await getBalance("GBX...MOCK_PUBLIC_KEY");

    // 3. Assert: Nullish coalescing should handle undefined balance
    expect(balance).toBe("0");
  });

  it("verifies correct Horizon endpoint is called with public key", async () => {
    // 1. Arrange
    const testPublicKey = "GAXVN7PJCNQYJ4BAQY2KPKM6VHV4X5XWZVMVHJBKZRVQFKJ4QZKPK2";
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [{ asset_type: "native", balance: "100.0000000" }] }),
    } as Response);

    // 2. Act
    await getBalance(testPublicKey);

    // 3. Assert: Verify the exact endpoint construction
    expect(globalFetchMock).toHaveBeenCalledWith(
      `https://horizon-testnet.stellar.org/accounts/${testPublicKey}`
    );
    expect(globalFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useStellarBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial loading state and fetches balance", async () => {
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [{ asset_type: "native", balance: "20.0000000" }] }),
    } as Response);

    const { result } = renderHook(() => useStellarBalance("GBX...MOCK"));

    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBe("0");
    expect(result.current.stale).toBe(false);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.balance).toBe("20.0000000");
    expect(result.current.stale).toBe(false);
    expect(globalFetchMock).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org/accounts/GBX...MOCK?asset_type=native"
    );
  });

  it("uses cached balance on subsequent calls and avoids fetch storms", async () => {
    // Setup first fetch
    globalFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [{ asset_type: "native", balance: "30.0000000" }] }),
    } as Response);

    const { result: firstResult, unmount } = renderHook(() => useStellarBalance("GBX...CACHE"));
    
    await waitFor(() => {
      expect(firstResult.current.loading).toBe(false);
    });
    
    unmount();
    
    // Clear mock to ensure it doesn't fetch again
    globalFetchMock.mockClear();

    const { result: secondResult } = renderHook(() => useStellarBalance("GBX...CACHE"));
    
    // Should be initialized with cached balance instantly
    expect(secondResult.current.balance).toBe("30.0000000");
    expect(secondResult.current.loading).toBe(false); // Because it's within minFetchIntervalMs
    
    // Should not have fetched again
    expect(globalFetchMock).not.toHaveBeenCalled();
  });
});