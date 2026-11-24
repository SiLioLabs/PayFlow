#!/usr/bin/env node
/**
 * check-error-codes.mjs
 *
 * CI guard: verifies that docs/ERROR-CODES.md lists every numeric error code
 * defined in contract/src/errors.rs and that no code appears more than once
 * in the quick-reference table.
 *
 * Usage:
 *   node scripts/check-error-codes.mjs
 *
 * Exit codes:
 *   0 — all codes accounted for and table is consistent
 *   1 — one or more codes are missing, duplicated, or the files cannot be read
 *
 * Add to CI:
 *   - run: node scripts/check-error-codes.mjs
 *     working-directory: .
 *
 * It also fails when:
 *   - the numeric sequence in errors.rs has an undeclared gap (every code from
 *     1 to the highest one must be declared; reserved slots use a deprecated
 *     `ReservedN` variant), and
 *   - a #[deprecated] variant is referenced as `ContractError::Name` in
 *     contract sources outside errors.rs and test-only files, i.e. could be
 *     emitted (see the deprecation schedule in docs/ERROR-CODES.md).
 */

import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── 1. Parse errors.rs ──────────────────────────────────────────────────────

const errorsRsPath = join(ROOT, 'contract', 'src', 'errors.rs');
let errorsRs;
try {
  errorsRs = readFileSync(errorsRsPath, 'utf8');
} catch (e) {
  console.error(`[check-error-codes] Cannot read ${errorsRsPath}: ${e.message}`);
  process.exit(1);
}

/**
 * Extract all `VariantName = <number>` assignments from the ContractError enum.
 * Returns a Map<number, string> of code → variant name.
 */
function parseErrorsRs(src) {
  const codes = new Map();
  // Match lines like:  SomeName = 42,
  const variantRe = /^\s+(\w+)\s*=\s*(\d+)\s*,/gm;
  let m;
  while ((m = variantRe.exec(src)) !== null) {
    const name = m[1];
    const code = parseInt(m[2], 10);
    if (codes.has(code)) {
      console.error(
        `[check-error-codes] DUPLICATE in errors.rs: code ${code} assigned to both '${codes.get(code)}' and '${name}'`
      );
      process.exit(1);
    }
    codes.set(code, name);
  }
  return codes;
}

const rustCodes = parseErrorsRs(errorsRs);
if (rustCodes.size === 0) {
  console.error('[check-error-codes] No error codes found in errors.rs — check the file path or format.');
  process.exit(1);
}

// ── 2. Parse docs/ERROR-CODES.md quick-reference table ─────────────────────

const docPath = join(ROOT, 'docs', 'ERROR-CODES.md');
let docSrc;
try {
  docSrc = readFileSync(docPath, 'utf8');
} catch (e) {
  console.error(`[check-error-codes] Cannot read ${docPath}: ${e.message}`);
  process.exit(1);
}

/**
 * Parse the quick-reference table.
 * Matches lines like: | 42   | `SchemaMigrationRequired`   | ...
 * or gap lines like:  | 37   | *(unassigned)*              | ...
 * or reserved lines:  | 31   | *(reserved)*                | ...
 * Returns a Map<number, string> of code → name/description in table.
 *
 * Only scans the "Quick-Reference Table" section (between the section
 * heading and the first `---` separator after it) to avoid false matches
 * from other tables in the document (e.g. the frontend error map table).
 */
function parseDocTable(src) {
  const codes = new Map();

  // Extract just the quick-reference table section
  const sectionStart = src.indexOf('## Quick-Reference Table');
  if (sectionStart === -1) {
    console.error('[check-error-codes] Could not find "## Quick-Reference Table" heading in ERROR-CODES.md');
    process.exit(1);
  }
  // Find the next top-level section (##) after the table
  const sectionEnd = src.indexOf('\n## ', sectionStart + 10);
  const tableSection = sectionEnd === -1 ? src.slice(sectionStart) : src.slice(sectionStart, sectionEnd);

  // Match table rows whose first column is a number
  const rowRe = /^\|\s*(\d+)\s*\|([^|]+)\|/gm;
  let m;
  while ((m = rowRe.exec(tableSection)) !== null) {
    const code = parseInt(m[1], 10);
    const label = m[2].trim();
    if (codes.has(code)) {
      console.error(
        `[check-error-codes] DUPLICATE in ERROR-CODES.md table: code ${code} appears more than once`
      );
      process.exit(1);
    }
    codes.set(code, label);
  }
  return codes;
}

