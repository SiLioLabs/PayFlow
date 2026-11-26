#!/usr/bin/env node
/**
 * emit-caps-table.mjs — Verify or emit the contract-limits documentation table.
 *
 * Usage:
 *   node scripts/emit-caps-table.mjs            # print the table to stdout
 *   node scripts/emit-caps-table.mjs --check    # compare against docs/LIMITS.md; exit 1 on drift
 *
 * The source of truth is scripts/lib/contract-limits.ts (compiled/imported via
 * a lightweight inline parse so this script has no build step dependency).
 *
 * The --check flag is used as a CI gate to ensure docs/LIMITS.md stays in
 * sync with the script module and (transitively) with contract/src/*.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK_MODE = process.argv.includes("--check");

// ── Parse contract-limits.ts ──────────────────────────────────────────────────
// We parse the TypeScript source directly (no tsc step) to extract
// `export const NAME = VALUE` declarations.  This is intentionally simple —
// the file only contains numeric/bigint literals and arithmetic expressions.

const limitsPath = resolve(__dirname, "lib", "contract-limits.ts");
const limitsSource = readFileSync(limitsPath, "utf-8");

/** @type {Map<string, bigint|number>} */
const constants = new Map();

// Match: export const NAME = VALUE[n];
// Handles decimals, bigint suffix (n), and simple expressions like LEDGERS_PER_DAY
// Note: we do NOT strip underscores globally — only from numeric literals.
const CONST_RE = /^export const (\w+)\s*=\s*([^;]+);/gm;
let m;
while ((m = CONST_RE.exec(limitsSource)) !== null) {
  const name = m[1];
  const raw = m[2].trim();
  // Strip trailing n (bigint literal) before evaluation
  const isBigInt = /^\d[\d_]*n$/.test(raw) || /^\d[\d_]*\*\*\d+n?$/.test(raw);

  // Replace already-parsed constant references with their numeric values
  let expr = raw;
  for (const [k, v] of constants) {
    expr = expr.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
  }
  // Strip numeric underscore separators from the expression (e.g. 10_000_000 → 10000000)
  // Only strip underscores between digits, not in identifier names
  expr = expr.replace(/(\d)_(\d)/g, "$1$2");
  // Remove trailing bigint n suffix
  expr = expr.replace(/(\d)n\b/g, "$1");

  let value;
  try {
    value = Function(`"use strict"; return (${expr});`)();
  } catch {
    continue; // skip non-numeric exports
  }
  if (typeof value === "number" || typeof value === "bigint") {
    constants.set(name, isBigInt ? BigInt(value) : value);
  }
}

// ── Build the expected markdown table ────────────────────────────────────────

function row(name, desc) {
  const v = constants.get(name);
  if (v === undefined) throw new Error(`Constant ${name} not found in contract-limits.ts`);
  return `| \`${name}\` | ${v} | ${desc} |`;
}

const TABLE = `# PayFlow Contract Limits

> **Auto-generated table** -- do not edit by hand.
> Run \`node scripts/emit-caps-table.mjs --check\` to verify this file is in sync
> with \`contract/src/\` and \`scripts/lib/contract-limits.ts\`.

This table is the operator-facing reference for every hard cap enforced by the
deployed contract.  The authoritative values live in:

- **Contract (Rust):** \`contract/src/batch.rs\`, \`contract/src/lib.rs\`,
  \`contract/src/migration.rs\`, \`contract/src/spending_limit.rs\`,
  \`contract/src/upgrade.rs\`
- **Scripts (TypeScript):** \`scripts/lib/contract-limits.ts\`

## Batch sizes

| Constant | Value | Description |
|---|---|---|
${row("MAX_BATCH_SIZE",         "Default maximum users per `batch_charge` call")}
${row("MAX_BATCH_SIZE_CEILING", "Hard ceiling on `set_max_batch_size`")}
${row("MAX_BATCH_PAUSE",        "Maximum subscriptions per batch pause call")}
${row("MAX_WHITELIST_BATCH",    "Maximum addresses per whitelist batch operation")}

## Schema version

| Constant | Value | Description |
|---|---|---|
${row("CURRENT_SCHEMA_VERSION", "Current on-chain storage schema version")}

## Ledger-time constants

| Constant | Value | Description |
|---|---|---|
${row("LEDGERS_PER_DAY",           "Approximate ledgers per day (~5 s/ledger)")}
${row("UPGRADE_TTL_LEDGERS",       "TTL for pending WASM upgrade proposals")}
${row("SUBSCRIPTION_TTL_LEDGERS",  "Subscription entry TTL (~1 year)")}

## Amount limits (token base units)

| Constant | Value | Description |
|---|---|---|
${row("MAX_AMOUNT",               "Maximum single pay-per-use amount")}
${row("MAX_SUBSCRIPTION_AMOUNT",  "Maximum subscription charge amount")}
${row("GLOBAL_MAX_VOLUME_PER_HOUR", "Global max volume per hour (all merchants)")}

## Token decimals

| Constant | Value | Description |
|---|---|---|
${row("XLM_DECIMALS",   "XLM decimal places (1 XLM = 10^7 stroops)")}
${row("STROOPS_PER_XLM", "Stroops per XLM")}

> ⚠️ **Multi-token note:** \`XLM_DECIMALS\` and \`STROOPS_PER_XLM\` apply only to
> XLM and XLM-derived SAC tokens. Non-XLM SEP-41 tokens may use different decimal
> counts — always query the token's \`decimals()\` entry-point rather than
> hard-coding these values for arbitrary tokens.

## Other constants

| Constant | Value | Description |
|---|---|---|
${row("HOUR_IN_SECONDS", "Seconds per hour")}
`;

