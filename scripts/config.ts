/**
 * config.ts — Zod schema definitions for FlowPay keeper environment variables.
 *
 * Provides type-safe, composable validation for all configuration needed by
 * the keeper and operational scripts.  Use `ConfigSchema.safeParse(env)` to
 * validate a set of environment variables and receive structured, human-
 * readable error messages.
 *
 * ## Schema
 *
 * | Variable          | Type            | Constraints                                    |
 * |-------------------|-----------------|------------------------------------------------|
 * | CONTRACT_ID       | string          | Non-empty; starts with 'C'; 56-char base32     |
 * | RPC_URL           | string          | Valid http/https URL                           |
 * | SECRET_KEY        | string          | Stellar secret key: starts with 'S', 56 chars  |
 * | BATCH_SIZE        | number (coerce) | Integer 1–200                                  |
 * | INTERVAL_SECONDS  | number (coerce) | Integer ≥ 60                                   |
 * | WEBHOOK_URL       | string?         | Optional valid http/https URL                  |
 *
 * ## Usage
 *
 * ```ts
 * import { ConfigSchema } from "./config";
 *
 * const result = ConfigSchema.safeParse(process.env);
 * if (!result.success) {
 *   console.error(result.error.format());
 *   process.exit(1);
 * }
 * const config = result.data;
 * // config is fully typed with CONTRACT_ID, RPC_URL, etc.
 * ```
 */

import { z } from "zod";

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
    .regex(contractIdRegex, "CONTRACT_ID must be a valid Stellar contract ID (starts with 'C', 56-char base32)"),

  /** Soroban RPC endpoint (e.g. https://soroban-testnet.stellar.org) */
  RPC_URL: z
    .string({ required_error: "RPC_URL is required" })
    .url("RPC_URL must be a valid URL with http:// or https:// protocol"),

  /** Stellar secret key for the keeper (starts with 'S', 56-char base32) */
  SECRET_KEY: z
    .string({ required_error: "SECRET_KEY is required" })
    .min(1, "SECRET_KEY must not be empty")
    .regex(secretKeyRegex, "SECRET_KEY must be a valid Stellar secret key (starts with 'S', 56-char base32)"),

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
  INTERVAL_SECONDS: z
    .coerce
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
  NETWORK_PASSPHRASE: z
    .string()
    .optional(),
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
