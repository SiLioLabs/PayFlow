/**
 * validate-config.ts — Environment configuration validator for FlowPay.
 *
 * Reads .env or .env.local and validates that all required variables are present
 * and correctly formatted. Useful for CI pipelines and local developer workflows.
 *
 * Usage:
 *   npx ts-node scripts/validate-config.ts
 *
 * Checks:
 *   - Required variables exist and are non-empty
 *   - Contract IDs start with 'C' and are 56 characters long
 *   - RPC URLs are valid URLs with a protocol
 *
 * Exit codes:
 *   0 — all validations passed
 *   1 — one or more validations failed
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface ValidationResult {
  variable: string;
  passed: boolean;
  reason?: string;
}

type Validator = (value: string) => { valid: boolean; reason?: string };

// ── .env Parsing ─────────────────────────────────────────────────────────────

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
 * Locate and parse the environment file.
 * Prefers .env.local over .env (matching Vite conventions).
 */
function loadEnv(projectRoot: string): Map<string, string> {
  const envLocal = resolve(projectRoot, ".env.local");
  const envDefault = resolve(projectRoot, ".env");

  if (existsSync(envLocal)) {
    console.log(`Reading configuration from: .env.local`);
    return parseEnvFile(envLocal);
  }

  if (existsSync(envDefault)) {
    console.log(`Reading configuration from: .env`);
    return parseEnvFile(envDefault);
  }

  console.error("ERROR: No .env or .env.local file found in project root.");
  console.error("  Create one from .env.example:");
  console.error("    cp frontend/.env.example .env.local");
  process.exit(1);
}

// ── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validate that a value is a Stellar contract ID.
 * Contract IDs begin with 'C' and are exactly 56 characters (base32-encoded).
 */
function validateContractId(value: string): { valid: boolean; reason?: string } {
  if (!value.startsWith("C")) {
    return { valid: false, reason: "must start with 'C'" };
  }
  if (value.length !== 56) {
    return { valid: false, reason: `must be 56 characters (got ${value.length})` };
  }
  // Stellar contract IDs use uppercase base32 (A-Z, 2-7)
  if (!/^[A-Z2-7]+$/.test(value)) {
    return { valid: false, reason: "contains invalid characters (expected base32: A-Z, 2-7)" };
  }
  return { valid: true };
}

/**
 * Validate that a value is a valid URL with a protocol.
 */
function validateUrl(value: string): { valid: boolean; reason?: string } {
  try {
    const url = new URL(value);
    if (!url.protocol || !["http:", "https:"].includes(url.protocol)) {
      return { valid: false, reason: "must use http:// or https:// protocol" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "not a valid URL" };
  }
}

/**
 * Validate presence only (non-empty).
 */
function validatePresence(value: string): { valid: boolean; reason?: string } {
  if (!value.trim()) {
    return { valid: false, reason: "must not be empty" };
  }
  return { valid: true };
}

// ── Required Variables ───────────────────────────────────────────────────────

/**
 * Configuration of required variables and their validation rules.
 * Uses repository conventions from frontend/.env.example.
 */
const REQUIRED_VARIABLES: Array<{ name: string; validators: Validator[] }> = [
  {
    name: "VITE_CONTRACT_ID",
    validators: [validatePresence, validateContractId],
  },
  {
    name: "VITE_RPC_URL",
    validators: [validatePresence, validateUrl],
  },
];

// ── Validation Runner ────────────────────────────────────────────────────────

function validateVariable(
  name: string,
  envVars: Map<string, string>,
  validators: Validator[]
): ValidationResult {
  const value = envVars.get(name);

  // Check presence
  if (value === undefined) {
    return { variable: name, passed: false, reason: "missing" };
  }

  if (!value.trim()) {
    return { variable: name, passed: false, reason: "empty" };
  }

  // Run all validators
  for (const validator of validators) {
    const result = validator(value);
    if (!result.valid) {
      return { variable: name, passed: false, reason: result.reason };
    }
  }

  return { variable: name, passed: true };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const projectRoot = resolve(__dirname, "..");
  const envVars = loadEnv(projectRoot);

  console.log("");

  const results: ValidationResult[] = [];

  for (const { name, validators } of REQUIRED_VARIABLES) {
    const result = validateVariable(name, envVars, validators);
    results.push(result);
  }

  // Display results
  let hasFailures = false;

  for (const result of results) {
    if (result.passed) {
      console.log(`\u2713 ${result.variable}`);
    } else {
      console.log(`\u2717 ${result.variable} — ${result.reason}`);
      hasFailures = true;
    }
  }

  console.log("");

  if (hasFailures) {
    const failCount = results.filter((r) => !r.passed).length;
    console.log(`Validation failed: ${failCount} issue(s) found.`);
    process.exit(1);
  }

  console.log(`All ${results.length} checks passed.`);
  process.exit(0);
}

main();
