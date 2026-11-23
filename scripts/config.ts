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
 * config.ts — Zod schema definitions for FlowPay keeper environment variables.
 *
 * Provides type-safe, composable validation for all configuration needed by
 * the keeper and operational scripts.  Use `ConfigSchema.safeParse(env)` to
 * validate a set of environment variables and receive structured, human-
 * readable error messages.
 *
 * ## Canonical Environment Variables
 *
 * | Variable          | Type            | Constraints                                    |
 * |-------------------|-----------------|------------------------------------------------|
 * | CONTRACT_ID       | string          | Non-empty; starts with 'C'; 56-char base32     |
 * | RPC_URL           | string          | Valid http/https URL                           |
 * | SECRET_KEY        | string          | Stellar secret key: starts with 'S', 56 chars  |
 * | BATCH_SIZE        | number (coerce) | Integer 1–200                                  |
 * | INTERVAL_SECONDS  | number (coerce) | Integer ≥ 60                                   |
 * | WEBHOOK_URL       | string?         | Optional valid http/https URL                  |
 * | NETWORK_PASSPHRASE| string?         | Optional network passphrase (testnet default)  |
 *
 * ## Deprecated Aliases (with fallback + warning)
 *
 * - `KEEPER_SECRET` → `SECRET_KEY` (emits deprecation warning)
 * - `NETWORK_PASSTHRASE` → `NETWORK_PASSPHRASE` (emits deprecation warning)
 *
 * ## Usage
 *
 * ```ts
 * import { loadConfig } from "./config";
 *
 * const config = loadConfig();
 * // config.SECRET_KEY is populated from either SECRET_KEY or KEEPER_SECRET (with warning)
 * // Warnings logged if deprecated aliases were used.
 * ```
 */

import { Keypair } from "@stellar/stellar-sdk";
import { z } from "zod";

// ── Environment Variable Normalization ───────────────────────────────────────
//
// Handles deprecated alias names for backwards compatibility. Logs warnings
// when old names are used.

const DEPRECATION_WARNINGS: string[] = [];

export function getDeprecationWarnings(): string[] {
  return DEPRECATION_WARNINGS;
}

export function clearDeprecationWarnings(): void {
  DEPRECATION_WARNINGS.length = 0;
}

export function logDeprecationWarnings(): void {
  if (DEPRECATION_WARNINGS.length > 0) {
    console.warn("\n⚠ Deprecated environment variables detected:\n");
    for (const warning of DEPRECATION_WARNINGS) {
      console.warn(`  ${warning}`);
    }
    console.warn(
      "\n  Please update your .env file to use the canonical names above.\n",
    );
  }
}

/**
 * Normalize env object by resolving deprecated aliases.
 * If both canonical and alias are set, canonical takes precedence.
 * Logs a warning if alias is used.
 */
export function normalizeEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...env };

  // KEEPER_SECRET → SECRET_KEY
  if (
    !normalized.SECRET_KEY &&
    env.KEEPER_SECRET
  ) {
    normalized.SECRET_KEY = env.KEEPER_SECRET;
    DEPRECATION_WARNINGS.push(
      "KEEPER_SECRET is deprecated — use SECRET_KEY instead",
    );
  }

  // NETWORK_PASSTHRASE (typo) → NETWORK_PASSPHRASE (correct)
  if (
    !normalized.NETWORK_PASSPHRASE &&
    env.NETWORK_PASSTHRASE
  ) {
    normalized.NETWORK_PASSPHRASE = env.NETWORK_PASSTHRASE;
    DEPRECATION_WARNINGS.push(
      "NETWORK_PASSTHRASE is deprecated (typo) — use NETWORK_PASSPHRASE instead",
    );
  }

  return normalized;
}

// ── Primitive validators ─────────────────────────────────────────────────────

/**
 * Stellar contract IDs: uppercase base32 (A-Z, 2-7), 56 characters, starting
 * with 'C'.
 */
const contractIdRegex = /^C[A-Z2-7]{55}$/;

