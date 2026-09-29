// Verifies the per-entrypoint claims in docs/limits.md against the source.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "contract", "src");
const read = (f) => readFileSync(join(SRC, f), "utf8");
const lib = read("lib.rs");
const merchantStats = read("merchant_stats.rs");
const subHistory = read("subscription_history.rs");

// Extract a public fn body from lib.rs by brace-matching from its signature,
// so the result cannot spill into the next function.
function body(text, name) {
  const m = new RegExp(`^\\s*pub fn ${name}\\s*\\(`, "m").exec(text);
  if (!m) return null;
  const start = text.indexOf("{", m.index + m[0].length);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(m.index, i + 1);
    }
  }
  return null;
}

const results = [];
function check(label, actual, expected) {
  const ok = actual === expected;
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (expected ${expected}, got ${actual})`);
}

const ENTRYPOINTS = [
  "batch_charge",
  "batch_extend_subscription_ttl",
  "batch_cancel",
  "batch_pause_subscriptions",
  "get_batch_charge_estimate",
  "whitelist_batch_add",
  "whitelist_batch_remove",
  "get_merchant_statuses",
  "get_merchant_sub_counts",
  "get_subscriber_page",
  "get_active_subscriber_page",
  "get_next_charge_batch",
  "get_top_merchants_by_subs",
  "get_merchant_revenue_day_page",
  "get_whitelist_page",
  "get_merchant_revenue_history",
  "get_charge_history_page",
];

console.log("--- every documented entrypoint exists as a pub fn in lib.rs ---");
for (const fn of ENTRYPOINTS) {
  const found = new RegExp(`pub fn ${fn}\\b`).test(lib);
  check(`${fn} exists`, found, true);
}

console.log("\n--- admin gating (require_admin) ---");
const ADMIN = {
  batch_pause_subscriptions: true,
  whitelist_batch_add: true,
  whitelist_batch_remove: true,
  batch_cancel: true,
  batch_charge: false,
  batch_extend_subscription_ttl: false,
  get_batch_charge_estimate: false,
  get_merchant_statuses: false,
  get_merchant_sub_counts: false,
  get_subscriber_page: false,
  get_active_subscriber_page: false,
  get_next_charge_batch: false,
  get_top_merchants_by_subs: false,
  get_merchant_revenue_day_page: false,
  get_whitelist_page: false,
  get_merchant_revenue_history: false,
  get_charge_history_page: false,
};
for (const [fn, want] of Object.entries(ADMIN)) {
  const b = body(lib, fn) ?? "";
  check(`${fn} admin=${want}`, /require_admin/.test(b), want);
}

console.log("\n--- set_max_batch_size accepts 0 (doc's footgun claim) ---");
{
  const b = body(lib, "set_max_batch_size") ?? "";
  check("set_max_batch_size does not reject 0", /size == 0/.test(b), false);
  check("set_max_batch_size rejects > ceiling", /size > MAX_BATCH_SIZE_CEILING/.test(b), true);
}
console.log("\n--- set_max_whitelist_batch_size rejects 0 ---");
{
  const wl = read("whitelist.rs");
  const m = /pub fn set_max_whitelist_batch_size[\s\S]*?\n}/.exec(wl);
  check("whitelist setter rejects 0", /size == 0/.test(m ? m[0] : ""), true);
}

console.log("\n--- pagination: panic vs silent clamp ---");
const CLAMPS = ["get_subscriber_page", "get_active_subscriber_page"];
const PANICS = [
  "get_next_charge_batch",
  "get_top_merchants_by_subs",
  "get_merchant_revenue_day_page",
];
for (const fn of CLAMPS) {
  const b = body(lib, fn) ?? "";
  check(`${fn} silently clamps`, /effective_page_size/.test(b), true);
  check(`${fn} does not panic`, /panic_with_error/.test(b), false);
}
for (const fn of PANICS) {
  const b = body(lib, fn) ?? "";
  const mod = /merchant_stats::/.test(b) ? merchantStats : lib;
  const usesLimit = /if limit >/.test(b) || /if limit >/.test(mod);
  check(`${fn} guards on limit`, usesLimit, true);
  check(`${fn} panics BatchTooLarge`, /BatchTooLarge/.test(b) || /BatchTooLarge/.test(mod), true);
}

console.log("\n--- get_charge_history_page clamp is 12 (MAX_HISTORY) ---");
{
  const m = /const MAX_HISTORY: u32 = (\d+);/.exec(subHistory);
  check("MAX_HISTORY is 12", m && m[1] === "12", true);
}

console.log("\n--- uncapped read paths really are uncapped ---");
{
  const b = body(lib, "get_whitelist_page") ?? "";
  check("get_whitelist_page has no limit> guard", /if limit >/.test(b), false);
  const h = body(lib, "get_merchant_revenue_history") ?? "";
  check("get_merchant_revenue_history has no days> guard", /if days >/.test(h), false);
}

console.log("\n--- limit == 0 returns empty ---");
{
  const b = body(lib, "get_subscriber_page") ?? "";
  check("get_subscriber_page returns empty on cap==0", /cap == 0/.test(b), true);
  const m = /pub fn get_top_merchants_by_subs[\s\S]*?\n}/.exec(merchantStats);
  check("get_top_merchants_by_subs returns empty on limit==0", m && /if limit == 0/.test(m[0]), true);
  const w = /pub fn get_whitelist_page[\s\S]*?\n}/.exec(read("whitelist.rs"));
  check("get_whitelist_page returns empty on limit==0", w && /limit == 0/.test(w[0]), true);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);