const docCodes = parseDocTable(docSrc);
if (docCodes.size === 0) {
  console.error('[check-error-codes] No table rows found in ERROR-CODES.md — check format.');
  process.exit(1);
}

// ── 3. Check that API.md does not re-introduce an error-codes table ─────────

const apiMdPath = join(ROOT, 'docs', 'API.md');
let apiMdSrc;
try {
  apiMdSrc = readFileSync(apiMdPath, 'utf8');
} catch (e) {
  console.error(`[check-error-codes] Cannot read ${apiMdPath}: ${e.message}`);
  process.exit(1);
}

// Check for error-code table pattern in API.md (table with error codes in first column)
// We look for markdown table rows that start with a numeric code in the first column
// and contain typical error-related keywords in adjacent columns
const errorTablePattern = /^\|\s*(\d+)\s*\|\s*`?\w+`?\s*\|/gm;
const potentialErrorTableRows = [];
let match;
while ((match = errorTablePattern.exec(apiMdSrc)) !== null) {
  potentialErrorTableRows.push(match[0]);
}

// If we find multiple rows (suggesting a table), check if they're in an error codes section
if (potentialErrorTableRows.length > 3) {
  // Look for "## Error Codes" heading followed by table content
  const errorCodesSectionPattern = /##\s+Error\s+Codes[\s\S]{0,500}^\|\s*\d+\s*\|/mi;
  if (errorCodesSectionPattern.test(apiMdSrc)) {
    console.error('\n[check-error-codes] FAIL — API.md contains an "## Error Codes" section with a table.');
    console.error('  The error codes table must only exist in ERROR-CODES.md (single source of truth).');
    console.error('  Replace the table in API.md with a link to ERROR-CODES.md instead.\n');
    process.exit(1);
  }
}

// ── 4. Compute the expected set of documented codes ─────────────────────────
//
// The full set to document = all codes in errors.rs PLUS any intentional gap
// codes that appear in the quick-reference table (e.g. 31, 37).
//
// A "gap" is a code that is in the doc table but NOT in errors.rs — that is
// fine as long as the table entry is clearly labelled as reserved/unassigned.
// A code that is in errors.rs but NOT in the doc table is always a failure.

const missingFromDoc = [];
for (const [code, name] of rustCodes.entries()) {
  if (!docCodes.has(code)) {
    missingFromDoc.push({ code, name });
  }
}

// ── 5. Check detailed recovery section coverage ─────────────────────────────
//
// Every code in errors.rs should also have a "### <code> —" heading in the
// recovery section. Gap codes (31, 37, …) only need the quick-reference row.

const detailHeadingRe = /^###\s+(\d+)\s+[—–-]/gm;
const detailCodes = new Set();
let dm;
while ((dm = detailHeadingRe.exec(docSrc)) !== null) {
  detailCodes.add(parseInt(dm[1], 10));
}

// Deprecated / reserved variants that intentionally have minimal or no
// detailed recovery section (they're gaps or never-emitted aliases).
const SKIP_DETAIL_CHECK = new Set([31]); // code 31 is "Reserved31" in errors.rs

const missingDetail = [];
for (const [code, name] of rustCodes.entries()) {
  if (!detailCodes.has(code) && !SKIP_DETAIL_CHECK.has(code)) {
    missingDetail.push({ code, name });
  }
}

// ── 5b. No undeclared numeric gaps (#1410) ──────────────────────────────────
//
// Every code from 1 to the highest code must be declared in errors.rs. A
// reserved slot is declared with a deprecated `ReservedN` variant, so an
// unexplained hole (which a future variant could silently reuse) fails here.

