import { Networks } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiEndpointServer } from "../rpc-client.js";

const TESTNET_PASSPHRASE = Networks.TESTNET;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RPC_URLS;
  delete process.env.RPC_URL;
  delete process.env.NETWORK_PASSPHRASE;
});

describe("MultiEndpointServer RPC failover", () => {
  it("serves requests from a single configured endpoint", async () => {
    vi.spyOn(Server.prototype, "getNetwork").mockResolvedValue({
      passphrase: TESTNET_PASSPHRASE,
    } as never);
    vi.spyOn(Server.prototype, "getHealth").mockResolvedValue({
      status: "healthy",
    } as never);

    const server = new MultiEndpointServer("https://rpc.example.invalid");
    await expect(server.getHealth()).resolves.toMatchObject({
      status: "healthy",
    });
  });

  it("demotes an unreachable endpoint and fails over to a healthy one", async () => {
    const getNetwork = vi
      .spyOn(Server.prototype, "getNetwork")
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValue({ passphrase: TESTNET_PASSPHRASE } as never);
    vi.spyOn(Server.prototype, "getHealth").mockResolvedValue({
      status: "healthy",
    } as never);

    const server = new MultiEndpointServer([
      "https://unreachable.example.invalid",
      "https://rpc.example.invalid",
    ]);

    await expect(server.getHealth()).resolves.toMatchObject({
      status: "healthy",
    });
    expect(getNetwork).toHaveBeenCalledTimes(2);
  });

  it("rejects when every endpoint reports the wrong network passphrase", async () => {
    process.env.NETWORK_PASSPHRASE = "Expected Network ; January 2020";
    vi.spyOn(Server.prototype, "getNetwork").mockResolvedValue({
      passphrase: TESTNET_PASSPHRASE,
    } as never);
    vi.spyOn(Server.prototype, "getHealth").mockRejectedValue(
      new Error("endpoint demoted"),
    );

    const server = new MultiEndpointServer([
      "https://rpc-a.example.invalid",
      "https://rpc-b.example.invalid",
    ]);

    await expect(server.getHealth()).rejects.toThrow("endpoint demoted");
  });
});