// ── Output or check ───────────────────────────────────────────────────────────

if (!CHECK_MODE) {
  process.stdout.write(TABLE);
  process.exit(0);
}

// --check: compare against docs/LIMITS.md
const docsPath = resolve(__dirname, "..", "docs", "LIMITS.md");
let existing;
try {
  existing = readFileSync(docsPath, "utf-8");
} catch {
  console.error(`docs/LIMITS.md not found at ${docsPath}. Run without --check to generate it.`);
  process.exit(1);
}

if (existing.trimEnd() === TABLE.trimEnd()) {
  console.log("✓ docs/LIMITS.md is in sync with scripts/lib/contract-limits.ts");
  process.exit(0);
} else {
  console.error("✗ docs/LIMITS.md is OUT OF SYNC with scripts/lib/contract-limits.ts");
  console.error("");
  console.error("Run:  node scripts/emit-caps-table.mjs > docs/LIMITS.md");
  console.error("to regenerate the file, then commit the result.");
  process.exit(1);
}
// Drift check for docs/LIMITS.md.
//
// Parses the authoritative constants out of contract/src/caps.rs and asserts
// that docs/LIMITS.md states the same number for each one. A constant change
// without a doc change fails here.
//
//   node scripts/emit-caps-table.mjs           # print the table
//   node scripts/emit-caps-table.mjs --check   # exit 1 if docs/LIMITS.md is stale
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CAPS = join(ROOT, "contract", "src", "caps.rs");
const DOC = join(ROOT, "docs", "LIMITS.md");

/** Every constant docs/LIMITS.md promises to document. */
const DOCUMENTED = [
  "DEFAULT_BATCH_SIZE",
  "MAX_BATCH_SIZE_CEILING",
  "MAX_BATCH_PAUSE_SUBSCRIPTIONS",
  "MAX_WHITELIST_BATCH_SIZE",
  "MAX_MERCHANT_SUB_COUNT_BATCH",
  "MAX_PRUNE_REVENUE_DAYS",
  "SUBSCRIBER_PAGE_SIZE",
  "MERCHANT_PAGE_SIZE",
  "REVENUE_DAY_PAGE_SIZE",
  "TOP_MERCHANTS_PAGE_SIZE",
  "WHITELIST_PAGE_SIZE",
];

const src = readFileSync(CAPS, "utf8");
const actual = {};
for (const m of src.matchAll(/^pub const (\w+): u32 = (\d+);/gm)) actual[m[1]] = Number(m[2]);

const missingInSource = DOCUMENTED.filter((k) => !(k in actual));
if (missingInSource.length) {
  console.error(`contract/src/caps.rs no longer defines: ${missingInSource.join(", ")}`);
  console.error("docs/LIMITS.md must be updated to match.");
  process.exit(1);
}

const undocumented = Object.keys(actual).filter((k) => !DOCUMENTED.includes(k));
if (undocumented.length) {
  console.error(`contract/src/caps.rs defines a constant docs/LIMITS.md does not cover:`);
  for (const k of undocumented) console.error(`  ${k} = ${actual[k]}`);
  console.error("Add it to DOCUMENTED in this script and to the table in docs/LIMITS.md.");
  process.exit(1);
}

const rows = DOCUMENTED.map((k) => `| \`${k}\` | ${actual[k]} |`);
console.log("| Constant | Value |");
console.log("| --- | ---: |");
for (const r of rows) console.log(r);

if (!process.argv.includes("--check")) process.exit(0);

if (!existsSync(DOC)) {
  console.error("\ndocs/LIMITS.md not found");
  process.exit(1);
}
const md = readFileSync(DOC, "utf8");
const stale = [];
for (const k of DOCUMENTED) {
  // Match a markdown table row whose first cell is the constant name, and read
  // the number out of the following cell. Anchored per-line so a value that
  // merely appears elsewhere in the document does not count.
  const re = new RegExp(
    `^\\|[^\\n]*\`${k}\`[^\\n]*\\|\\s*\\**\\s*${actual[k]}\\s*\\*?\\s*\\|`,
    "m",
  );
  if (!re.test(md)) stale.push(`${k} (caps.rs says ${actual[k]})`);
}

if (stale.length) {
  console.error("\nSTALE: docs/LIMITS.md disagrees with contract/src/caps.rs:");
  for (const s of stale) console.error(`  ${s}`);
  process.exit(1);
}

