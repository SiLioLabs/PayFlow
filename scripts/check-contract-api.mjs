// Fail when a public FlowPay contract entrypoint has no API reference entry.
// Extract public function names and signatures from contract/src/lib.rs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "contract/src/lib.rs"), "utf8");
const api = readFileSync(join(root, "docs/API.md"), "utf8");
const functionsStart = api.indexOf("## Functions");
const functionsEnd = api.indexOf("## Units & Conversions", functionsStart);

if (functionsStart === -1 || functionsEnd === -1) {
  console.error("STALE: docs/API.md is missing the Functions section boundaries");
  process.exit(1);
}

const functionDocs = api.slice(functionsStart, functionsEnd);

const declarations = [...source.matchAll(
  /^\s*pub fn\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:->\s*[^\n{]+)?\s*\{/gm,
)].map((match) => ({
  name: match[1],
  signature: `pub fn ${match[1]}(${match[2].replace(/\s+/g, " ").trim()})`,
}));

const names = declarations
  .map(({ name }) => name)
  .filter((name, index, all) => all.indexOf(name) === index);

const missing = names.filter((name) => {
  const heading = new RegExp(`^###\\s+\`${name}\`\\s*$`, "m");
  const inventoryEntry = new RegExp(`^\\|\\s*\`${name}\`\\s*\\|`, "m");
  return !heading.test(functionDocs) && !inventoryEntry.test(functionDocs);
});

if (missing.length) {
  console.error(`STALE: ${missing.length} public contract function(s) lack an API entry in docs/API.md:`);
  for (const name of missing) console.error(`  ${name}`);
  process.exit(1);
}

console.log(`OK: docs/API.md references all ${names.length} public functions in contract/src/lib.rs`);
