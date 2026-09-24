/**
 * Mirrors scripts/config.test.ts so `npm test` (vitest include pattern for
 * the __tests__ directory) executes the .env.example parity suite.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigSchema } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseEnvExample(): Map<string, string> {
  const raw = readFileSync(resolve(__dirname, "..", ".env.example"), "utf-8");
  const vars = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return vars;
}

const VALID_CONTRACT_ID = `C${"A".repeat(55)}`;
const VALID_SECRET = `S${"A".repeat(55)}`;

describe("config schema vs .env.example", () => {
  it("documents KEEPER_SECRET (not a stale SECRET_KEY-only example)", () => {
    const example = parseEnvExample();
    expect(example.has("KEEPER_SECRET")).toBe(true);
    expect(example.has("CONTRACT_ID")).toBe(true);
    expect(example.has("RPC_URL")).toBe(true);
    expect(example.has("BATCH_SIZE")).toBe(true);
    expect(example.has("INTERVAL_SECONDS")).toBe(true);
  });

  it("parses .env.example tuning values with valid placeholders", () => {
    const example = parseEnvExample();
    const env: Record<string, string> = {
      CONTRACT_ID: VALID_CONTRACT_ID,
      RPC_URL: example.get("RPC_URL") ?? "https://soroban-testnet.stellar.org",
      KEEPER_SECRET: VALID_SECRET,
      BATCH_SIZE: example.get("BATCH_SIZE") ?? "50",
      INTERVAL_SECONDS: example.get("INTERVAL_SECONDS") ?? "3600",
    };
    const result = ConfigSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SECRET_KEY).toBe(VALID_SECRET);
      expect(result.data.KEEPER_SECRET).toBe(VALID_SECRET);
    }
  });

  it("accepts the legacy SECRET_KEY alias and rejects drift", () => {
    const ok = ConfigSchema.safeParse({
      CONTRACT_ID: VALID_CONTRACT_ID,
      RPC_URL: "https://soroban-testnet.stellar.org",
      SECRET_KEY: VALID_SECRET,
      BATCH_SIZE: "50",
      INTERVAL_SECONDS: "3600",
    });
    expect(ok.success).toBe(true);

    const missing = ConfigSchema.safeParse({
      CONTRACT_ID: VALID_CONTRACT_ID,
      RPC_URL: "https://soroban-testnet.stellar.org",
      BATCH_SIZE: "50",
      INTERVAL_SECONDS: "3600",
    });
    expect(missing.success).toBe(false);
  });
});
