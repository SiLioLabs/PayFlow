import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

function runTest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dlq-test-"));
  const dlqFile = path.join(tmpDir, "failed-batches.jsonl");

  const entry = {
    timestamp: new Date().toISOString(),
    offset: 1,
    limit: 50,
    users: ["GCAX2XXXXX", "GBYYYXXXXX"],
    error: "Some error",
    tx_xdr: null,
    attempts: 0,
    ledger: 12345
  };

  fs.writeFileSync(dlqFile, JSON.stringify(entry) + "\n");

  console.log("Running DLQ dry-run replay...");
  
  try {
    const output = execSync(
      \
px tsx scripts/replay-dlq.ts --dry-run\,
      {
        env: {
          ...process.env,
          CONTRACT_ID: "CDUMMY",
          KEEPER_SECRET: "SDUMMY",
          DLQ_FILE: dlqFile
        },
        encoding: "utf-8"
      }
    );

    console.log("Output:");
    console.log(output);

    if (output.includes("Found 1 DLQ entries.") && output.includes("Would replay")) {
      console.log("? DLQ dry-run parsing & output looks correct.");
    } else {
      console.error("? Output did not contain expected dry-run strings.");
      process.exit(1);
    }
  } catch (err: any) {
    console.error("? Script failed:", err.stdout, err.stderr);
    process.exit(1);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

runTest();
