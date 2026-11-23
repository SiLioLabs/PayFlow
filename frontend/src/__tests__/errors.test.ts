import { describe, it, expect } from "vitest";
import { friendlyError, extractContractErrorCode, CONTRACT_ERRORS } from "../utils/errors";

describe("friendlyError — MerchantNotWhitelisted (code 10)", () => {
  const expected =
    "This merchant is not whitelisted. Ask the protocol admin to add them first.";

  it("maps the Soroban numeric code #10", () => {
    expect(friendlyError("error(Contract, #10)")).toBe(expected);
  });

  it("maps the lowercase contract error form", () => {
    expect(friendlyError("error(contract, #10)")).toBe(expected);
  });

  it("maps the bare #10 alias", () => {
    expect(friendlyError("#10")).toBe(expected);
  });

  it("maps a descriptive panic string", () => {
    expect(friendlyError("MerchantNotWhitelisted")).toBe(expected);
    expect(friendlyError("merchant not whitelisted")).toBe(expected);
  });
});

describe("friendlyError — passthrough", () => {
  it("returns the raw message when no mapping matches", () => {
    expect(friendlyError("something completely unknown")).toBe("something completely unknown");
  });
});

describe("extractContractErrorCode", () => {
  it("extracts canonical error(contract, #N) codes regardless of casing", () => {
    expect(extractContractErrorCode("Error(Contract, #25)")).toBe("#25");
    expect(extractContractErrorCode("error(contract, #8)")).toBe("#8");
  });

  it("extracts bare #N codes", () => {
    expect(extractContractErrorCode("ContractError #18")).toBe("#18");
  });

  it("returns null when no code is present", () => {
    expect(extractContractErrorCode("RPC timeout")).toBeNull();
  });
});

describe("CONTRACT_ERRORS", () => {
  it("contains a stable #10 mapping", () => {
    expect(CONTRACT_ERRORS["#10"]).toBeDefined();
  });
});
