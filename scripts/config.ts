/**
 * scripts/config.ts — Keeper configuration loader
 *
 * Priority order for the signing secret:
 *   1. KEEPER_SECRET_FILE  → read from a file path (Docker secrets / tmpfs)
 *   2. KEEPER_SECRET       → environment variable (legacy; warns on mainnet)
 *   3. SECRET_KEY          → legacy fallback (warns on mainnet)
 *
 * On mainnet, using an env-variable secret prints a one-time warning because
 * env vars can leak via `/proc`, crash dumps, and compose file diffs.
 */

import { readFileSync } from "fs";
import { Networks } from "@stellar/stellar-sdk";

// ── Network ───────────────────────────────────────────────────────────────────

export const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const RPC_URL =
  process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";

export const CONTRACT_ID = process.env.CONTRACT_ID ?? "";

// ── Fees ─────────────────────────────────────────────────────────────────────

/**
 * Multiplier applied to the simulated resource fee.
 * 1.2 = 20% headroom above the network's estimate.
 */
export const FEE_MULTIPLIER = Number(process.env.FEE_MULTIPLIER ?? "1.2");

/**
 * Hard ceiling for the resource fee in stroops.
 * Transactions whose simulated fee × multiplier exceeds this are rejected
 * (never sent), protecting the keeper wallet from runaway spend.
 * Default: 10 XLM = 100_000_000 stroops.
 */
export const FEE_CEILING_STROOPS = BigInt(
  process.env.FEE_CEILING_STROOPS ?? "100000000"
);

/** Optional separate fee-bump source account public key. */
export const FEE_BUMP_SOURCE = process.env.FEE_BUMP_SOURCE ?? "";

/** Optional fee-bump source secret (supports same file/env loading). */
export const FEE_BUMP_SECRET_FILE = process.env.FEE_BUMP_SECRET_FILE ?? "";
export const FEE_BUMP_SECRET = process.env.FEE_BUMP_SECRET ?? "";

// ── Metrics ───────────────────────────────────────────────────────────────────

export const METRICS_PORT = Number(process.env.METRICS_PORT ?? "9091");

// ── Batch ─────────────────────────────────────────────────────────────────────

export const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? "50");

export const POLL_INTERVAL_MS = Number(
  process.env.POLL_INTERVAL_MS ?? "60000"
);

// ── Secret loading ────────────────────────────────────────────────────────────

function isMainnet(): boolean {
  return NETWORK_PASSPHRASE === Networks.PUBLIC;
}

/**
 * loadSecret — resolves the keeper signing secret using the priority chain:
 *   file > env var KEEPER_SECRET > env var SECRET_KEY
 *
 * Throws if no source is configured.
 * Warns when an env-variable secret is used on mainnet.
 */
export function loadSecret(): string {
  // 1. File-based secret (Docker secrets, tmpfs, Vault agent)
  const secretFile = process.env.KEEPER_SECRET_FILE ?? "";
  if (secretFile) {
    try {
      const secret = readFileSync(secretFile, "utf8").trim();
      if (secret) return secret;
      throw new Error(`Secret file "${secretFile}" is empty.`);
    } catch (err) {
      throw new Error(
        `Failed to read KEEPER_SECRET_FILE "${secretFile}": ${(err as Error).message}`
      );
    }
  }

  // 2. KEEPER_SECRET env var
  const keeperSecret = process.env.KEEPER_SECRET ?? "";
  if (keeperSecret) {
    if (isMainnet()) {
      console.warn(
        "[PayFlow Keeper] ⚠️  WARNING: Using KEEPER_SECRET env variable on mainnet. " +
          "Env variables can leak via /proc, crash dumps and compose file diffs. " +
          "Use KEEPER_SECRET_FILE pointing to a Docker secret or tmpfs mount instead."
      );
    }
    return keeperSecret;
  }

  // 3. Legacy SECRET_KEY env var
  const legacySecret = process.env.SECRET_KEY ?? "";
  if (legacySecret) {
    if (isMainnet()) {
      console.warn(
        "[PayFlow Keeper] ⚠️  WARNING: Using SECRET_KEY env variable on mainnet. " +
          "Env variables can leak via /proc, crash dumps and compose file diffs. " +
          "Use KEEPER_SECRET_FILE pointing to a Docker secret or tmpfs mount instead."
      );
    }
    return legacySecret;
  }

  throw new Error(
    "No keeper signing secret configured. " +
      "Set KEEPER_SECRET_FILE (recommended), KEEPER_SECRET, or SECRET_KEY."
  );
}

/**
 * loadFeeBumpSecret — resolves the optional fee-bump account secret.
 * Returns null when fee-bump is not configured.
 */
export function loadFeeBumpSecret(): string | null {
  if (FEE_BUMP_SECRET_FILE) {
    try {
      const secret = readFileSync(FEE_BUMP_SECRET_FILE, "utf8").trim();
      if (secret) return secret;
    } catch (err) {
      throw new Error(
        `Failed to read FEE_BUMP_SECRET_FILE "${FEE_BUMP_SECRET_FILE}": ${(err as Error).message}`
      );
    }
  }

  if (FEE_BUMP_SECRET) {
    if (isMainnet()) {
      console.warn(
        "[PayFlow Keeper] ⚠️  WARNING: Using FEE_BUMP_SECRET env variable on mainnet. " +
          "Use FEE_BUMP_SECRET_FILE instead."
      );
    }
    return FEE_BUMP_SECRET;
  }

  return null;
}

// ── ISigner interface ─────────────────────────────────────────────────────────

/**
 * ISigner — abstraction over signing back-ends.
 *
 * The default EnvSigner wraps a Stellar Keypair loaded from the secret
 * resolved above.  A KMS/HSM implementation can be injected by providing
 * a class that fulfils this interface and passing it to createKeeper().
 */
export interface ISigner {
  /** Stellar public key (G...) */
  readonly publicKey: string;
  /**
   * Sign a transaction XDR and return the signed XDR.
   * Implementations must be async so KMS round-trips fit naturally.
   */
  sign(txXdr: string, networkPassphrase: string): Promise<string>;
}
