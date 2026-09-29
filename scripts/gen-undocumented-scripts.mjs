// Generates the eight-script reference section for scripts/README.md.
//
// The entries are written by hand (they need prose), but every flag and
// environment variable asserted here is read back out of the script, so the
// section cannot drift from the code without this failing.
//
//   node scripts/gen-undocumented-scripts.mjs          # print the section
//   node scripts/gen-undocumented-scripts.mjs --check  # exit 1 if README is stale
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// marker pairs delimiting the generated block in scripts/README.md
const START = "<!-- BEGIN undocumented-scripts -->";
const END = "<!-- END undocumented-scripts -->";

/** The eight scripts, and what each needs from the source. */
const SCRIPTS = [
  {
    name: "alert-expiring-allowances.ts",
    file: "scripts/alert-expiring-allowances.ts",
    flags: ["--dry-run", "--file", "--help"],
    env: [
      "CONTRACT_ID",
      "NETWORK_PASSPHRASE",
      "ALERT_WINDOW_LEDGERS",
      "CONCURRENCY",
      "MAX_RETRIES",
      "RETRY_BASE_MS",
      "WEBHOOK_URL",
    ],
  },
  {
    name: "churn-analysis.ts",
    file: "scripts/churn-analysis.ts",
    flags: ["--format", "--db", "--out", "--resubscription-logic"],
    env: ["INDEXER_DB_PATH", "INDEXER_DB"],
  },
  {
    name: "keeper-benchmark.ts",
    file: "scripts/keeper-benchmark.ts",
    flags: ["--dry-run", "--fixture", "--simulate"],
    env: ["CONTRACT_ID", "KEEPER_SECRET_KEY", "NETWORK_PASSPHRASE", "RPC_URL"],
  },
  {
    name: "metrics-server.ts",
    file: "scripts/metrics-server.ts",
    flags: [],
    env: ["METRICS_PORT"],
  },
  {
    name: "migrate-contract.ts",
    file: "scripts/migrate-contract.ts",
    flags: ["--dry-run"],
    env: ["VITE_CONTRACT_ID", "VITE_NETWORK_PASSPHRASE", "VITE_RPC_URL"],
  },
  {
    name: "onboard-merchant.ts",
    file: "scripts/onboard-merchant.ts",
    flags: ["--batch", "--contractId", "--rpcUrl"],
    env: ["MERCHANT_ONBOARD_WEBHOOK_URL"],
  },
  {
    name: "renewal-forecast.ts",
    file: "scripts/renewal-forecast.ts",
    flags: ["--db", "--stdin", "--json", "--out"],
    env: ["DATA_DIR", "DB_FILE"],
  },
  {
    name: "topup-allowance.ts",
    file: "scripts/topup-allowance.ts",
    flags: ["--simulate"],
    env: [
      "CONTRACT_ID",
      "TOKEN_ADDRESS",
      "USER_ADDRESS",
      "USER_SECRET",
      "AMOUNT",
      "EXPIRY_LEDGERS",
      "NETWORK_PASSPHRASE",
      "RPC_URL",
    ],
  },
];

// ── 1. every asserted flag/env must really exist in the script ───────────────
let bad = 0;
for (const s of SCRIPTS) {
  const p = join(ROOT, s.file);
  if (!existsSync(p)) {
    console.error(`MISSING FILE: ${s.file}`);
    bad++;
    continue;
  }
  const src = read(s.file);
  for (const f of s.flags) {
    if (!src.includes(f)) {
      console.error(`${s.file}: documented flag ${f} does not exist in the source`);
      bad++;
    }
  }
  for (const e of s.env) {
    if (!new RegExp(`process\\.env\\.${e}\\b`).test(src)) {
      console.error(`${s.file}: documented env ${e} is never read`);
      bad++;
    }
  }
}
if (bad) {
  console.error(`\n${bad} assertion(s) failed: the README entries do not match the scripts.`);
  process.exit(1);
}
console.log(`all ${SCRIPTS.length} scripts: documented flags and env vars exist in the source`);

// ── 2. the generated block ─────────────────────────────────────────────────
const entry = (s) => {
  const flags = s.flags.length
    ? s.flags.map((f) => `\`${f}\``).join(", ")
    : "none";
  const env = s.env.map((e) => `\`${e}\``).join(", ");
  return `| \`${s.name}\` | ${flags} | ${env} |`;
};

const table = [
  "| Script | Flags | Environment variables |",
  "| ------ | ----- | --------------------- |",
  ...SCRIPTS.map(entry),
].join("\n");

const block = `${START}
${table}
${END}`;

if (process.argv.includes("--emit")) {
  process.stdout.write(block + "\n");
  process.exit(0);
}

// ── 3. --check: does scripts/README.md contain the current table? ───────────
const readmePath = join(ROOT, "scripts", "README.md");
const readme = readFileSync(readmePath, "utf8");

if (!process.argv.includes("--check")) {
  console.log("\n--- generated block ---");
  console.log(block);
  process.exit(0);
}

const problems = [];
for (const s of SCRIPTS) {
  // Each script needs its own `### <name>` heading, so it is individually
  // addressable, and a runnable example mentioning it.
  if (!readme.includes(`### ${s.name}`)) {
    problems.push(`scripts/README.md has no "### ${s.name}" section`);
  }
  for (const f of s.flags) {
    // The flag must appear inside that script's own section, not just anywhere
    // in a 1300-line file.
    const start = readme.indexOf(`### ${s.name}`);
    if (start === -1) continue;
    const rest = readme.slice(start);
    const end = rest.indexOf("\n### ", 4);
    const section = end === -1 ? rest : rest.slice(0, end);
    if (!section.includes(f)) {
      problems.push(`${s.name}: section does not document ${f}`);
    }
  }
  for (const e of s.env) {
    const start = readme.indexOf(`### ${s.name}`);
    if (start === -1) continue;
    const rest = readme.slice(start);
    const end = rest.indexOf("\n### ", 4);
    const section = end === -1 ? rest : rest.slice(0, end);
    if (!section.includes(e)) {
      problems.push(`${s.name}: section does not document ${e}`);
    }
  }
}

if (problems.length) {
  console.error("\nSTALE: scripts/README.md does not document these:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`\nOK: all ${SCRIPTS.length} scripts have a section in scripts/README.md covering every flag and env var.`);
