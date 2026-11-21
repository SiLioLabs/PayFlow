#!/usr/bin/env node
/**
 * contrast-check.mjs — lightweight WCAG contrast audit for FlowPay theme tokens.
 *
 * Parses `frontend/src/index.css`, resolves the `:root` (dark) and
 * `[data-theme="light"]` token maps, and asserts that every critical status
 * color meets the agreed contrast target against its background in BOTH themes.
 *
 * Agreed target: WCAG 2.1 AA — 4.5:1 for normal-size text. The status tokens
 * audited here render as 12–13px text (badges, inline error/success text), so
 * they are treated as normal text.
 *
 * Exits 0 when every pair passes and 1 when any pair fails (so CI and the
 * root `audit:contrast` script fail on regressions).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../frontend/src/index.css");

const MIN_CONTRAST = 4.5;

/** Extract `--color-*` declarations from a single CSS block body. */
function parseTokens(body) {
  const tokens = {};
  const re = /(--color-[\w-]+)\s*:\s*([^;]+)\s*;/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** Find the first block matching a selector and return its raw body. */
function findBlock(css, selectorRegex) {
  const m = css.match(selectorRegex);
  return m ? m[1] : "";
}

/** Merge every `[data-theme="light"] { ... }` block (later declarations win). */
function findAllBlocks(css, selectorRegex) {
  const bodies = [];
  let m;
  while ((m = selectorRegex.exec(css)) !== null) {
    bodies.push(m[1]);
  }
  return bodies;
}

function hexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`not a resolvable hex color: "${hex}"`);
  }
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(CSS_PATH, "utf8");

const dark = parseTokens(findBlock(css, /:root\s*\{([^}]*)\}/));
const lightBodies = findAllBlocks(css, /\[data-theme="light"\]\s*\{([^}]*)\}/g);
const light = { ...dark };
for (const body of lightBodies) {
  Object.assign(light, parseTokens(body));
}

const themes = { dark, light };

// [label, foreground token, background token]
const PAIRS = [
  ["danger on surface", "--color-danger", "--color-surface"],
  ["danger on raised", "--color-danger", "--color-surface-raised"],
  ["danger on overlay", "--color-danger", "--color-surface-overlay"],
  ["success on surface", "--color-success", "--color-surface"],
  ["success on raised", "--color-success", "--color-surface-raised"],
  ["success on overlay", "--color-success", "--color-surface-overlay"],
  ["warning on surface", "--color-warning", "--color-surface"],
  ["warning on raised", "--color-warning", "--color-surface-raised"],
  ["warning on overlay", "--color-warning", "--color-surface-overlay"],
  ["danger badge", "--color-danger-text", "--color-danger-bg"],
  ["success badge", "--color-success-text", "--color-success-bg"],
  ["warning badge", "--color-warning-text", "--color-warning-bg"],
];

let failures = 0;
const report = [];

for (const [themeName, tokens] of Object.entries(themes)) {
  for (const [label, fgToken, bgToken] of PAIRS) {
    const fg = tokens[fgToken];
    const bg = tokens[bgToken];
    if (!fg || !bg) {
      failures += 1;
      report.push(`FAIL  [${themeName}] ${label}: missing token ${!fg ? fgToken : bgToken}`);
      continue;
    }
    let ratio;
    try {
      ratio = contrastRatio(fg, bg);
    } catch (err) {
      failures += 1;
      report.push(`FAIL  [${themeName}] ${label}: ${err.message}`);
      continue;
    }
    const pass = ratio >= MIN_CONTRAST;
    if (!pass) failures += 1;
    report.push(
      `${pass ? "PASS" : "FAIL"}  [${themeName}] ${label.padEnd(20)} ${ratio.toFixed(2)}:1 ` +
        `(need ${MIN_CONTRAST}:1)  ${fg} on ${bg}`
    );
  }
}

console.log(report.join("\n"));
console.log(
  `\nContrast audit: ${PAIRS.length * Object.keys(themes).length - failures} passed, ${failures} failed ` +
    `(target ${MIN_CONTRAST}:1).`
);

process.exit(failures > 0 ? 1 : 0);
