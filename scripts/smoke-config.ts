/**
 * smoke-config.ts — Smoke test for configuration loading against .env.example.
 *
 * Loads and validates configuration from .env.example to ensure the scripts'
 * config system is properly initialized. Useful for CI pipelines to verify
 * that environment setup is ready.
 *
 * Usage:
 *   npx tsx scripts/smoke-config.ts
 *
 * Exit codes:
 *   0 — config loaded and validated successfully
 *   1 — config validation failed
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { ConfigSchema, formatConfigErrors } from "./config.js";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse a .env file into a key-value map.
 * Handles comments, empty lines, and quoted values.
 */
function parseEnvFile(filePath: string): Map<string, string> {
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
 * Main entry point.
 * Loads .env.example and validates it using ConfigSchema.
 */
function main(): void {
  const projectRoot = __dirname;
  const envExamplePath = resolve(projectRoot, ".env.example");

  logger.info("");

  if (!existsSync(envExamplePath)) {
    logger.error(`ERROR: .env.example not found at ${envExamplePath}`);
    process.exit(1);
  }

  logger.info(`Reading configuration from: .env.example`);
  const envVars = parseEnvFile(envExamplePath);

  // Convert Map to plain object for Zod
  const envObject: Record<string, string | undefined> = {};
  for (const [key, value] of envVars) {
    envObject[key] = value;
  }

  logger.info("");

  const result = ConfigSchema.safeParse(envObject);

  if (result.success) {
    logger.info("✓ Configuration schema validation passed.");
    logger.info("");
    logger.info("Configuration values:");
    logger.info("  CONTRACT_ID .........", result.data.CONTRACT_ID);
    logger.info("  RPC_URL .............", result.data.RPC_URL);
    logger.info("  SECRET_KEY ..........", "********** (present)");
    logger.info("  BATCH_SIZE ..........", result.data.BATCH_SIZE);
    logger.info("  INTERVAL_SECONDS ....", result.data.INTERVAL_SECONDS);

    if (result.data.WEBHOOK_URL) {
      logger.info("  WEBHOOK_URL .........", result.data.WEBHOOK_URL);
    }
    if (result.data.NETWORK_PASSPHRASE) {
      logger.info("  NETWORK_PASSPHRASE ..", result.data.NETWORK_PASSPHRASE);
    }

    logger.info("");
    logger.info("✓ Smoke test passed. Configuration is ready.\n");
    process.exit(0);
  }

  // Validation failed
  const errors = formatConfigErrors(result.error);

  logger.info("✗ Configuration validation failed:\n");
  for (const msg of errors) {
    logger.info(`  ${msg}`);
  }

  logger.info("");
  logger.info(`${errors.length} validation issue(s) found.`);
  logger.info("Fix the configuration and re-run.\n");
  process.exit(1);
}

main();
