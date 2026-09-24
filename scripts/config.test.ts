/**
 * config.test.ts — Validates ConfigSchema against scripts/.env.example.
 *
 * Ensures the documented example env stays in sync with the Zod schema:
 * every required key from the example maps to a schema field (allowing the
 * KEEPER_SECRET / SECRET_KEY alias), and example tuning values coerce
 * correctly.
 *
 * Run: `npx vitest run config.test.ts` or `npm test` (via __tests__ mirror).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigSchema } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseEnvExample(): Map<string, string> {
  const raw = readFileSync(resolve(__dirname, ".env.example"), "utf-8");
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

// Valid-format placeholders (base32 A-Z2-7, correct lengths/prefixes).
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
      // Alias is unified: both keys resolve to the same secret.
      expect(result.data.SECRET_KEY).toBe(VALID_SECRET);
      expect(result.data.KEEPER_SECRET).toBe(VALID_SECRET);
      expect(result.data.BATCH_SIZE).toBe(
        Number(example.get("BATCH_SIZE") ?? "50"),
      );
      expect(result.data.INTERVAL_SECONDS).toBe(
        Number(example.get("INTERVAL_SECONDS") ?? "3600"),
      );
    }
  });

  it("accepts the legacy SECRET_KEY alias", () => {
    const result = ConfigSchema.safeParse({
      CONTRACT_ID: VALID_CONTRACT_ID,
      RPC_URL: "https://soroban-testnet.stellar.org",
      SECRET_KEY: VALID_SECRET,
      BATCH_SIZE: "50",
      INTERVAL_SECONDS: "3600",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing secret and mismatched aliases", () => {
    const missing = ConfigSchema.safeParse({
      CONTRACT_ID: VALID_CONTRACT_ID,
      RPC_URL: "https://soroban-testnet.stellar.org",
      BATCH_SIZE: "50",
      INTERVAL_SECONDS: "3600",
    });
    expect(missing.success).toBe(false);

    const mismatch = ConfigSchema.safeParse({
      CONTRACT_ID: VALID_CONTRACT_ID,
      RPC_URL: "https://soroban-testnet.stellar.org",
      SECRET_KEY: VALID_SECRET,
      KEEPER_SECRET: `S${"B".repeat(55)}`,
      BATCH_SIZE: "50",
      INTERVAL_SECONDS: "3600",
    });
    expect(mismatch.success).toBe(false);
  });
});
