import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("parses the DLQ and reports a dry-run plan without network access", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "dlq-test-"));
  const dlqFile = join(tmpDir, "failed-batches.jsonl");

  try {
    writeFileSync(
      dlqFile,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        offset: 1,
        limit: 50,
        users: ["GCAX2XXXXX", "GBYYYXXXXX"],
        error: "Some error",
        tx_xdr: null,
        attempts: 0,
        ledger: 12345,
      }) + "\n",
    );

    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", join(scriptsDir, "replay-dlq.ts"), "--dry-run"],
      {
        cwd: scriptsDir,
        env: {
          ...process.env,
          CONTRACT_ID: "CDUMMY",
          KEEPER_SECRET: "SDUMMY",
          DLQ_FILE: dlqFile,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    expect(output).toContain("Found 1 DLQ entries.");
    expect(output).toContain("Would replay");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
