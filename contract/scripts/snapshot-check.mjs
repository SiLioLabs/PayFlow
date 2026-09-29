#!/usr/bin/env node
// FlowPay test-snapshot freshness gate (issue #1048).
//
// `contract/test_snapshots/` is not hand-maintained: soroban-sdk writes
// `test_snapshots/<module>/<test-name>.<N>.json` on every `Env` drop, so the
// files are a recorded trace of what each test actually wrote to the ledger and
// emitted as events. Nothing ever deletes them, so a renamed, removed or
// restructured test leaves its snapshot behind as an orphan that no test reads
// again — it keeps showing up in diffs and can mask a real behaviour change as
// "expected legacy output".
//
// This gate audits the recorded set against the tests that exist today:
//
//   1. orphaned  — a snapshot file with no `#[test] fn` of the same name in the
//                 module it lives in (deleted: run `git rm` on them)
//   2. corrupt   — a snapshot file that is not valid JSON, which is how a
//                 truncated write shows up
//   3. gapped    — a test whose `Env` numbering is not 1..N, i.e. it no longer
//                 creates as many environments as the recorded files
//   4. stale     — only with --after-test: a `cargo test` run rewrote or added
//                 snapshot files, so the committed set is out of date
//
// Tests that build an `Env` but leave no snapshot behind are listed as
// informational, not failed: the SDK skips writing a snapshot for an env that
// recorded no ledger entries, events or auth, and check 4 is the authoritative
// "you forgot to commit a new snapshot" signal because the SDK has by then
// decided whether one was due.
//
// Usage:
//   node scripts/snapshot-check.mjs                # checks 1–3 (static, no build)
//   node scripts/snapshot-check.mjs --after-test   # checks 1–4, run after cargo test
// Exit codes: 0 = snapshot set is fresh, 1 = gate failed.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(contractDir, "..");
const srcDir = join(contractDir, "src");
const snapshotDir = join(contractDir, "test_snapshots");

// `#[test] fn name(` in a module file; `#[ignore]`/`#[should_panic]` between the
// attribute and the fn must not hide the test from the audit.
const TEST_FN = /#\[test\]\s*(?:#\[[^\]]*\]\s*)*fn\s+(\w+)/g;

// A snapshot is only written for an `Env` that recorded something, so a test
// that never builds one can never have a file. Keep that distinction: the
// "missing" report uses it to stay informational instead of failing the build.
const CREATES_ENV = /Env::default\(\)|\b(?:bench_|migration_)?setup\(\)/;

