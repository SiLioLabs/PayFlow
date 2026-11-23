// @vitest-environment jsdom
import { Account, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: class {
    getAccount = vi.fn().mockResolvedValue({ id: "mock-account" });
    simulateTransaction = vi.fn();
  },
  assembleTransaction: vi.fn(),
}));

describe("getMerchantRevenueDays", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("decodes daily rows across multiple bounded contract pages", async () => {
    vi.stubEnv(
      "VITE_CONTRACT_ID",
      "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526"
    );
    const { getMerchantRevenueDays, server } = await import("../stellar");
    const merchant = "GCOEYT3WI3LY34I7DN7BR7AF33TNF2YF4OYTLVPJKMYAWT2RWEF5BUDK";
    vi.mocked(server.getAccount).mockResolvedValue(new Account(merchant, "1"));
    const makeEntry = (day: number, amount: string) =>
      xdr.ScVal.scvVec([
        nativeToScVal(day, { type: "u64" }),
        nativeToScVal(amount, { type: "i128" }),
      ]);
    const firstPage = Array.from({ length: 30 }, (_, index) =>
      makeEntry(20_000 + index, String(index + 1))
    );
    const secondPage = [makeEntry(20_030, "31")];
    vi.mocked(server.simulateTransaction)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvVec(firstPage) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvVec(secondPage) },
      } as never);

    const result = await getMerchantRevenueDays(merchant);

    expect(result).toHaveLength(31);
    expect(result[0]).toEqual({ day: 20_000, amount: 1n });
    expect(result[30]).toEqual({ day: 20_030, amount: 31n });
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
  });
});
