import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSubscriptionSync } from "../hooks/useSubscriptionSync";
import { useSubscription } from "../hooks/useSubscription";
import { useTransaction } from "../hooks/useTransaction";

vi.mock("../hooks/useSubscription", () => ({
  useSubscription: vi.fn(),
}));

vi.mock("../hooks/useTransaction", () => ({
  useTransaction: vi.fn(),
}));

describe("useSubscriptionSync", () => {
  const mockSubscription = { active: true, amount: "100" } as any;

  beforeEach(() => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: mockSubscription,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    vi.mocked(useTransaction).mockReturnValue({
      status: "idle",
      hash: null,
      error: null,
      submit: vi.fn().mockResolvedValue("hash"),
    });
  });

  it("optimistic cancel sets active: false immediately; rollback restores active: true on error", async () => {
    let rejectPromise: (reason?: any) => void;
    const submitPromise = new Promise<string>((_, reject) => {
      rejectPromise = reject;
    });

    const submitMock = vi.fn().mockReturnValue(submitPromise);
    vi.mocked(useTransaction).mockReturnValue({
      status: "idle",
      hash: null,
      error: null,
      submit: submitMock,
    });

    const { result } = renderHook(() => useSubscriptionSync("test"));

    expect(result.current.subscription?.active).toBe(true);

    let error;
    let promise: Promise<void>;

    act(() => {
      promise = result.current.mutate("cancel", vi.fn(), { active: false });
    });

    // Check after optimistic update
    expect(result.current.subscription?.active).toBe(false);

    await act(async () => {
      rejectPromise!(new Error("Failed"));
      try {
        await promise;
      } catch (e) {
        error = e;
      }
    });

    expect(error).toBeDefined();
    // Rollback restores state
    expect(result.current.subscription?.active).toBe(true);
  });
});
