/**
 * lint-duplicates-baseline.test.ts — Smoke test for the duplicate-lint baseline.
 *
 * Guards against the regression that motivated this test: a malformed
 * .duplicate-lint-baseline.json (missing comma / duplicate "files" key) used
 * to crash lint-duplicates.ts with a raw JSON.parse stack trace and silenced
 * the gate's real findings. These tests assert that
 *   1. the checked-in baseline parses and exposes a string `files` array,
 *   2. it contains exactly one top-level "files" key,
 *   3. a malformed baseline fails with an error that names the file and
 *      explains it contains invalid JSON (preserving the parser's message), and
 *   4. the CLI gate surfaces that same actionable error on stderr.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadBaseline } from "../lint-duplicates.js";

const scriptsDir = fileURLToPath(new URL("..", import.meta.url));
const baselineFile = join(scriptsDir, ".duplicate-lint-baseline.json");

const tempDir = mkdtempSync(join(tmpdir(), "payflow-dup-baseline-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("duplicate-lint baseline smoke test", () => {
  it("parses the checked-in baseline as valid JSON with a string files array", () => {
    const files = loadBaseline(baselineFile);
    expect(Array.isArray(files)).toBe(true);
    expect(files.every((f) => typeof f === "string")).toBe(true);
  });

  it("contains exactly one top-level files key", () => {
    const raw = readFileSync(baselineFile, "utf8");
    expect(raw.match(/"files"\s*:/g)?.length).toBe(1);
  });

  it("names the file and explains invalid JSON when the baseline cannot be parsed", () => {
    const bad = join(tempDir, ".duplicate-lint-baseline.json");
    // Missing comma plus duplicate "files" key — the original defect.
    writeFileSync(bad, '{\n  "files": [\n    "a.ts"\n  ]\n  "files": []\n}');

    let caught: unknown;
    try {
      loadBaseline(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(bad);
    expect(message).toContain("invalid JSON");
    // The original JSON.parse error is preserved as diagnostic context.
    expect(message).toContain("JSON.parse reported:");
  });

  it("rejects a baseline without a top-level files array", () => {
    const wrong = join(tempDir, "no-files-key.json");
    writeFileSync(wrong, '{ "entries": [] }');
    expect(() => loadBaseline(wrong)).toThrowError(/"files" array/);
  });

  it("CLI gate exits 1 with the actionable error on stderr for a malformed baseline", () => {
    const bad = join(tempDir, "cli-malformed-baseline.json");
    writeFileSync(bad, '{ "files": [] "files": [] }');

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "lint-duplicates.ts"],
      {
        cwd: scriptsDir,
        encoding: "utf8",
        env: { ...process.env, LINT_DUPLICATES_BASELINE: bad },
      },
    );

    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain(bad);
    expect(output).toContain(`${basename(bad)} contains invalid JSON`);
    expect(output).toContain("JSON.parse reported:");
    expect(output).toContain("lint-duplicates: FAILED");
  });
});
