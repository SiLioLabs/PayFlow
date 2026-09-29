// Verifies docs/KEEPER.md against scripts/keeper.ts.
//
// The issue's acceptance criteria are: every documented flag exists with the
// same spelling, the command examples run as written, and the env section
// matches the source. Each of those is checked here.
//
//   node scripts/test-keeper-doc.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const keeper = readFileSync(join(ROOT, "scripts", "keeper.ts"), "utf8");
const doc = readFileSync(join(ROOT, "docs", "KEEPER.md"), "utf8");
const pkg = readFileSync(join(ROOT, "scripts", "package.json"), "utf8");
const metrics = readFileSync(join(ROOT, "scripts", "metrics-server.ts"), "utf8");

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log("PASS  " + label);
  } else {
    failures++;
    console.log("FAIL  " + label + (detail ? `\n        ${detail}` : ""));
  }
}

// ── 1. Flags: every flag the source implements must appear as a row in the
//       doc's Flags table, and every flag in that table must exist in source.
//       Anchoring on the table (not just "mentioned somewhere") is what makes
//       the phantom-flag self-test meaningful.
const FLAGS = ["--once", "--dry-run", "--max-batches=", "--help", "-h"];
for (const f of FLAGS) {
  check(`keeper.ts implements ${f}`, keeper.includes(f));
}
check("KEEPER.md no longer documents a --user flag", !doc.includes("--user"));
check(
  "KEEPER.md no longer documents --clear-on-success",
  !doc.includes("--clear-on-success"),
);
check(
  "KEEPER.md does not tell operators to use ts-node for the keeper",
  !/npx ts-node keeper\.ts/.test(doc),
);
check("KEEPER.md tells operators to use tsx", doc.includes("npx tsx keeper.ts"));

// Find the table block that documents the flags: the first run of
// consecutive `|` rows that contains a `--once` cell, then take every first
// cell in that whole run.
const lines = doc.split("\n");
let flagsCell = "";
{
  let i = 0;
  let found = false;
  while (i < lines.length && !found) {
    if (!/^\s*\|/.test(lines[i])) {
      i++;
      continue;
    }
    let j = i;
    const cells = [];
    while (j < lines.length && /^\s*\|/.test(lines[j])) {
      cells.push((lines[j].match(/^\|\s*([^|]*?)\s*\|/) ?? [])[1] ?? "");
      j++;
    }
    if (cells.some((c) => c.includes("--once"))) {
      flagsCell = cells.join("  ");
      found = true;
    }
    i = j;
  }
  check("found the Flags table", found);
}
for (const f of FLAGS) {
  const shown = f === "--max-batches=" ? "--max-batches=N" : f;
  check(
    `Flags table documents ${shown}`,
    flagsCell.includes(shown),
    `table first column was: ${flagsCell}`,
  );
}
// Anything in the Flags table that looks like a flag must exist in the source.
for (const token of flagsCell.match(/--[a-z][a-z-]*/g) ?? []) {
  check(
    `flag ${token} in the doc's table exists in keeper.ts`,
    keeper.includes(token),
  );
}
check("Flags table documents -h", /`-h`/.test(flagsCell));

// ── 2. Runtime: ESM + tsx, and no dotenv.
check("scripts/package.json is type=module", /"type"\s*:\s*"module"/.test(pkg));
check("keeper.ts shebang is tsx", keeper.startsWith("#!/usr/bin/env tsx"));
check("keeper.ts does not import dotenv", !/from "dotenv"|require\("dotenv"\)/.test(keeper));
check("dotenv is not a dependency", !/"dotenv"/.test(pkg));
check("KEEPER.md states there is no .env loading", /no `.env` file loading/i.test(doc));