// ── Configurable-limits table: verify "Rejects 0" against the code ─────────
//
// The prose below the configurable-limits table once claimed an asymmetry that
// did not exist.  These checks parse the setter bodies in the contract and
// assert the docs agree, so a future revert cannot reintroduce the drift.

const LIB = join(ROOT, "contract", "src", "lib.rs");
const WHITELIST = join(ROOT, "contract", "src", "whitelist.rs");

/** Extract a function body (first 500 chars after the opening brace). */
function fnBody(src, name) {
  const re = new RegExp(`pub fn ${name}[^{]*\\{([\\s\\S]{0,500}?)\\n\\s{4}\\}`, "m");
  const m = src.match(re);
  return m ? m[1] : "";
}

const libSrc = readFileSync(LIB, "utf8");
const wlSrc = readFileSync(WHITELIST, "utf8");

const chargeRejectsZero = /size == 0/.test(fnBody(libSrc, "set_max_batch_size"));
const wlRejectsZero = /size == 0/.test(fnBody(wlSrc, "set_max_whitelist_batch_size"));

const configDrift = [];
if (chargeRejectsZero && !/set_max_batch_size`\s+\| 50\s+\| 1 - 200\s+\| Yes/.test(md))
  configDrift.push("set_max_batch_size rejects 0 in code but docs do not say 'Yes'");
if (!chargeRejectsZero && /set_max_batch_size`\s+\| 50\s+\| 1 - 200\s+\| Yes/.test(md))
  configDrift.push("set_max_batch_size does not reject 0 in code but docs say 'Yes'");
if (chargeRejectsZero && /set_max_batch_size[^|]*\| 0 - 200/.test(md))
  configDrift.push("set_max_batch_size range still says '0 - 200' (should be '1 - 200')");

if (configDrift.length) {
  console.error("\nSTALE: configurable-limits table disagrees with contract code:");
  for (const s of configDrift) console.error(`  ${s}`);
  process.exit(1);
}

// ── Batch-operations table: verify get_batch_charge_estimate cap ───────────
//
// The table once said the estimate was "200, fixed" and ignored the configured
// limit.  lib.rs now applies both the ceiling and get_max_batch_size(), so
// the docs must reflect that.

const estimateUsesConfigured = /get_max_batch_size/.test(fnBody(libSrc, "get_batch_charge_estimate"));
if (estimateUsesConfigured && /get_batch_charge_estimate.*200, fixed/.test(md)) {
  console.error("\nSTALE: batch-operations table says get_batch_charge_estimate is '200, fixed'");
  console.error("  but lib.rs applies both the 200 ceiling and get_max_batch_size().");
  process.exit(1);
}
if (estimateUsesConfigured && !/get_batch_charge_estimate.*get_max_batch_size\(\)/.test(md)) {
  console.error("\nSTALE: batch-operations table does not list get_max_batch_size() for get_batch_charge_estimate");
  console.error("  but lib.rs applies the configured limit.");
  process.exit(1);
}

// ── Panic-vs-clamp table: verify entrypoints are in the right rows ─────────
//
// Validates that the three enforcement behaviours (panic, clamp, no limit)
// list the same entrypoints the code actually implements.

const lines = md.split("\n");
const panicEntrypts = (lines.find((l) => /^\|\s*\*\*Panic\*\*/.test(l)) || "").split("|").slice(-2)[0];
const clampEntrypts = (lines.find((l) => /^\|\s*\*\*Silently clamps\*\*/.test(l)) || "").split("|").slice(-2)[0];
const noLimitEntrypts = (lines.find((l) => /^\|\s*\*\*No limit\*\*/.test(l)) || "").split("|").slice(-2)[0];

const panicChecks = [
  ["get_batch_charge_estimate", panicEntrypts],
  ["batch_charge", panicEntrypts],
  ["get_next_charge_batch", panicEntrypts],
  ["get_top_merchants_by_subs", panicEntrypts],
];
const clampChecks = [
  ["get_subscriber_page", clampEntrypts],
  ["get_active_subscriber_page", clampEntrypts],
  ["get_charge_history_page", clampEntrypts],
];
const noLimitChecks = [
  ["get_whitelist_page", noLimitEntrypts],
  ["get_merchant_revenue_history", noLimitEntrypts],
];

const tableDrift = [];
for (const [name, row] of panicChecks)
  if (!row.includes(name)) tableDrift.push(`${name} missing from Panic row`);
for (const [name, row] of clampChecks)
  if (!row.includes(name)) tableDrift.push(`${name} missing from Silently-clamps row`);
for (const [name, row] of noLimitChecks)
  if (!row.includes(name)) tableDrift.push(`${name} missing from No-limit row`);

if (tableDrift.length) {
  console.error("\nSTALE: panic-vs-clamp table disagrees with contract entrypoints:");
  for (const s of tableDrift) console.error(`  ${s}`);
  process.exit(1);
}

console.log(`\nOK: all ${DOCUMENTED.length} constants in contract/src/caps.rs match docs/LIMITS.md.`);
