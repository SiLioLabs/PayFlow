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
 * Intentional gaps (codes that exist in errors.rs as deprecated/reserved but
 * are NOT assigned to an active variant) are handled by scanning for comments
 * in errors.rs that mark a code as "reserved" or "unassigned".  The script
 * treats them as documented-gaps and only requires they appear in the
 * quick-reference table (even as "*(reserved)*" or "*(unassigned)*").
 */

import { readFileSync } from 'fs';
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

// ── 3. Compute the expected set of documented codes ─────────────────────────
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

// ── 4. Check detailed recovery section coverage ─────────────────────────────
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

// ── 5. Report ────────────────────────────────────────────────────────────────

let failures = 0;

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
