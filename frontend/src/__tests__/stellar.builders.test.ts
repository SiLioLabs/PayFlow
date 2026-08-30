import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { Account, Address, Contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { assembleTransaction } from "@stellar/stellar-sdk/rpc";

// ── Mock RPC layer — same pattern as stellar.test.ts ─────────────────────────
//
// Contract itself is NOT mocked: it's the real @stellar/stellar-sdk class, so
// `contract.call(method, ...args)` produces real xdr.ScVal-bearing operations
// we can inspect via a spy, giving us confidence the correct method name and
// argument encoding are actually being sent.
vi.mock("@stellar/stellar-sdk/rpc", () => {
  return {
    Server: class {
      getEvents = vi.fn();
      simulateTransaction = vi.fn();
      getAccount = vi.fn().mockResolvedValue({ id: "mock-account" });
      getHealth = vi.fn().mockResolvedValue({});
      getTransaction = vi.fn();
    },
    assembleTransaction: vi.fn(),
  };
});

// `stellar.ts` reads `import.meta.env.VITE_CONTRACT_ID` exactly once, at
// module-load time, into the exported `CONTRACT_ID` constant — and
// `new Contract(CONTRACT_ID)` throws on an empty/invalid contract id. So we
// must set a syntactically valid contract id *before* "../stellar" is first
// evaluated. Static imports are hoisted above this statement, so we cannot
// `import` the module normally here — we import it dynamically in
// `beforeAll` below, after this assignment has already run.
//
// These are simply valid-format strkey addresses/contract id (correct
// length + checksum) — not real deployed/funded accounts. They were
// generated once via StrKey.encodeContract/encodeEd25519PublicKey and
// hardcoded here (rather than calling those at module-eval time) to avoid
// depending on Node's `Buffer` global inside browser-targeted source.
const MOCK_CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
import.meta.env.VITE_CONTRACT_ID = MOCK_CONTRACT_ID;

const ADMIN = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA";
const USER_A = "GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC";
const USER_B = "GACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAJJHP";
const MERCHANT_A = "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N";
const MERCHANT_B = "GADAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDANWXK";

function addressVal(addr: string) {
  return nativeToScVal(Address.fromString(addr), { type: "address" });
}

function addressVecVal(addrs: string[]) {
  return nativeToScVal(
    addrs.map((a) => Address.fromString(a)),
    { type: "vec" }
  );
}

let stellar: typeof import("../stellar");

beforeAll(async () => {
  stellar = await import("../stellar");
});

let callSpy: MockInstance<
  Parameters<typeof Contract.prototype.call>,
  ReturnType<typeof Contract.prototype.call>
>;

beforeAll(() => {
  callSpy = vi.spyOn(Contract.prototype, "call");
});

const getAccountMock = () => stellar.server.getAccount as ReturnType<typeof vi.fn>;
const getHealthMock = () => stellar.server.getHealth as ReturnType<typeof vi.fn>;
const simulateTransactionMock = () =>
  stellar.server.simulateTransaction as ReturnType<typeof vi.fn>;
const assembleTransactionMock = vi.mocked(assembleTransaction);

beforeEach(() => {
  vi.clearAllMocks();
  // TransactionBuilder.build() needs a real Account-shaped object (it calls
  // `.sequenceNumber()` etc.) — a plain `{ id: ... }` stub isn't enough once
  // we actually exercise the tx-building path, unlike the read-only tests in
  // stellar.test.ts which never reach TransactionBuilder.build().
  getAccountMock().mockResolvedValue(new Account(ADMIN, "0"));
  getHealthMock().mockResolvedValue({});
  assembleTransactionMock.mockReturnValue({ toXDR: () => "signed-xdr-stub" } as any);
});

// ── buildRepairSubscriptionTx ─────────────────────────────────────────────────

describe("buildRepairSubscriptionTx", () => {
  it("calls repair_subscription with the target user's address, built from the admin account", async () => {
    simulateTransactionMock().mockResolvedValue({ result: {} });

    const result = await stellar.buildRepairSubscriptionTx(ADMIN, USER_A);

    expect(result).toBe("signed-xdr-stub");
    expect(getAccountMock()).toHaveBeenCalledWith(ADMIN);
    expect(callSpy).toHaveBeenCalledTimes(1);

    const [method, arg0] = callSpy.mock.calls[0];
    expect(method).toBe("repair_subscription");
    expect((arg0 as any).toXDR("base64")).toBe(addressVal(USER_A).toXDR("base64"));
  });

  it("rejects when simulation returns an error, rather than swallowing it", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "repair_subscription: not admin" });

    await expect(stellar.buildRepairSubscriptionTx(ADMIN, USER_A)).rejects.toThrow(
      "repair_subscription: not admin"
    );
  });
});

