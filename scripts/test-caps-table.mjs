// Proves the drift check actually fails when caps.rs and docs/limits.md
// disagree, in both directions:
//   1. doc says a different number
//   2. caps.rs gains a constant the doc does not cover
// Restores both files afterwards.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPS = join(ROOT, "contract", "src", "caps.rs");
const DOC = join(ROOT, "docs", "limits.md");

const capsOrig = fs.readFileSync(CAPS, "utf8");
const docOrig = fs.readFileSync(DOC, "utf8");

function runCheck() {
  try {
    const out = execFileSync("node", ["scripts/emit-caps-table.mjs", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

let failures = 0;
function expect(label, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) {
    failures++;
    if (detail) console.log(detail.trim().split("\n").map((l) => "       " + l).join("\n"));
  }
}

try {
  // Baseline: the two agree.
  let r = runCheck();
  expect("baseline agrees", r.ok, r.out);

  // 1. doc drifts: change the number in the constants-table row, which is what
  //    the checker anchors on. Uses a regex because the table is padded.
  fs.writeFileSync(
    DOC,
    docOrig.replace(
      /^(\|[^\n]*`TOP_MERCHANTS_PAGE_SIZE`[^\n]*?\|\s*)20(\s*\|)/m,
      "$125$2",
    ),
  );
  r = runCheck();
  expect("doc drift is detected", !r.ok && /TOP_MERCHANTS_PAGE_SIZE/.test(r.out), r.out);

  // 2. contract drift: caps.rs gains an undocumented constant.
  fs.writeFileSync(
    CAPS,
    capsOrig.replace(
      "pub const TOP_MERCHANTS_PAGE_SIZE: u32 = 20;",
      "pub const TOP_MERCHANTS_PAGE_SIZE: u32 = 20;\n\n/// New cap added without a doc update.\npub const BRAND_NEW_CAP: u32 = 7;",
    ),
  );
  r = runCheck();
  expect("undocumented constant is detected", !r.ok && /BRAND_NEW_CAP/.test(r.out), r.out);

  // 3. a constant disappears from caps.rs.
  fs.writeFileSync(
    CAPS,
    capsOrig.replace(/pub const MAX_MERCHANT_SUB_COUNT_BATCH: u32 = 50;\r?\n\r?\n/, ""),
  );
  r = runCheck();
  expect("removed constant is detected", !r.ok && /MAX_MERCHANT_SUB_COUNT_BATCH/.test(r.out), r.out);

  // 4. a constant changes value in caps.rs only. The doc now disagrees.
  fs.writeFileSync(
    CAPS,
    capsOrig.replace("pub const REVENUE_DAY_PAGE_SIZE: u32 = 30;", "pub const REVENUE_DAY_PAGE_SIZE: u32 = 60;"),
  );
  r = runCheck();
  expect("caps.rs value change is detected", !r.ok && /REVENUE_DAY_PAGE_SIZE/.test(r.out), r.out);
} finally {
  fs.writeFileSync(CAPS, capsOrig);
  fs.writeFileSync(DOC, docOrig);
}

const r = runCheck();
expect("files restored, check passes again", r.ok, r.out);

console.log(failures === 0 ? "\nALL DRIFT-CHECK TESTS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
