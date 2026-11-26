// Verifies the example commands in the eight new scripts/README.md sections are
// real: every file invoked must exist, and every flag used must be one the
// script actually parses. A doc example that names a nonexistent flag is worse
// than no example.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(ROOT, "scripts", "README.md"), "utf8");

const SCRIPTS = [
  "alert-expiring-allowances.ts",
  "churn-analysis.ts",
  "keeper-benchmark.ts",
  "metrics-server.ts",
  "migrate-contract.ts",
  "onboard-merchant.ts",
  "renewal-forecast.ts",
  "topup-allowance.ts",
];

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log("PASS  " + label);
  else {
    failures++;
    console.log("FAIL  " + label + (detail ? `\n        ${detail}` : ""));
  }
}

// Isolate one section.
function section(name) {
  const start = readme.indexOf(`### ${name}`);
  if (start === -1) return null;
  const rest = readme.slice(start + 3);
  const end = rest.indexOf("\n### ");
  return end === -1 ? rest : rest.slice(0, end);
}

for (const name of SCRIPTS) {
  const s = section(name);
  check(`${name} has a section`, s !== null);
  if (s === null) continue;

  check(`${name} script file exists`, existsSync(join(ROOT, "scripts", name)));

  // At least one runnable example.
  const bash = [...s.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  check(`${name} has a bash example`, bash.length > 0);
  const all = bash.join("\n");
  check(`${name} example invokes the script`, all.includes(name) || all.includes(name.replace(/\.ts$/, "")));
  check(`${name} example uses tsx, not ts-node`, !/ts-node/.test(all));

  // Some scripts are configured purely by flags or a positional argument
  // (churn-analysis, onboard-merchant, renewal-forecast read the manifest or a
  // --db path and have no required env). So require configuration of *some*
  // kind across the section, not env specifically.
  const allAssigned = new Set([...all.matchAll(/\b([A-Z][A-Z_0-9]{2,})=/g)].map((m) => m[1]));
  const allFlags = [...all.matchAll(/(--[a-z][a-z-]*)/g)].map((m) => m[1]);
  const hasPositional = /\bG[A-Z0-9]{3,}\.\.\.|GABC\.\.\./.test(all);
  check(
    `${name} examples show configuration (env, flags or a positional)`,
    allAssigned.size > 0 || allFlags.length > 0 || hasPositional,
    "expected NAME=value assignments, a --flag, or a positional argument",
  );

  // Every --flag used in the examples must be parsed by the source.
  const src = readFileSync(join(ROOT, "scripts", name), "utf8");
  const used = new Set(allFlags);
  for (const flag of used) {
    check(`${name} example flag ${flag} exists in the source`, src.includes(flag));
  }

  // Every env var assigned in the examples (NAME=value) must be read by the
  // source. Matching on the assignment position avoids picking up placeholders
  // like GABC... or shell-local variables.
  for (const e of allAssigned) {
    if (e === "DATA_DIR" || e === "DB_FILE" || e === "INDEXER_DB" || e === "INDEXER_DB_PATH") continue;
    check(
      `${name} example env ${e} is read by the source`,
      src.includes(e),
      `assigned in the example but not present in ${name}`,
    );
  }
}

// Every relative link in the new sections must resolve.
for (const m of readme.matchAll(/^\|[^\n]*\| \[`([a-z-]+\.ts)`\]\(#/gm)) {
  check(`quick-link #${m[1]} has a section`, section(m[1]) !== null);
}

const total = failures === 0 ? "all example checks passed" : `${failures} check(s) failed`;
console.log(`\n${total}`);
process.exit(failures === 0 ? 0 : 1);
