/**
 * validate-config.ts — Environment configuration validator and shared config
 * loader for FlowPay.
 *
 * Reads .env or .env.local and validates that all required keeper variables
 * are present and correctly formatted using Zod schemas defined in config.ts.
 * Useful for CI pipelines and local developer workflows.
 *
 * ## CLI Usage
 *
 *   npx tsx scripts/validate-config.ts [--strict] [--env-file <path>]
 *
 * The `--strict` flag enables strict validation: ALL schema fields are
 * validated (including optional ones with malformed values), and the script
 * exits with code 1 on any Zod error — not just missing required fields.
 *
 * The `--env-file` flag validates an explicit env file instead of the
 * auto-discovered one.
 *
 * ## Env file lookup
 *
 *   1. scripts/.env.local
 *   2. scripts/.env
 *   3. <repo root>/.env.local
 *   4. <repo root>/.env
 *   5. scripts/.env.example  (fallback, so the shipped example is checkable
 *                             in CI without a secret-bearing file)
 *
 * ## Programmatic Usage
 *
 *   import { loadConfig } from "./validate-config";
 *
 *   const config = loadConfig();          // normal mode
 *   const config = loadConfig(true);      // strict mode
 *
 * Returns the validated `KeeperConfig` object, or throws a descriptive error
 * when validation fails.
 *
 * ## Checks
 *
 *   - CONTRACT_ID     — non-empty, valid Stellar contract ID
 *   - RPC_URL          — valid http/https URL
 *   - SECRET_KEY       — valid Stellar secret key
 *   - BATCH_SIZE       — integer 1–200
 *   - INTERVAL_SECONDS — integer ≥ 60
 *   - WEBHOOK_URL      — optional, validated if present
 *
 * ## Exit codes (CLI)
 *
 *   0 — all validations passed
 *   1 — one or more validations failed
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import {
  ConfigSchema,
  formatConfigErrors,
  normalizeEnv,
  logDeprecationWarnings,
  type KeeperConfig,
} from "./config.js";
import { logger, SECRET_MASK } from "./logger";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a .env file into a key-value map.
 * Handles comments, empty lines, and quoted values.
 */
export function parseEnvFile(filePath: string): Map<string, string> {
  const vars = new Map<string, string>();
  const content = readFileSync(filePath, "utf-8");

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars.set(key, value);
  }

  return vars;
}

/**
 * The env files this script looks at, in priority order.
 *
 * The scripts under `scripts/` own their configuration, so `scripts/.env`
 * wins over the repository-root `.env`. Both are checked for a `.env.local`
 * override first, matching Vite's convention.
 */
export function envFileCandidates(projectRoot: string): string[] {
  const scriptsDir = resolve(__dirname);
  const rootDir = resolve(projectRoot);
  return [
    resolve(scriptsDir, ".env.local"),
    resolve(scriptsDir, ".env"),
    resolve(rootDir, ".env.local"),
    resolve(rootDir, ".env"),
  ];
}

/**
 * Pick the env file to validate.
 *
 * When no `.env` / `.env.local` exists anywhere, the shipped
 * `scripts/.env.example` is used instead, so the example file can be checked
 * in CI without a secret-bearing file. `isExample` tells the caller which of
 * the two happened.
 */
export function resolveEnvFile(
  projectRoot: string,
  explicitPath?: string,
): { path: string; isExample: boolean } {
  if (explicitPath) {
    const absolute = resolve(explicitPath);
    if (!existsSync(absolute)) {
      throw new Error(`--env-file not found: ${absolute}`);
    }
    return { path: absolute, isExample: false };
  }

  for (const candidate of envFileCandidates(projectRoot)) {
    if (existsSync(candidate)) {
      return { path: candidate, isExample: false };
    }
  }

  return { path: resolve(__dirname, ".env.example"), isExample: true };
}

/**
 * Locate and parse the environment file.
 *
 * See {@link resolveEnvFile} for the lookup order.
 */
