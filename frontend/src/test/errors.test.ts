import { parseContractError, CONTRACT_ERRORS } from "../utils/errors";
import { describe, it, expect, vi } from "vitest";

describe("parseContractError", () => {
  it("extracts known errors from string", () => {
    const message = parseContractError("some raw error with daily limit exceeded inside");
    expect(message).toBe(CONTRACT_ERRORS["daily limit exceeded"]);
  });

  it("extracts known errors from object with events", () => {
    const simResult = {
      events: [
        {
          event: {
            value: "subscription paused"
          }
        }
      ]
    };
    const message = parseContractError(simResult);
    expect(message).toBe(CONTRACT_ERRORS["subscription paused"]);
  });

  it("dispatches custom event on match", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    parseContractError("insufficient allowance");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payflow:error", detail: CONTRACT_ERRORS["insufficient allowance"] })
    );
    spy.mockRestore();
  });

  it("returns null for unknown errors", () => {
    const message = parseContractError("HostError: Value(Status(ContractError(3)))");
    expect(message).toBeNull();
  });
});
