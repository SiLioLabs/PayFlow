import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

const scriptsDir = fileURLToPath(new URL("..", import.meta.url));
const validEnv = {
  CONTRACT_ID: `C${"A".repeat(55)}`,
  RPC_URL: "https://example.com",
  KEEPER_PUBLIC_KEY: "G",
  SECRET_KEY: "",
  KEEPER_SECRET: "",
};

function runKeeper(env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "keeper.ts", "--once"],
    {
      cwd: scriptsDir,
      encoding: "utf8",
      env: { ...process.env, ...validEnv, ...env },
    },
  );
}

describe("keeper environment validation", () => {
  it("rejects an interval below 60 seconds before starting a cycle", () => {
    const result = runKeeper({ DRY_RUN: "true", INTERVAL_SECONDS: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INTERVAL_SECONDS");
    expect(result.stderr).toContain("at least 60");
  });

  it("rejects a malformed KEEPER_SECRET with an actionable message", () => {
    const result = runKeeper({
      DRY_RUN: "false",
      INTERVAL_SECONDS: "3600",
      KEEPER_SECRET: "not-a-stellar-secret",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SECRET_KEY (or KEEPER_SECRET)");
    expect(result.stderr).toContain("valid Stellar secret key");
    // Errors must never echo the secret value back to the operator.
    expect(result.stderr).not.toContain("not-a-stellar-secret");
  });

  it("requires a secret when not in dry-run mode", () => {
    const result = runKeeper({ DRY_RUN: "false", INTERVAL_SECONDS: "3600" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SECRET_KEY (or KEEPER_SECRET)");
  });

  it("blocks the mainnet passphrase unless ALLOW_MAINNET=true", () => {
    const keypair = Keypair.random();
    const result = runKeeper({
      DRY_RUN: "true",
      INTERVAL_SECONDS: "3600",
      NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
      SECRET_KEY: keypair.secret(),
      KEEPER_PUBLIC_KEY: keypair.publicKey(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ALLOW_MAINNET");
    expect(result.stderr).toContain("ALLOW_MAINNET=true");
    // The secret must never be echoed, even when startup fails.
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(keypair.secret());
  });

  it("rejects a KEEPER_PUBLIC_KEY that does not match the secret", () => {
    const signer = Keypair.random();
    const other = Keypair.random();
    const result = runKeeper({
      DRY_RUN: "true",
      INTERVAL_SECONDS: "3600",
      SECRET_KEY: signer.secret(),
      KEEPER_PUBLIC_KEY: other.publicKey(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("KEEPER_PUBLIC_KEY");
    expect(result.stderr).toContain("does not match");
  });
});