/**
 * Stellar secret keys: uppercase base32 (A-Z, 2-7), 56 characters, starting
 * with 'S'.
 */
const secretKeyRegex = /^S[A-Z2-7]{55}$/;

// ── Config schema ────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  /** Stellar Soroban contract ID (e.g. CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) */
  CONTRACT_ID: z
    .string({ required_error: "CONTRACT_ID is required" })
    .min(1, "CONTRACT_ID must not be empty")
    .regex(
      contractIdRegex,
      "CONTRACT_ID must be a valid Stellar contract ID (starts with 'C', 56-char base32)",
    ),

  /** Soroban RPC endpoint (e.g. https://soroban-testnet.stellar.org) */
  RPC_URL: z
    .string({ required_error: "RPC_URL is required" })
    .url("RPC_URL must be a valid URL with http:// or https:// protocol"),

  /** Stellar secret key for the keeper (starts with 'S', 56-char base32) */
  SECRET_KEY: z
    .string({ required_error: "SECRET_KEY is required" })
    .min(1, "SECRET_KEY must not be empty")
    .regex(
      secretKeyRegex,
      "SECRET_KEY must be a valid Stellar secret key (starts with 'S', 56-char base32)",
    ),

  /**
   * Maximum number of subscriptions to charge in a single transaction (1–200).
   * The upper bound of 200 mirrors the contract's `MAX_BATCH_SIZE_CEILING` —
   * the hard cap no admin-configured on-chain batch limit can exceed. This
   * schema only validates the env var's shape; `keeper.ts` additionally
   * clamps the effective value at startup to whatever `get_max_batch_size()`
   * reports on-chain right now (which defaults to 50 and may be lower than
   * this 200 ceiling), so a value that passes this schema can still be
   * narrowed further before it's used.
   */
  BATCH_SIZE: z
    .coerce
    .number({ invalid_type_error: "BATCH_SIZE must be a number" })
    .int("BATCH_SIZE must be an integer")
    .min(1, "BATCH_SIZE must be at least 1")
    .max(200, "BATCH_SIZE must be at most 200"),

  /** Minimum interval in seconds between keeper charge cycles (≥ 60) */
  INTERVAL_SECONDS: z.coerce
    .number({ invalid_type_error: "INTERVAL_SECONDS must be a number" })
    .int("INTERVAL_SECONDS must be an integer")
    .min(60, "INTERVAL_SECONDS must be at least 60 (1 minute)"),

  /** Optional webhook URL for alert notifications (e.g. failed charge alerts) */
  WEBHOOK_URL: z
    .string()
    .url("WEBHOOK_URL must be a valid URL with http:// or https:// protocol")
    .optional(),

  /** Secret used to generate HMAC-SHA256 signature for webhooks */
  WEBHOOK_SECRET: z
    .string()
    .min(1, "WEBHOOK_SECRET must not be empty if provided")
    .optional(),

  /** Optional file path for the Dead Letter Queue for failed webhooks */
  WEBHOOK_DLQ_FILE: z
    .string()
    .optional(),

  /** Optional network passphrase for Stellar network identification */
  NETWORK_PASSPHRASE: z.string().optional(),
});

/** Inferred TypeScript type from ConfigSchema */
export type KeeperConfig = z.infer<typeof ConfigSchema>;

// ── Manifest schema ──────────────────────────────────────────────────────────

export const ManifestSchema = z.object({
  contractId: z
    .string({ required_error: "contractId is required in manifest" })
    .regex(contractIdRegex, "contractId must be a valid Stellar contract ID"),

  tokenAddress: z
    .string({ required_error: "tokenAddress is required in manifest" })
    .min(1, "tokenAddress must not be empty"),

  adminAddress: z
    .string({ required_error: "adminAddress is required in manifest" })
    .min(1, "adminAddress must not be empty"),

  network: z
    .string({ required_error: "network is required in manifest" })
    .min(1, "network must not be empty"),

  rpcUrl: z
    .string({ required_error: "rpcUrl is required in manifest" })
    .url("rpcUrl must be a valid URL"),

  networkPassphrase: z
    .string({ required_error: "networkPassphrase is required in manifest" })
    .min(1, "networkPassphrase must not be empty"),
});