const maxCode = Math.max(...rustCodes.keys());
const undeclaredGaps = [];
for (let code = 1; code <= maxCode; code++) {
  if (!rustCodes.has(code)) undeclaredGaps.push(code);
}

// ── 5c. Deprecated variants must never be emitted (#1411) ───────────────────
//
// Variants marked #[deprecated] in errors.rs are kept only for wire
// compatibility. Referencing one as `ContractError::Name` anywhere else in
// the contract sources (outside errors.rs and test-only files) means the
// contract could emit it, which the deprecation schedule forbids.

function parseDeprecatedVariants(src) {
  const names = [];
  const re = /#\[deprecated[^\]]*\]\s*(?:\/\/[^\n]*\s*|#\[[^\]]*\]\s*)*(\w+)\s*=\s*\d+/g;
  let d;
  while ((d = re.exec(src)) !== null) names.push(d[1]);
  return names;
}

const deprecatedVariants = parseDeprecatedVariants(errorsRs);
const contractSrcDir = join(ROOT, 'contract', 'src');
const TEST_ONLY_FILE = /^(test[\w-]*|bench)\.rs$/;
const deprecatedEmissions = [];
for (const file of readdirSync(contractSrcDir)) {
  if (!file.endsWith('.rs') || file === 'errors.rs' || TEST_ONLY_FILE.test(file)) continue;
  const lines = readFileSync(join(contractSrcDir, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const name of deprecatedVariants) {
      if (new RegExp(`ContractError::${name}\\b`).test(code)) {
        deprecatedEmissions.push({ file, line: i + 1, name });
      }
    }
  });
}

// ── 6. Report ────────────────────────────────────────────────────────────────

let failures = 0;

if (undeclaredGaps.length > 0) {
  failures++;
  console.error('\n[check-error-codes] FAIL — undeclared gaps in the errors.rs numeric sequence:');
  for (const code of undeclaredGaps) console.error(`  code ${code}`);
  console.error('\n  Use the next free code for new errors, or reserve the slot with a deprecated `ReservedN` variant and document it.\n');
}

if (deprecatedEmissions.length > 0) {
  failures++;
  console.error('\n[check-error-codes] FAIL — deprecated error variants referenced in contract code (they must never be emitted):');
  for (const { file, line, name } of deprecatedEmissions) {
    console.error(`  contract/src/${file}:${line}: ContractError::${name}`);
  }
  console.error('\n  Emit the canonical replacement instead (e.g. ContractPaused, code 18). See docs/ERROR-CODES.md#deprecation-schedule.\n');
}

if (missingFromDoc.length > 0) {
  failures++;
  console.error('\n[check-error-codes] FAIL — codes in errors.rs but missing from ERROR-CODES.md quick-reference table:');
  for (const { code, name } of missingFromDoc.sort((a, b) => a.code - b.code)) {
    console.error(`  code ${code}: ${name}`);
  }
  console.error('\n  Add a row to the quick-reference table in docs/ERROR-CODES.md.\n');
}

if (missingDetail.length > 0) {
  failures++;
  console.error('\n[check-error-codes] FAIL — codes in errors.rs with no "### N —" recovery section in ERROR-CODES.md:');
  for (const { code, name } of missingDetail.sort((a, b) => a.code - b.code)) {
    console.error(`  code ${code}: ${name}`);
  }
  console.error('\n  Add a "### N — `VariantName`" section with recovery steps.\n');
}

if (failures === 0) {
  const rustCount = rustCodes.size;
  const docTableCount = docCodes.size;
  console.log(
    `[check-error-codes] OK — ${rustCount} codes in errors.rs, ` +
    `${docTableCount} rows in table (includes ${docTableCount - rustCount} gap/reserved entries), ` +
    `${detailCodes.size} detailed recovery sections.`
  );
  process.exit(0);
} else {
  process.exit(1);
}