// ── buildBatchPauseSubscriptionsTx ────────────────────────────────────────────

describe("buildBatchPauseSubscriptionsTx", () => {
  it("calls batch_pause_subscriptions with an empty vec for an empty user list", async () => {
    simulateTransactionMock().mockResolvedValue({ result: {} });

    await stellar.buildBatchPauseSubscriptionsTx(ADMIN, []);

    const [method, arg0] = callSpy.mock.calls[0];
    expect(method).toBe("batch_pause_subscriptions");
    expect((arg0 as any).toXDR("base64")).toBe(addressVecVal([]).toXDR("base64"));
  });

  it("calls batch_pause_subscriptions with a vec of every user address, built from the admin account", async () => {
    simulateTransactionMock().mockResolvedValue({ result: {} });

    const result = await stellar.buildBatchPauseSubscriptionsTx(ADMIN, [USER_A, USER_B]);

    expect(result).toBe("signed-xdr-stub");
    expect(getAccountMock()).toHaveBeenCalledWith(ADMIN);

    const [method, arg0] = callSpy.mock.calls[0];
    expect(method).toBe("batch_pause_subscriptions");
    expect((arg0 as any).toXDR("base64")).toBe(addressVecVal([USER_A, USER_B]).toXDR("base64"));
  });

  it("rejects when simulation returns an error", async () => {
    simulateTransactionMock().mockResolvedValue({
      error: "batch_pause_subscriptions: limit exceeded",
    });

    await expect(stellar.buildBatchPauseSubscriptionsTx(ADMIN, [USER_A, USER_B])).rejects.toThrow(
      "batch_pause_subscriptions: limit exceeded"
    );
  });
});

// ── buildWhitelistBatchAddTx ──────────────────────────────────────────────────

describe("buildWhitelistBatchAddTx", () => {
  it("calls whitelist_batch_add with a vec of merchant addresses, built from the admin account", async () => {
    simulateTransactionMock().mockResolvedValue({ result: {} });

    const result = await stellar.buildWhitelistBatchAddTx(ADMIN, [MERCHANT_A, MERCHANT_B]);

    expect(result).toBe("signed-xdr-stub");
    expect(getAccountMock()).toHaveBeenCalledWith(ADMIN);

    const [method, arg0] = callSpy.mock.calls[0];
    expect(method).toBe("whitelist_batch_add");
    expect((arg0 as any).toXDR("base64")).toBe(
      addressVecVal([MERCHANT_A, MERCHANT_B]).toXDR("base64")
    );
  });

  it("rejects when simulation returns an error", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "whitelist_batch_add: not admin" });

    await expect(stellar.buildWhitelistBatchAddTx(ADMIN, [MERCHANT_A])).rejects.toThrow(
      "whitelist_batch_add: not admin"
    );
  });
});

// ── buildWhitelistBatchRemoveTx ───────────────────────────────────────────────

describe("buildWhitelistBatchRemoveTx", () => {
  it("calls whitelist_batch_remove with a vec of merchant addresses, built from the admin account", async () => {
    simulateTransactionMock().mockResolvedValue({ result: {} });

    const result = await stellar.buildWhitelistBatchRemoveTx(ADMIN, [MERCHANT_A, MERCHANT_B]);

    expect(result).toBe("signed-xdr-stub");
    expect(getAccountMock()).toHaveBeenCalledWith(ADMIN);

    const [method, arg0] = callSpy.mock.calls[0];
    expect(method).toBe("whitelist_batch_remove");
    expect((arg0 as any).toXDR("base64")).toBe(
      addressVecVal([MERCHANT_A, MERCHANT_B]).toXDR("base64")
    );
  });

  it("rejects when simulation returns an error", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "whitelist_batch_remove: not admin" });

    await expect(stellar.buildWhitelistBatchRemoveTx(ADMIN, [MERCHANT_A])).rejects.toThrow(
      "whitelist_batch_remove: not admin"
    );
  });
});

// ── buildExtendSubscriptionTtlTx ──────────────────────────────────────────────