export type ValidatedManifest = z.infer<typeof ManifestSchema>;

// ── Validation helpers ───────────────────────────────────────────────────────

/**
 * Format Zod validation errors into human-readable lines using Zod's built-in
 * `error.format()`. Returns one line per failing field, with all issues for
 * that field joined together.
 *
 * Example output:
 * ```
 * [
 *   "✗ CONTRACT_ID: Required",
 *   "✗ BATCH_SIZE: Expected number, received nan",
 *   "✗ RPC_URL: Invalid url"
 * ]
 * ```
 */
export function formatConfigErrors(error: z.ZodError): string[] {
  const formatted = error.format();
  const lines: string[] = [];

  for (const [field, issues] of Object.entries(formatted)) {
    // Skip the root-level _errors array
    if (field === "_errors") continue;

    const fieldErrors = (issues as unknown as { _errors: string[] })._errors;
    if (fieldErrors && fieldErrors.length > 0) {
      lines.push(`✗ ${field}: ${fieldErrors.join("; ")}`);
    }
  }

  return lines;
}

// ── Mainnet safety gate & secret redaction ──────────────────────────────────

/** Stellar public (mainnet) network passphrase. */
export const PUBLIC_NETWORK_PASSPHRASE =
  "Public Global Stellar Network ; September 2015";

/**
 * Mainnet safety gate. Returns an actionable error message when the public
 * (mainnet) network passphrase is selected without the operator explicitly
 * setting `ALLOW_MAINNET=true`; returns `null` when it is safe to proceed.
 *
 * Ported from the retired root `keeper-config.ts` so the canonical keeper
 * keeps its mainnet safeguard.
 */
export function mainnetGateError(
  networkPassphrase: string | undefined,
  allowMainnet: boolean,
): string | null {
  if (networkPassphrase === PUBLIC_NETWORK_PASSPHRASE && !allowMainnet) {
    return "Mainnet network passphrase detected. Set ALLOW_MAINNET=true to confirm you want to use Mainnet.";
  }
  return null;
}

/**
 * Redact a Stellar secret key for display or logging: keeps the leading `S`
 * and the final 4 characters, masking everything in between. Text that is not
 * a secret key passes through unchanged.
 *
 * Ported from the retired root `keeper-config.ts` (`redactSecret`), so
 * configuration summaries can never leak a full secret. The pattern uses the
 * exact base32 alphabet `[A-Z2-7]` (corrected upstream in #1293): characters
 * 0, 1, 8, 9 never appear in real Stellar keys, and the case-insensitive flag
 * is omitted so lowercase lookalikes are not falsely redacted.
 */
export function redactSecret(value: string): string {
  return value.replace(/S[A-Z2-7]{55}/g, (match) => {
    return "S" + "*".repeat(8) + match.slice(-4);
  });
}

/**
 * Verify that `KEEPER_PUBLIC_KEY` is the public key derived from the signing
 * secret. Returns an actionable error message when they disagree, or `null`
 * when they match (or when either value is absent, or the secret is
 * malformed — those cases are reported by `ConfigSchema` instead).
 *
 * Ported from the retired root `keeper-config.ts` so a misconfigured signer is
 * caught at startup instead of at transaction signing time.
 */
export function publicKeyMismatchError(
  secret: string | undefined,
  publicKey: string | undefined,
): string | null {
  if (!secret || !publicKey) return null;
  try {
    if (Keypair.fromSecret(secret).publicKey() !== publicKey) {
      return "KEEPER_PUBLIC_KEY does not match SECRET_KEY (or KEEPER_SECRET)";
    }
  } catch {
    // Shape-valid but unparsable secrets are reported by ConfigSchema's
    // secret-key pattern check; nothing to add here.
  }
  return null;
}
