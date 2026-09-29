#!/usr/bin/env node

/**
 * lint-duplicates.mjs — Lightweight duplicate declaration detector for TypeScript scripts.
 *
 * Scans all .ts files in the scripts directory for duplicate top-level declarations
 * (functions, consts, vars, classes, interfaces, types, enums).
 *
 * Usage:
 *   node scripts/lint-duplicates.mjs
 *
 * Exit codes:
 *   0 — no duplicates found
 *   1 — one or more duplicates found
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(__dirname);

// ── Declaration Patterns ─────────────────────────────────────────────────────

/**
 * Regex patterns to match top-level declarations in TypeScript.
 * These are intentionally loose to catch most declarations without full parsing.
 */
const declarationPatterns = [
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm,
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/gm,
  /^(?:export\s+)?class\s+(\w+)[\s{]/gm,
  /^(?:export\s+)?interface\s+(\w+)[\s{]/gm,
  /^(?:export\s+)?type\s+(\w+)\s*=/gm,
  /^(?:export\s+)?enum\s+(\w+)[\s{]/gm,
];

/**
 * Extract all top-level declarations from TypeScript source code.
 */
function extractDeclarations(source) {
  const declarations = [];

  for (const pattern of declarationPatterns) {
    let match;
    // Reset regex if it's global
    pattern.lastIndex = 0;
    while ((match = pattern.exec(source)) !== null) {
      const declarationName = match[1];
      const lineNumber = source.substring(0, match.index).split("\n").length;
      declarations.push({ name: declarationName, line: lineNumber });
    }
  }

  return declarations;
}

/**
 * Find duplicate declarations in extracted array.
 */
function findDuplicates(declarations) {
  const nameMap = new Map();

  for (const decl of declarations) {
    if (!nameMap.has(decl.name)) {
      nameMap.set(decl.name, []);
    }
    nameMap.get(decl.name).push(decl.line);
  }

  const duplicates = [];
  for (const [name, lines] of nameMap) {
    if (lines.length > 1) {
      duplicates.push({ name, lines });
    }
  }

  return duplicates;
}

/**
 * Process all .ts files in scripts directory.
 */
function lintDirectory(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const allIssues = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const source = fs.readFileSync(filePath, "utf-8");
    const declarations = extractDeclarations(source);
    const duplicates = findDuplicates(declarations);

    if (duplicates.length > 0) {
      allIssues.push({ file, duplicates });
    }
  }

  return allIssues;
}

/**
 * Main entry point.
 */
function main() {
  const issues = lintDirectory(scriptsDir);

  if (issues.length === 0) {
    console.log("✓ No duplicate declarations found.");
    process.exit(0);
  }

  console.log("✗ Duplicate declarations detected:\n");
  for (const { file, duplicates } of issues) {
    console.log(`  ${file}:`);
    for (const { name, lines } of duplicates) {
      console.log(`    - '${name}' declared at lines: ${lines.join(", ")}`);
    }
    console.log();
  }

  const totalIssues = issues.reduce((sum, { duplicates }) => sum + duplicates.length, 0);
  console.log(`Found ${totalIssues} duplicate declaration(s).`);
  process.exit(1);
}

main();