describe("buildExtendSubscriptionTtlTx", () => {
  it("calls extend_subscription_ttl with the subscriber address, buildable by any caller", async () => {
    simulateTransactionMock().mockResolvedValue({ result: {} });

    const result = await stellar.buildExtendSubscriptionTtlTx(USER_A, USER_B);

    expect(result).toBe("signed-xdr-stub");
    // Anyone can build this tx — the *caller* funds it, not necessarily the subscriber.
    expect(getAccountMock()).toHaveBeenCalledWith(USER_A);

    const [method, arg0] = callSpy.mock.calls[0];
    expect(method).toBe("extend_subscription_ttl");
    expect((arg0 as any).toXDR("base64")).toBe(addressVal(USER_B).toXDR("base64"));
  });

  it("rejects when simulation returns an error", async () => {
    simulateTransactionMock().mockResolvedValue({
      error: "extend_subscription_ttl: entry not archived",
    });

    await expect(stellar.buildExtendSubscriptionTtlTx(USER_A, USER_B)).rejects.toThrow(
      "extend_subscription_ttl: entry not archived"
    );
  });
});

// ── estimateExtendTtlFee ──────────────────────────────────────────────────────

describe("estimateExtendTtlFee", () => {
  it("returns the min resource fee as a bigint on a successful simulation", async () => {
    simulateTransactionMock().mockResolvedValue({ minResourceFee: "123456" });

    const fee = await stellar.estimateExtendTtlFee(USER_A, USER_B);

    expect(fee).toBe(123456n);
    // Estimation only simulates — it must not sign/assemble a transaction.
    expect(assembleTransactionMock).not.toHaveBeenCalled();
  });

  it("returns null when the simulation resolves with an error shape", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "simulation failed" });

    expect(await stellar.estimateExtendTtlFee(USER_A, USER_B)).toBeNull();
  });

  it("returns null when minResourceFee is absent from an otherwise-successful simulation", async () => {
    simulateTransactionMock().mockResolvedValue({});

    expect(await stellar.estimateExtendTtlFee(USER_A, USER_B)).toBeNull();
  });

  it("returns null when the RPC call rejects outright (e.g. getAccount failure)", async () => {
    getAccountMock().mockRejectedValueOnce(new Error("network unreachable"));

    expect(await stellar.estimateExtendTtlFee(USER_A, USER_B)).toBeNull();
  });
});

// ── getContractHealth ─────────────────────────────────────────────────────────

describe("getContractHealth", () => {
  it("reports a reachable, unpaused, configured contract on success", async () => {
    simulateTransactionMock()
      .mockResolvedValueOnce({ result: { retval: nativeToScVal(false, { type: "bool" } as any) } }) // is_contract_paused
      .mockResolvedValueOnce({ result: { retval: nativeToScVal(7, { type: "u64" } as any) } }); // get_active_count

    const report = await stellar.getContractHealth(ADMIN);

    expect(report.rpcReachable).toBe(true);
    expect(report.contractPaused).toBe(false);
    expect(report.tokenConfigured).toBe(true);
    expect(report.activeSubscriptions).toBe(7);
    expect(report.checkedAt).toBeInstanceOf(Date);
  });

  it("degrades to an unreachable report — without attempting any contract simulation — when getHealth fails", async () => {
    getHealthMock().mockRejectedValue(new Error("rpc down"));

    const report = await stellar.getContractHealth(ADMIN);

    expect(report).toMatchObject({
      rpcReachable: false,
      contractPaused: false,
      tokenConfigured: false,
      activeSubscriptions: 0,
      subscriptionTtlLedgers: null,
    });
    expect(report.checkedAt).toBeInstanceOf(Date);
    expect(simulateTransactionMock()).not.toHaveBeenCalled();
  });

  it("leaves contractPaused/tokenConfigured at their safe defaults when the individual sim calls fail", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "sim failed" });

    const report = await stellar.getContractHealth(ADMIN);

    expect(report.rpcReachable).toBe(true);
    expect(report.contractPaused).toBe(false);
    expect(report.tokenConfigured).toBe(false);
    expect(report.activeSubscriptions).toBe(0);
  });
});

// ── getContractAdmin ──────────────────────────────────────────────────────────
//
// getContractAdmin/validateSubscription go through `simulateContractRead`,
// which races the simulation against a 30s `setTimeout`. We use fake timers
// so that timer never actually fires (and never lingers as a real handle).