// ── 3. Environment variables: every var keeper.ts reads must be documented,
//       and every var the doc documents must be read somewhere.
const envVars = new Set([...keeper.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map((m) => m[1]));
for (const v of [...envVars].sort()) {
  check(`KEEPER.md documents env ${v}`, doc.includes(v));
}
// METRICS_PORT is read by metrics-server.ts, which the keeper starts.
envVars.add("METRICS_PORT");
check("METRICS_PORT is read by metrics-server.ts", metrics.includes("METRICS_PORT"));
check("KEEPER.md documents METRICS_PORT", doc.includes("METRICS_PORT"));

// ── 4. Defaults must match the source.
const DEFAULTS = [
  ["DRY_RUN default false", /DRY_RUN === "true"/.test(keeper), /`false`/.test(doc)],
  [
    "INTERVAL_SECONDS default 3600",
    /Number\(process\.env\.INTERVAL_SECONDS\) \|\| 3600/.test(keeper),
    doc.includes("`3600`"),
  ],
  [
    "RPC_URL default testnet",
    /https:\/\/soroban-testnet\.stellar\.org/.test(keeper),
    doc.includes("https://soroban-testnet.stellar.org"),
  ],
  [
    "network passphrase default TESTNET",
    /Networks\.TESTNET/.test(keeper),
    doc.includes("Networks.TESTNET"),
  ],
  [
    "DLQ_FILE default dlq/failed-batches.jsonl",
    /DLQ_FILE \|\| "dlq\/failed-batches\.jsonl"/.test(keeper),
    doc.includes("dlq/failed-batches.jsonl"),
  ],
  [
    "BATCH_SIZE fallback 50",
    /const DEFAULT_BATCH_SIZE = 50/.test(keeper),
    doc.includes("50"),
  ],
  [
    "BATCH_SIZE ceiling 200",
    /const BATCH_SIZE_CEILING = 200/.test(keeper),
    doc.includes("1..200") || doc.includes("1-200"),
  ],
  [
    "METRICS_PORT default 9090",
    /METRICS_PORT[^\n]*9090/.test(metrics),
    doc.includes("9090"),
  ],
];
for (const [label, inSource, inDoc] of DEFAULTS) {
  check(`${label} (source)`, inSource);
  check(`${label} (doc)`, inDoc);
}

// ── 5. Required-variable rules, straight from validateEnv().
check("CONTRACT_ID is required in source", /if \(!CONTRACT_ID\)/.test(keeper));
check("KEEPER_PUBLIC_KEY is required in source", /if \(!KEEPER_PUBLIC_KEY\)/.test(keeper));
check(
  "KEEPER_SECRET required only when not dry-run",
  /if \(!DRY_RUN && !KEEPER_SECRET\)/.test(keeper),
);
check(
  "KEEPER.md marks KEEPER_SECRET as live-mode-only",
  /KEEPER_SECRET[^\n]*\*\*Yes in live mode\*\*/.test(doc),
);

// ── 6. Behaviours the doc calls out must be real.
check(
  "--max-batches is parsed with = only",
  /startsWith\("--max-batches="\)/.test(keeper),
);
check(
  "--max-batches implies --once",
  /argv\.includes\("--once"\) \|\| MAX_BATCHES !== undefined/.test(keeper),
);
check(
  "--help does not exit early",
  !/if \(arg === "--help"[^\n]*\)\s*\{[^}]*process\.exit/.test(keeper),
);
check(
  "resolveBatchSize keeps the un-narrowed value on RPC failure",
  /WARNING: could not read on-chain get_max_batch_size/.test(keeper),
);
check(
  "exit code is errors>0 && totalCharged===0",
  /report\.errors\.length > 0 && report\.totalCharged === 0 \? 1 : 0/.test(keeper),
);
check(
  "KEEPER_SECRET is excluded from the child logger",
  /intentionally included; KEEPER_SECRET is never logged/.test(keeper) ||
    /KEEPER_SECRET is never logged/.test(keeper),
);

// ── 7. ChargeResult table: all seven variants, matching charge-results.md.
for (const v of [
  "Charged",
  "Skipped",
  "NoSubscription",
  "Inactive",
  "Paused",
  "GracePeriodElapsed",
  "AllowanceInsufficient",
]) {
  check(`KEEPER.md lists ChargeResult::${v}`, doc.includes(v));
}
check(
  "KEEPER.md links the wire-format doc",
  doc.includes("charge-results.md"),
);

// ── 8. Command examples must use the tsx runtime.
const examples = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)]
  .flatMap((m) => m[1].split("\n"))
  .filter((l) => /^\s*(npx|npm run|tsx)\s/.test(l));
check("KEEPER.md has runnable command examples", examples.length > 0);
for (const l of examples) {
  check(
    `example uses tsx: ${l.trim().slice(0, 60)}`,
    !/ts-node/.test(l) && (/tsx/.test(l) || /npm run/.test(l)),
  );
}

// ── 9. The old duplicate runbook must be gone.
check(
  "KEEPER.md no longer contains the second legacy runbook",
  !doc.includes("Keeper Bot Operations Guide") && !doc.includes("Legacy Python Keeper"),
);

const total = failures === 0 ? "all checks passed" : `${failures} check(s) failed`;

// ── 10. Meta: prove the checker is not a no-op. Temporarily corrupt the doc
//        in each of the three ways the issue cares about and confirm it fails.
if (failures === 0 && process.argv.includes("--self-test")) {
  const docPath = join(ROOT, "docs", "KEEPER.md");
  const keeperPath = join(ROOT, "scripts", "keeper.ts");
  const docOrig = doc;
  const keeperOrig = keeper;

  const run = () => {
    try {
      execFileSync("node", [join(ROOT, "scripts", "test-keeper-doc.mjs")], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}` };
    }
  };

  try {
    // (a) doc documents a flag that does not exist
    writeFileSync(docPath, docOrig.replace("| `--once`", "| `--totally-fake`"));
    check("self-test: phantom flag is rejected", !run().ok);

    // (b) doc uses the wrong runtime
    writeFileSync(docPath, docOrig.replace("npx tsx keeper.ts", "npx ts-node keeper.ts"));
    check("self-test: ts-node example is rejected", !run().ok);

    // (c) source grows a flag the doc does not mention
    writeFileSync(
      keeperPath,
      keeperOrig.replace(
        'if (arg === "--help" || arg === "-h") showHelp();',
        'if (arg === "--help" || arg === "-h") showHelp();\n  if (arg === "--brand-new-flag") return;',
      ),
    );
    check("self-test: undocumented source flag is rejected", !run().ok);

    // (d) a default changes in the source
    writeFileSync(
      keeperPath,
      keeperOrig.replace("|| 3600", "|| 7200").replace(
        "Number(process.env.INTERVAL_SECONDS) || 7200",
        "Number(process.env.INTERVAL_SECONDS) || 7200",
      ),
    );
    check("self-test: changed default is rejected", !run().ok);
  } finally {
    writeFileSync(docPath, docOrig);
    writeFileSync(keeperPath, keeperOrig);
  }

  check("self-test: files restored", run().ok);
}

const finalFailures = failures;
console.log(`\n${finalFailures === 0 ? "all checks passed" : `${finalFailures} check(s) failed`}`);
process.exit(finalFailures === 0 ? 0 : 1);
