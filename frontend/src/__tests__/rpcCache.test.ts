import { beforeEach, describe, expect, it, vi } from "vitest";
import { dedupedCall, clearCache, getActiveEndpointId } from "../services/rpcCache";

const CUSTOM_RPC_KEY = "flowpay_custom_rpc_url";

function setEndpoint(url: string | null) {
  if (url === null) {
    window.localStorage.removeItem(CUSTOM_RPC_KEY);
  } else {
    window.localStorage.setItem(CUSTOM_RPC_KEY, JSON.stringify(url));
  }
}

beforeEach(() => {
  window.localStorage.clear();
  clearCache();
  vi.restoreAllMocks();
});

describe("rpcCache - endpoint scoping (#1067)", () => {
  it("produces separate cache entries for the same args on two endpoints", async () => {
    const fnA = vi.fn(async () => "response-A");
    const fnB = vi.fn(async () => "response-B");

    setEndpoint("https://rpc-a.example");
    const a1 = await dedupedCall("getThing:1", fnA);
    expect(a1).toBe("response-A");
    expect(fnA).toHaveBeenCalledTimes(1);

    setEndpoint("https://rpc-b.example");
    const b1 = await dedupedCall("getThing:1", fnB);
    expect(b1).toBe("response-B");
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("clearCache drops entries from the previous endpoint", async () => {
    const fnA = vi.fn(async () => "response-A");
    const fnB = vi.fn(async () => "response-B");

    setEndpoint("https://rpc-a.example");
    await dedupedCall("getThing:2", fnA);

    setEndpoint("https://rpc-b.example");
    clearCache();

    const b1 = await dedupedCall("getThing:2", fnB);
    expect(b1).toBe("response-B");
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("still coalesces concurrent calls within a single endpoint", async () => {
    setEndpoint("https://rpc-a.example");

    let resolveFn: (v: string) => void = () => {};
    const fn = vi.fn(
      () => new Promise<string>((res) => { resolveFn = res; })
    );

    const p1 = dedupedCall("getThing:3", fn);
    const p2 = dedupedCall("getThing:3", fn);

    expect(fn).toHaveBeenCalledTimes(1);

    resolveFn("done");
    await expect(p1).resolves.toBe("done");
    await expect(p2).resolves.toBe("done");
  });

  it("getActiveEndpointId reflects the stored custom URL", () => {
    setEndpoint(null);
    expect(getActiveEndpointId()).toBe("__default__");

    setEndpoint("https://custom.example");
    expect(getActiveEndpointId()).toBe("https://custom.example");
  });
});