describe("getContractAdmin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("decodes and returns the admin address on success", async () => {
    simulateTransactionMock().mockResolvedValue({
      result: { retval: addressVal(ADMIN) },
    });

    expect(await stellar.getContractAdmin(USER_A)).toBe(ADMIN);
  });

  it("returns null when the contract reports no admin configured (void)", async () => {
    simulateTransactionMock().mockResolvedValue({
      result: { retval: nativeToScVal(undefined, { type: "void" }) },
    });

    expect(await stellar.getContractAdmin(USER_A)).toBeNull();
  });

  it("returns null when the RPC/simulation fails", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "get_admin: boom" });

    expect(await stellar.getContractAdmin(USER_A)).toBeNull();
  });
});

// ── getContractPaused ─────────────────────────────────────────────────────────
//
// NOTE (pre-existing bug found while writing these tests, NOT fixed here —
// this PR is tests-only): `getContractPaused` builds its read-only simulation
// from a hardcoded "well-known zero" source account,
// "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN". That string
// fails `StrKey.isValidEd25519PublicKey` (confirmed directly against the
// installed @stellar/stellar-sdk), so `new Account(...)` throws synchronously
// on every single call, before `server.simulateTransaction` is ever reached.
// The function's own try/catch swallows that throw and returns null — so in
// its CURRENT shipped state, getContractPaused() always resolves to null,
// regardless of what the RPC would have reported. That happens to match the
// "safe" side of its documented contract (null means "unknown, don't block
// UI" per useContractPaused.ts), so nothing is unsafe today, but the
// true/false branches are dead code. We pin down the actual observed
// behavior below rather than asserting a true/false outcome the function
// cannot currently produce.
describe("getContractPaused", () => {
  it("always resolves to null today because its hardcoded source account fails checksum validation before any RPC call is made", async () => {
    simulateTransactionMock().mockResolvedValue({
      result: { retval: nativeToScVal(true, { type: "bool" }) },
    });

    expect(await stellar.getContractPaused()).toBeNull();
    expect(simulateTransactionMock()).not.toHaveBeenCalled();
  });

  it("returns null when simulation resolves with an error shape (also swallowed by the same catch)", async () => {
    simulateTransactionMock().mockResolvedValue({ error: "rpc unavailable" });

    expect(await stellar.getContractPaused()).toBeNull();
  });

  it("returns null when the RPC call throws outright", async () => {
    simulateTransactionMock().mockRejectedValue(new Error("network down"));

    expect(await stellar.getContractPaused()).toBeNull();
  });
});

// ── validateSubscription ──────────────────────────────────────────────────────

describe("validateSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses a violation report out of the contract's map return value", async () => {
    // The contract's Soroban struct returns a map keyed by *symbols* (field
    // names), not strings — `nativeToScVal({...})` on a plain JS object
    // produces scvString keys instead, which parseValidationReport's
    // `entry.key().sym()` can't read. Build the map by hand with symbol keys
    // so this matches what a real contract response looks like.
    const mapEntry = (key: string, val: xdr.ScVal) =>
      new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val });

    const reportVal = xdr.ScVal.scvMap([
      mapEntry("is_valid", nativeToScVal(false, { type: "bool" })),
      mapEntry("violations", nativeToScVal(["ttl_expired"], { type: "string" })),
      mapEntry("missing_records", nativeToScVal([], { type: "string" })),
      mapEntry("invalid_state_transitions", nativeToScVal([], { type: "string" })),
      mapEntry("corrupted_references", nativeToScVal([], { type: "string" })),
    ]);
    simulateTransactionMock().mockResolvedValue({ result: { retval: reportVal } });

    const report = await stellar.validateSubscription(ADMIN, USER_A);

    expect(report.isValid).toBe(false);
    expect(report.violations).toEqual(["ttl_expired"]);
    expect(report.missingRecords).toEqual([]);
    expect(report.invalidStateTransitions).toEqual([]);
    expect(report.corruptedReferences).toEqual([]);
  });

  it("rejects when the simulation returns an error, rather than returning a fabricated report", async () => {
    simulateTransactionMock().mockResolvedValue({
      error: "validate_subscription: no subscription",
    });

    await expect(stellar.validateSubscription(ADMIN, USER_A)).rejects.toThrow(
      "validate_subscription: no subscription"
    );
  });
});
