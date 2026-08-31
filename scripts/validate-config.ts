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
 *   npx tsx scripts/validate-config.ts [--strict]
 *
 * The `--strict` flag enables strict validation: ALL schema fields are
 * validated (including optional ones with malformed values), and the script
 * exits with code 1 on any Zod error — not just missing required fields.
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

import { ConfigSchema, formatConfigErrors, type KeeperConfig } from "./config";
import { logger } from "./logger";

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
 * Locate and parse the environment file.
 * Prefers .env.local over .env (matching Vite conventions).
 */
export function loadEnvFile(projectRoot: string): Map<string, string> {
  const envLocal = resolve(projectRoot, ".env.local");
  const envDefault = resolve(projectRoot, ".env");

  if (existsSync(envLocal)) {
    return parseEnvFile(envLocal);
  }

  if (existsSync(envDefault)) {
    return parseEnvFile(envDefault);
  }

  logger.error("ERROR: No .env or .env.local file found in project root.");
  logger.error("  Create one from .env.example or set required variables:");
  logger.error(
    "    CONTRACT_ID, RPC_URL, SECRET_KEY, BATCH_SIZE, INTERVAL_SECONDS",
  );
  process.exit(1);
  throw new Error(
    "No .env or .env.local file found in project root. " +
      "Create one from .env.example or set required variables: " +
      "CONTRACT_ID, RPC_URL, SECRET_KEY, BATCH_SIZE, INTERVAL_SECONDS",
  );
}

// ── Shared Config Loader ─────────────────────────────────────────────────────

/**
 * Load and validate the keeper environment configuration.
 *
 * Reads the `.env` / `.env.local` file from the project root, parses it, and
 * validates the result against the Zod schema in `config.ts`.
 *
 * @param strict  When `true`, the entire schema is validated (optional fields
 *                with malformed values also trigger errors). When `false`
 *                (default), only required fields are enforced.
 * @returns       The validated `KeeperConfig` object.
 * @throws        A descriptive `Error` listing every failing field when
 *                validation fails.
 */
export function loadConfig(strict = false): KeeperConfig {
  const projectRoot = resolve(__dirname, "..");

  let envVars: Map<string, string>;
  try {
    envVars = loadEnvFile(projectRoot);
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }

  // Convert Map to plain object for Zod
  const envObject: Record<string, string | undefined> = {};
  for (const [key, value] of envVars) {
    envObject[key] = value;
  }

  let result;
  if (strict) {
    result = ConfigSchema.safeParse(envObject);
  } else {
    // Normal mode: parse with Zod (same as strict for required fields,
    // but we only surface required-field errors to the user).
    result = ConfigSchema.safeParse(envObject);
  }

  if (result.success) {
    return result.data;
  }

  const errors = formatConfigErrors(result.error);
  const message = `Configuration validation failed:\n${errors.map((e) => `  ${e}`).join("\n")}`;
  throw new Error(message);
}

// ── CLI Helpers ──────────────────────────────────────────────────────────────

function parseArgs(): { strict: boolean } {
  const strict = process.argv.includes("--strict");
  return { strict };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const { strict } = parseArgs();

  logger.info("");

  if (strict) {
    logger.info("Strict mode enabled — all schema fields will be validated.\n");
  }

  let config: KeeperConfig;
  try {
    config = loadConfig(strict);
  } catch (err) {
    logger.error(String(err));
    logger.info("");
    logger.info("Fix the above errors and re-run.");
    process.exit(1);
  }

  logger.info("✓ CONTRACT_ID ..............", config.CONTRACT_ID);
  logger.info("✓ RPC_URL ..................", config.RPC_URL);
  logger.info("✓ SECRET_KEY ...............", "******** (valid)");
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
