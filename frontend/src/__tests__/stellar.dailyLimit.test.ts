import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { _clearCacheForTesting } from "../services/rpcCache";

// ── Mock RPC layer — same pattern as stellar.builders.test.ts ────────────────
//
// Contract itself is NOT mocked: it's the real @stellar/stellar-sdk class, so
// `new Contract(CONTRACT_ID)` succeeds and `contract.call(...)` produces real
// xdr operations. Only the RPC Server is mocked; `simulateTransaction` returns
// whatever ScVal retval each test stages.
vi.mock("@stellar/stellar-sdk/rpc", () => {
  return {
    Server: class {
      getEvents = vi.fn();
      simulateTransaction = vi.fn();
      getAccount = vi.fn();
      getHealth = vi.fn();
      getTransaction = vi.fn();
      sendTransaction = vi.fn();
    },
    assembleTransaction: vi.fn(),
  };
});

// `stellar.ts` reads `import.meta.env.VITE_CONTRACT_ID` exactly once, at
// module-load time, into the exported `CONTRACT_ID` constant — and
// `new Contract(CONTRACT_ID)` throws on an empty/invalid contract id. So we
// must set a syntactically valid contract id *before* "../stellar" is first
// evaluated. Static imports are hoisted above this statement, so "../stellar"
// is imported dynamically in `beforeAll` below. See stellar.builders.test.ts
// for the full rationale and the origin of these valid-format strkeys.
const MOCK_CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
import.meta.env.VITE_CONTRACT_ID = MOCK_CONTRACT_ID;

// Valid-format strkey addresses (not real deployed/funded accounts).
const SOURCE = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA";
const USER_A = "GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC";
const USER_B = "GACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAJJHP";

// ── ScVal builders ────────────────────────────────────────────────────────────

function makeI128ScVal(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}

function makeOptionI128ScVal(n: bigint | null): xdr.ScVal {
  if (n === null) {
    // Option None arrives as scvVoid on the wire for our decoder
    return xdr.ScVal.scvVoid();
  }
  // For Option Some, Soroban returns the inner ScVal directly in some SDK
  // versions — the decoder handles both via decodeOption.
  return makeI128ScVal(n);
}

function makeU64OptionScVal(n: bigint | null): xdr.ScVal {
  if (n === null) return xdr.ScVal.scvVoid();
  return nativeToScVal(n, { type: "u64" });
}

function makeVoid(): xdr.ScVal {
  return xdr.ScVal.scvVoid();
}

// ── Module under test (imported after env setup) ─────────────────────────────

let stellar: typeof import("../stellar");

beforeAll(async () => {
  stellar = await import("../stellar");
});

const getAccountMock = () => stellar.server.getAccount as unknown as ReturnType<typeof vi.fn>;
const simulateMock = () =>
  stellar.server.simulateTransaction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // dedupedCall caches successful reads for 5s — reset between tests so each
  // test's staged retvals are actually consumed.
  _clearCacheForTesting();
  // TransactionBuilder.build() needs a real Account-shaped object.
  getAccountMock().mockResolvedValue(new Account(SOURCE, "0"));
  simulateMock().mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("stellar daily limit helpers (Issue 050)", () => {
  it("getDailyLimit returns Some limit", async () => {
    simulateMock().mockResolvedValue({ result: { retval: makeOptionI128ScVal(100_000_000n) } });
    const val = await stellar.getDailyLimit(USER_A);
    expect(val).toBe(100_000_000n);
  });

  it("getDailyLimit returns null when None", async () => {
    simulateMock().mockResolvedValue({ result: { retval: makeVoid() } });
    const val = await stellar.getDailyLimit(USER_B);
    expect(val).toBeNull();
  });

  it("getDailySpent returns 0 when retval missing", async () => {
    simulateMock().mockResolvedValue({ result: {} });
    const val = await stellar.getDailySpent(USER_A);
    expect(val).toBe(0n);
  });

  it("getDailySpent decodes i128", async () => {
    simulateMock().mockResolvedValue({ result: { retval: makeI128ScVal(70_000_000n) } });
    const val = await stellar.getDailySpent(USER_B);
    expect(val).toBe(70_000_000n);
  });

  it("getDayStart returns timestamp when Some", async () => {
    simulateMock().mockResolvedValue({ result: { retval: makeU64OptionScVal(123456789n) } });
    const val = await stellar.getDayStart(USER_A);
    expect(val).toBe(123456789n);
  });

  it("getDayStart returns null when None/void", async () => {
    simulateMock().mockResolvedValue({ result: { retval: makeVoid() } });
    const val = await stellar.getDayStart(USER_B);
    expect(val).toBeNull();
  });

  it("getDailyLimitStatus computes remaining and dayActive", async () => {
    // Stages (in call order): getDailyLimit → getDailySpent → getDayStart
    simulateMock()
      .mockResolvedValueOnce({ result: { retval: makeOptionI128ScVal(100_000_000n) } })
      .mockResolvedValueOnce({ result: { retval: makeI128ScVal(70_000_000n) } })
      .mockResolvedValueOnce({ result: { retval: makeU64OptionScVal(999n) } });
    const status = await stellar.getDailyLimitStatus(USER_A);
    expect(status.limit).toBe(100_000_000n);
    expect(status.spent).toBe(70_000_000n);
    expect(status.remaining).toBe(30_000_000n);
    expect(status.dayActive).toBe(true);
    expect(status.dayStart).toBe(999n);
  });

  it("getDailyLimitStatus remaining null when no limit", async () => {
    simulateMock()
      .mockResolvedValueOnce({ result: { retval: makeVoid() } })
      .mockResolvedValueOnce({ result: { retval: makeI128ScVal(5_000_000n) } })
      .mockResolvedValueOnce({ result: { retval: makeVoid() } });
    const status = await stellar.getDailyLimitStatus(USER_B);
    expect(status.limit).toBeNull();
    expect(status.remaining).toBeNull();
    expect(status.dayActive).toBe(false);
  });
});
