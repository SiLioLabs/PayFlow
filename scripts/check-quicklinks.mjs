// Print the correct GitHub anchor for each of the eight script headings, and
// check the quick-link table in scripts/README.md against it.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(ROOT, "scripts", "README.md"), "utf8");

function slug(h) {
  return h
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const NAMES = [
  "alert-expiring-allowances.ts",
  "churn-analysis.ts",
  "keeper-benchmark.ts",
  "metrics-server.ts",
  "migrate-contract.ts",
  "onboard-merchant.ts",
  "renewal-forecast.ts",
  "topup-allowance.ts",
];

let bad = 0;
for (const n of NAMES) {
  const want = slug(n);
  const hasHeading = new RegExp(`^### ${n.replace(/\./g, "\\.")}\\s*$`, "m").test(readme);
  // Find the link the quick-link table uses for this script.
  const linkRe = new RegExp(`\\[\`${n.replace(/\./g, "\\.")}\`\\]\\(#([^)]+)\\)`);
  const m = linkRe.exec(readme);
  const got = m ? m[1] : null;
  const ok = hasHeading && got === want;
  if (!ok) bad++;
  console.log(
    `${ok ? "OK   " : "BAD  "} ${n.padEnd(28)} heading=${hasHeading} link=${got ?? "(none)"} want=${want}`,
  );
}
console.log(bad === 0 ? "\nall quick-links resolve" : `\n${bad} wrong`);
process.exit(bad === 0 ? 0 : 1);
