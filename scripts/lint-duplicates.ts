#!/usr/bin/env tsx
/**
 * lint-duplicates.ts — Parse + duplicate-declaration gate for scripts/.
 *
 * Fails when any script under scripts/ (tsconfig.json program):
 *   - does not parse (any syntactic diagnostic), or
 *   - redeclares a symbol: duplicate top-level const/let/function/class/import,
 *     duplicate default export, or a duplicate key in an object literal
 *     (e.g. a config object or a fused `main()`).
 * JSON config files (package.json, tsconfig*.json) are checked for parse
 * errors and duplicate keys too.
 *
 * Only these checks gate CI; ordinary type errors are reported by
 * `npm run typecheck`. Files that already fail and are tracked by their own
 * issues are listed in .duplicate-lint-baseline.json; a listed file that
 * becomes clean must be removed from the list, so the baseline only shrinks.
 *
 * Usage: npx tsx lint-duplicates.ts
 * Exit codes: 0 — clean; 1 — new failures or stale baseline entries.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(ROOT, ".duplicate-lint-baseline.json");

/** Diagnostics that mean "the same name is declared twice". */
const DUPLICATE_CODES = new Set([
  1117, // An object literal cannot have multiple properties with the same name.
  2300, // Duplicate identifier.
  2323, // Cannot redeclare exported variable.
  2393, // Duplicate function implementation.
  2395, // Individual declarations in merged declaration must be all exported or all local.
  2440, // Import declaration conflicts with local declaration.
  2451, // Cannot redeclare block-scoped variable.
  2528, // A module cannot have multiple default exports.
  2813, // Class declaration cannot implement overload list.
  2814, // Function with bodies can only merge with classes that are ambient.
]);

function format(d: ts.Diagnostic): string {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  if (!d.file || d.start === undefined) return `TS${d.code}: ${msg}`;
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
  return `${relative(ROOT, d.file.fileName)}(${line + 1},${character + 1}): TS${d.code}: ${msg}`;
}

function checkTypeScript(findings: Map<string, string[]>): void {
  const configPath = join(ROOT, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !parsed.fileNames.includes(sf.fileName)) continue;
    const syntactic = program.getSyntacticDiagnostics(sf);
    // Semantic duplicates are only meaningful once the file parses.
    const duplicates = syntactic.length
      ? []
      : program.getSemanticDiagnostics(sf).filter((d) => DUPLICATE_CODES.has(d.code));
    const all = [...syntactic, ...duplicates];
    if (all.length) findings.set(relative(ROOT, sf.fileName), all.map(format));
  }
}

function checkJson(file: string, findings: Map<string, string[]>): void {
  const rel = relative(ROOT, file);
  const sf = ts.parseJsonText(file, readFileSync(file, "utf8"));
  const errors = (sf as ts.JsonSourceFile & { parseDiagnostics: ts.Diagnostic[] })
    .parseDiagnostics.map(format);

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set<string>();
      for (const prop of node.properties) {
        if (!prop.name || !(ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name))) continue;
        const key = prop.name.text;
        if (seen.has(key)) {
          const { line, character } = sf.getLineAndCharacterOfPosition(prop.name.getStart(sf));
          errors.push(`${rel}(${line + 1},${character + 1}): duplicate key "${key}"`);
        }
        seen.add(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (errors.length) findings.set(rel, errors);
}

function main(): void {
  const findings = new Map<string, string[]>();
  checkTypeScript(findings);
  for (const name of readdirSync(ROOT)) {
    if (name === "package.json" || /^tsconfig.*\.json$/.test(name)) {
      checkJson(join(ROOT, name), findings);
    }
  }

  const baseline = new Set<string>(JSON.parse(readFileSync(BASELINE_FILE, "utf8")).files);
  let failed = false;

  for (const [file, messages] of [...findings].sort()) {
    if (baseline.has(file)) {
      console.log(`baselined: ${file} (${messages.length} issue(s))`);
      continue;
    }
    failed = true;
    for (const m of messages) console.error(m);
  }
  for (const file of [...baseline].sort()) {
    if (!findings.has(file)) {
      failed = true;
      console.error(`${file} is clean now — remove it from .duplicate-lint-baseline.json`);
    }
  }

  if (failed) {
    console.error("\nlint-duplicates: FAILED");
    process.exit(1);
  }
  console.log(`lint-duplicates: OK (${baseline.size} baselined file(s))`);
}

main();
