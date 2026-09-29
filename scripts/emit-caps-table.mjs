// Drift check for docs/limits.md.
//
// Parses the authoritative constants out of contract/src/caps.rs and asserts
// that docs/limits.md states the same number for each one. A constant change
// without a doc change fails here.
//
//   node scripts/emit-caps-table.mjs           # print the table
//   node scripts/emit-caps-table.mjs --check   # exit 1 if docs/limits.md is stale
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CAPS = join(ROOT, "contract", "src", "caps.rs");
const DOC = join(ROOT, "docs", "limits.md");

/** Every constant docs/limits.md promises to document. */
const DOCUMENTED = [
  "DEFAULT_BATCH_SIZE",
  "MAX_BATCH_SIZE_CEILING",
  "MAX_BATCH_PAUSE_SUBSCRIPTIONS",
  "MAX_WHITELIST_BATCH_SIZE",
  "MAX_MERCHANT_SUB_COUNT_BATCH",
  "SUBSCRIBER_PAGE_SIZE",
  "REVENUE_DAY_PAGE_SIZE",
  "TOP_MERCHANTS_PAGE_SIZE",
];

const src = readFileSync(CAPS, "utf8");
const actual = {};
for (const m of src.matchAll(/^pub const (\w+): u32 = (\d+);/gm)) actual[m[1]] = Number(m[2]);

const missingInSource = DOCUMENTED.filter((k) => !(k in actual));
if (missingInSource.length) {
  console.error(`contract/src/caps.rs no longer defines: ${missingInSource.join(", ")}`);
  console.error("docs/limits.md must be updated to match.");
  process.exit(1);
}

const undocumented = Object.keys(actual).filter((k) => !DOCUMENTED.includes(k));
if (undocumented.length) {
  console.error(`contract/src/caps.rs defines a constant docs/limits.md does not cover:`);
  for (const k of undocumented) console.error(`  ${k} = ${actual[k]}`);
  console.error("Add it to DOCUMENTED in this script and to the table in docs/limits.md.");
  process.exit(1);
}

const rows = DOCUMENTED.map((k) => `| \`${k}\` | ${actual[k]} |`);
console.log("| Constant | Value |");
console.log("| --- | ---: |");
for (const r of rows) console.log(r);

if (!process.argv.includes("--check")) process.exit(0);

if (!existsSync(DOC)) {
  console.error("\ndocs/limits.md not found");
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
  console.error("\nSTALE: docs/limits.md disagrees with contract/src/caps.rs:");
  for (const s of stale) console.error(`  ${s}`);
  process.exit(1);
}
console.log(`\nOK: all ${DOCUMENTED.length} constants in contract/src/caps.rs match docs/limits.md.`);