function testBodies(source) {
  const bodies = new Map();
  for (const match of source.matchAll(/fn\s+(\w+)\s*\([^)]*\)[^{]*\{/g)) {
    // Test fns in this crate are top level, so the body ends at the first line
    // that is exactly `}`.
    const end = source.indexOf("\n}", match.index);
    bodies.set(match[1], source.slice(match.index, end === -1 ? undefined : end));
  }
  return bodies;
}

function collectTests() {
  const tests = new Map(); // module -> Map<test name, creates an Env>
  for (const entry of readdirSync(srcDir)) {
    if (!entry.endsWith(".rs")) continue;
    const module = entry.replace(/\.rs$/, "");
    const source = readFileSync(join(srcDir, entry), "utf8");
    const bodies = testBodies(source);
    const names = new Map();
    for (const match of source.matchAll(TEST_FN)) {
      names.set(match[1], CREATES_ENV.test(bodies.get(match[1]) ?? ""));
    }
    tests.set(module, names);
  }
  return tests;
}

// test_snapshots/<module>/<test-name>.<N>.json — the SDK derives the directory
// from the test's module path and the file from its name, so the inverse mapping
// is well defined.
function collectSnapshots() {
  const snapshots = new Map(); // module -> Map<test name, string[]>
  for (const entry of readdirSync(snapshotDir)) {
    const modulePath = join(snapshotDir, entry);
    if (!statSync(modulePath).isDirectory()) continue;
    const byTest = new Map();
    for (const file of readdirSync(modulePath)) {
      if (!file.endsWith(".json")) continue;
      const base = file.slice(0, -".json".length);
      const cut = base.lastIndexOf(".");
      const test = cut === -1 ? base : base.slice(0, cut);
      const number = cut === -1 ? "" : base.slice(cut + 1);
      if (!byTest.has(test)) byTest.set(test, []);
      byTest.get(test).push(/^\d+$/.test(number) ? number : "");
    }
    snapshots.set(entry, byTest);
  }
  return snapshots;
}

function gitLines(args) {
  try {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8" })
      .split("\n")
      .filter((line) => line !== "");
  } catch {
    return null;
  }
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function main() {
  const afterTest = process.argv.slice(2).includes("--after-test");
  const tests = collectTests();
  const snapshots = collectSnapshots();

  const orphaned = [];
  const informational = [];
  const corrupt = [];
  const gapped = [];

  const allTestNames = new Set([...tests.values()].flatMap((names) => [...names]));
  const allTestCount = allTestNames.size;

  for (const [module, byTest] of snapshots) {
    const declared = tests.get(module);
    for (const [test, files] of byTest) {
      if (declared && !declared.has(test) && !allTestNames.has(test)) {
        orphaned.push(`${module}/${test} (${files.length} file(s)) — no #[test] fn of that name`);
      }
      if (declared?.has(test)) {
        const numbers = files.filter((n) => n !== "").map(Number).sort((a, b) => a - b);
        const expected = numbers.map((_, i) => i + 1);
        if (numbers.join(",") !== expected.join(",")) {
          gapped.push(`${module}/${test} — Env numbering is [${numbers.join(", ")}], expected 1..${numbers.length}`);
        }
      }
      for (const file of files) {
        const path = join(snapshotDir, module, `${test}.${file}.json`);
        try {
          JSON.parse(readFileSync(path, "utf8"));
        } catch (error) {
          corrupt.push(`${module}/${test}.${file}.json — ${error.message.split("\n")[0]}`);
        }
      }
    }
  }

  for (const [module, names] of tests) {
    const byTest = snapshots.get(module) ?? new Map();
    for (const [name, createsEnv] of names) {
      if (createsEnv && !byTest.has(name)) {
        // Informational only: the SDK skips writing a snapshot when the env
        // recorded no ledger entries, events or auth, so a test can legitimately
        // have no file. `--after-test` is what catches a genuinely uncommitted
        // snapshot, because the SDK has decided by then whether one is due.
        informational.push(`${module}::${name}`);
      }
    }
  }

  const changed = [];
  if (afterTest) {
    const status = gitLines(["status", "--porcelain", "--", "contract/test_snapshots"]);
    if (status === null) {
      console.error("snapshot-check: `git status` failed; cannot verify freshness.");
      process.exit(1);
    }
    for (const line of status) changed.push(line);
  }

  const fileCount = [...snapshots.values()].reduce((n, byTest) => n + [...byTest.values()].flat().length, 0);

  console.log("");
  console.log("FlowPay snapshot freshness");
  console.log(`  ${allTestCount} #[test] fn(s), ${fileCount} recorded snapshot file(s)`);
  console.log(
    `  orphaned: ${orphaned.length}  corrupt: ${corrupt.length}  gaps: ${gapped.length}` +
      (afterTest ? `  uncommitted: ${changed.length}` : "") +
      `  no-snapshot tests: ${informational.length} (informational)`,
  );
  console.log("");

  let failed = false;
  const report = (title, lines, hint) => {
    if (lines.length === 0) return;
    failed = true;
    console.error(`snapshot-check: ${title}`);
    for (const line of lines) console.error(`  - ${line}`);
    if (hint) console.error(`  ${hint}`);
    console.error("");
  };

  report(
    "orphaned snapshot files (test removed or renamed — the file is read by nothing)",
    orphaned.map((o) => `${o} — delete: git rm contract/test_snapshots/${o.split(" ")[0]}`),
    "Renaming a test? Delete its old snapshot in the same commit; the new name records a fresh one.",
  );
  report("corrupt snapshot files (truncated or invalid JSON)", corrupt, "Regenerate with a full cargo test run.");
  report("snapshot Env numbering gaps", gapped, "Regenerate: cargo test, commit the new files, delete the leftovers.");
  report(
    "cargo test rewrote the snapshot set (stale fixtures, or uncommitted regeneration)",
    changed,
    "Review the diff, then commit the regenerated snapshots with the change that caused it.",
  );

  if (informational.length > 0) {
    console.log("note: tests with an Env but no recorded snapshot (the SDK skips empty snapshots):");
    for (const line of informational) console.log(`  - ${line}`);
    console.log("");
  }

  if (failed) {
    console.error("See contract/test_snapshots/README.md for the snapshot policy.");
    process.exit(1);
  }
  console.log("snapshot-check: snapshot set is fresh and has no orphaned files.");
}

try {
  main();
} catch (error) {
  console.error(`snapshot-check: ${error.message}`);
  process.exit(1);
}
