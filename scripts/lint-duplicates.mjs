/**
 * lint-duplicates.mjs — Check for duplicate import specifiers in .ts files.
 * Used by the "Scripts / lint-duplicates" CI job.
 *
 * A duplicate is defined as two or more non-type `import` statements that
 * share the same module specifier. A regular `import` followed by an
 * `import type` from the same module is NOT flagged — TypeScript allows
 * and sometimes requires this. Two regular (non-type) imports from the
 * same module ARE flagged because they should be merged.
 *
 * Exit 0 = no duplicates found.
 * Exit 1 = one or more duplicates found.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extract all import statements from a TypeScript source file.
 * Returns objects with { specifier, lineNumber, isTypeOnly }.
 *
 * isTypeOnly = true for `import type { ... } from "..."` statements.
 */
function extractImports(source) {
  const lines = source.split("\n");
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    // Match `import type ...` (type-only import)
    const typeMatch = line.match(/^import\s+type\s+.*from\s+['"]([^'"]+)['"]/);
    if (typeMatch) {
      imports.push({ specifier: typeMatch[1], lineNumber: i + 1, isTypeOnly: true });
      continue;
    }
    // Match regular `import ...`
    const match = line.match(/^import\s+.*from\s+['"]([^'"]+)['"]/);
    if (match) {
      imports.push({ specifier: match[1], lineNumber: i + 1, isTypeOnly: false });
    }
  }
  return imports;
}

const scriptsDir = process.cwd();
const tsFiles = walk(scriptsDir);
let totalDuplicates = 0;

for (const filePath of tsFiles) {
  const source = readFileSync(filePath, "utf-8");
  const imports = extractImports(source);

  // Only track non-type imports for duplicate detection.
  // Two `import type` from the same module, or one `import` + one `import type`,
  // are both acceptable TypeScript patterns.
  const seen = new Map(); // specifier -> first line number (non-type imports only)
  const duplicates = [];

  for (const { specifier, lineNumber, isTypeOnly } of imports) {
    if (isTypeOnly) continue; // skip type-only imports
    if (seen.has(specifier)) {
      duplicates.push({ specifier, firstLine: seen.get(specifier), duplicateLine: lineNumber });
    } else {
      seen.set(specifier, lineNumber);
    }
  }

  if (duplicates.length > 0) {
    const relPath = filePath
      .replace(scriptsDir + "/", "")
      .replace(scriptsDir + "\\", "");
    console.error(`\n✗ ${relPath}: duplicate imports found`);
    for (const { specifier, firstLine, duplicateLine } of duplicates) {
      console.error(
        `  "${specifier}" first imported at line ${firstLine}, duplicated at line ${duplicateLine}`
      );
    }
    totalDuplicates += duplicates.length;
  }
}

if (totalDuplicates > 0) {
  console.error(
    `\nFound ${totalDuplicates} duplicate import(s) across ${tsFiles.length} TypeScript file(s).`
  );
  process.exit(1);
}

console.log(
  `✓ No duplicate imports found across ${tsFiles.length} TypeScript file(s).`
);