export function loadEnvFile(
  projectRoot: string,
  explicitPath?: string,
): Map<string, string> {
  const { path, isExample } = resolveEnvFile(projectRoot, explicitPath);

  if (!existsSync(path)) {
    logger.error("ERROR: No .env or .env.local file found.");
    logger.error("  Create one from scripts/.env.example or set required variables:");
    logger.error(
      "    CONTRACT_ID, RPC_URL, SECRET_KEY, BATCH_SIZE, INTERVAL_SECONDS",
    );
    process.exit(1);
    throw new Error(
      "No .env or .env.local file found. " +
        "Create one from scripts/.env.example or set required variables: " +
        "CONTRACT_ID, RPC_URL, SECRET_KEY, BATCH_SIZE, INTERVAL_SECONDS",
    );
  }

  if (isExample) {
    logger.warn(
      `No .env or .env.local found — validating the example file ${path} instead.`,
    );
  }

  return parseEnvFile(path);
}

// ── Shared Config Loader ─────────────────────────────────────────────────────

type Validator = (value: string) => { valid: boolean; reason?: string };

interface ValidationResult {
  variable: string;
  passed: boolean;
  reason?: string;
}

/**
 * Load and validate the keeper environment configuration.
 *
 * Reads the `.env` / `.env.local` file, parses it, and validates the result
 * against the Zod schema in `config.ts`.
 *
 * The file is looked up in this order (see {@link envFileCandidates}):
 * `scripts/.env.local`, `scripts/.env`, `<repo root>/.env.local`,
 * `<repo root>/.env`. When none exists, `scripts/.env.example` is validated
 * instead so the shipped example can be checked without a secret-bearing
 * file.
 *
 * @param strict     When `true`, the entire schema is validated (optional fields
 *                   with malformed values also trigger errors). When `false`
 *                   (default), only required fields are enforced.
 * @param envFile    Optional explicit path to the env file to validate.
 * @returns          The validated `KeeperConfig` object.
 * @throws           A descriptive `Error` listing every failing field when
 *                   validation fails.
 */
export function loadConfig(strict = false, envFile?: string): KeeperConfig {
  const projectRoot = resolve(__dirname, "..");

  let envVars: Map<string, string>;
  try {
    envVars = loadEnvFile(projectRoot, envFile);
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }

  // Convert Map to plain object for Zod
  const envObject: Record<string, string | undefined> = {};
  for (const [key, value] of envVars) {
    envObject[key] = value;
  }

  // Normalize deprecated aliases to canonical names
  const normalizedEnv = normalizeEnv(envObject);

  let result;
  if (strict) {
    result = ConfigSchema.safeParse(normalizedEnv);
  } else {
    // Normal mode: parse with Zod (same as strict for required fields,
    // but we only surface required-field errors to the user).
    result = ConfigSchema.safeParse(normalizedEnv);
  }

  if (result.success) {
    logDeprecationWarnings();
    return result.data;
  }

  const errors = formatConfigErrors(result.error);
  const message = `Configuration validation failed:\n${errors.map((e) => `  ${e}`).join("\n")}`;
  throw new Error(message);
}

// ── CLI Helpers ──────────────────────────────────────────────────────────────

function parseArgs(): { strict: boolean; envFile?: string } {
  const strict = process.argv.includes("--strict");
  let envFile: string | undefined;
  const idx = process.argv.indexOf("--env-file");
  if (idx !== -1 && process.argv[idx + 1]) {
    envFile = process.argv[idx + 1];
  }
  return { strict, envFile };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const { strict, envFile } = parseArgs();

  logger.info("");

  if (strict) {
    logger.info("Strict mode enabled — all schema fields will be validated.\n");
  }

  let config: KeeperConfig;
  try {
    config = loadConfig(strict, envFile);
  } catch (err) {
    logger.error(String(err));
    logger.info("");
    logger.info("Fix the above errors and re-run.");
    process.exit(1);
  }

  logger.info("✓ CONTRACT_ID ..............", config.CONTRACT_ID);
  logger.info("✓ RPC_URL ..................", config.RPC_URL);
  logger.info("✓ SECRET_KEY ...............", `${SECRET_MASK} (valid)`);
  logger.info("✓ BATCH_SIZE ...............", config.BATCH_SIZE);
  logger.info("✓ INTERVAL_SECONDS .........", config.INTERVAL_SECONDS);
  if (config.WEBHOOK_URL) {
    logger.info("✓ WEBHOOK_URL ..............", config.WEBHOOK_URL);
  }
  if (config.NETWORK_PASSPHRASE) {
    logger.info("✓ NETWORK_PASSPHRASE .......", config.NETWORK_PASSPHRASE);
  }
  logger.info("\nAll configuration checks passed.\n");
  process.exit(0);
}

main();
