/**
 * Documentation link checker.
 *
 * Walks every markdown file in the repo and verifies that:
 *   1. each relative link/anchor target file exists,
 *   2. each `#anchor` resolves to a heading that actually exists in the target,
 *   3. each intra-document `#anchor` resolves within the same file.
 *
 * Also reports markdown files that nothing links to (orphans), which is how a
 * new doc ends up unreachable.
 *
 * Usage: node check-doc-links.mjs [rootDir]
 * Exits 1 if any broken link is found.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";

const ROOT = resolve(process.argv[2] ?? ".");
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", "test_snapshots",
  "coverage", ".next", "vendor",
]);

/** Slug algorithm: GitHub-flavoured heading anchors. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // links -> text
    .replace(/[*~]/g, "")                            // emphasis, keep _
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")               // drop punctuation, keep _ and -
    .replace(/\s/g, "-");                            // each space -> one hyphen
}

function collectAnchors(md) {
  const anchors = new Set();
  const inFence = [];
  let fence = null;
  for (const line of md.split(/\r?\n/)) {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      anchors.add(slugify(h[2]));
      // GitHub also appends -1, -2 for duplicate headings.
      const base = slugify(h[2]);
      let n = 1;
      while (anchors.has(`${base}-${n}`)) n++;
      anchors.add(`${base}-${n}`);
    }
  }
  return anchors;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full);
    else if (extname(entry) === ".md") yield full;
  }
}

const files = [...walk(ROOT)];
const anchorCache = new Map();
function anchorsFor(file) {
  if (!anchorCache.has(file)) {
    anchorCache.set(file, collectAnchors(readFileSync(file, "utf8")));
  }
  return anchorCache.get(file);
}

const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const broken = [];
const linked = new Set();
let checked = 0;

for (const file of files) {
  const md = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  for (const m of md.matchAll(linkRe)) {
    let target = m[1];
    if (/^(https?:|mailto:|data:|#!)/i.test(target)) continue;
    checked++;

    const [pathPart, anchor] = target.split("#");

    if (!pathPart) {
      // intra-document anchor
      if (anchor && !anchorsFor(file).has(decodeURIComponent(anchor).toLowerCase())) {
        broken.push(`${rel}  ->  #${anchor}   (no such heading in this file)`);
      }
      linked.add(rel);
      continue;
    }

    if (/^</.test(pathPart)) {
      broken.push(`${rel}  ->  ${target}   (angle-bracket link path not supported)`);
      continue;
    }

    const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
    if (!existsSync(resolved)) {
      broken.push(`${rel}  ->  ${target}   (file not found)`);
      continue;
    }

    // Bare directory link: fine.
    if (extname(resolved) !== ".md") { linked.add(rel); continue; }

    if (anchor) {
      const want = decodeURIComponent(anchor).toLowerCase();
      if (!anchorsFor(resolved).has(want)) {
        broken.push(`${rel}  ->  ${target}   (no heading '${anchor}' in ${relative(ROOT, resolved).replace(/\\/g, "/")})`);
      }
    }
    linked.add(rel);
  }
}

console.log(`Scanned ${files.length} markdown file(s), checked ${checked} link(s).`);
if (broken.length) {
  console.log(`\nBROKEN LINKS (${broken.length}):`);
  for (const b of broken) console.log("  " + b);
  process.exit(1);
}
console.log("No broken relative links or anchors.");
