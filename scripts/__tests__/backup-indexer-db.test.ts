/**
 * Tests for scripts/backup-indexer-db.ts
 *
 * Validates:
 * - Argument parsing for backup/restore subcommands
 * - --force flag required when destination exists
 * - Integrity check must pass before restore proceeds
 * - Dry-run skips file operations
 * - Backup fails when source DB is missing
 * - Restore fails when backup file is missing or fails integrity check
 * - Backup+restore roundtrip: row count is preserved
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  parseArgs,
  runBackup,
  runRestore,
  type SqliteDb,
  type BackupOptions,
  type RestoreOptions,
} from "../backup-indexer-db";

// ── Mock database factory ────────────────────────────────────────────────────

function makeMockDb(opts: {
  integrity?: string;
  rowCount?: number;
  backupFn?: (dest: string) => void;
  throwOnOpen?: boolean;
}): (p: string) => SqliteDb {
  return (_path: string) => {
    if (opts.throwOnOpen) {
      throw new Error("Cannot open database");
    }
    return {
      backup: opts.backupFn ?? ((_dest: string) => { /* no-op */ }),
      pragmaIntegrity: () => opts.integrity ?? "ok",
      countEvents: () => opts.rowCount ?? 42,
      close: () => { /* no-op */ },
    };
  };
}

function tmpPath(suffix = ".db"): string {
  return path.join(os.tmpdir(), `payflow-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
}

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe("parseArgs (backup-indexer-db)", () => {
  it("defaults to backup command", () => {
    const { command } = parseArgs([]);
    expect(command).toBe("backup");
  });

  it("parses restore command", () => {
    const { command } = parseArgs(["restore"]);
    expect(command).toBe("restore");
  });

  it("parses backup --db and --out", () => {
    const { backup } = parseArgs(["backup", "--db", "my.db", "--out", "out.db"]);
    expect(backup.dbPath).toBe("my.db");
    expect(backup.outPath).toBe("out.db");
  });

  it("parses restore --from and --db", () => {
    const { restore } = parseArgs(["restore", "--from", "backup.db", "--db", "live.db"]);
    expect(restore.fromPath).toBe("backup.db");
    expect(restore.dbPath).toBe("live.db");
  });

  it("parses --force flag for backup", () => {
    expect(parseArgs(["backup", "--force"]).backup.force).toBe(true);
  });

  it("parses --dry-run flag for backup", () => {
    expect(parseArgs(["backup", "--dry-run"]).backup.dryRun).toBe(true);
  });

  it("parses --force flag for restore", () => {
    expect(parseArgs(["restore", "--force"]).restore.force).toBe(true);
  });

  it("parses --dry-run flag for restore", () => {
    expect(parseArgs(["restore", "--dry-run"]).restore.dryRun).toBe(true);
  });

  it("default dbPath falls back to data/events.db when env not set", () => {
    const orig = process.env.INDEXER_DB_PATH;
    delete process.env.INDEXER_DB_PATH;
    const { backup } = parseArgs([]);
    process.env.INDEXER_DB_PATH = orig;
    expect(backup.dbPath).toContain("events.db");
  });
});

// ── runBackup ─────────────────────────────────────────────────────────────────

describe("runBackup", () => {
  it("fails when source DB does not exist", () => {
    const opts: BackupOptions = {
      dbPath: "/nonexistent/events.db",
      outPath: tmpPath(),
      force: false,
      dryRun: false,
    };
    const result = runBackup(opts, makeMockDb({}));
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("fails when destination exists and --force not set", () => {
    const srcPath = tmpPath();
    const destPath = tmpPath();
    fs.writeFileSync(srcPath, "fake db");
    fs.writeFileSync(destPath, "existing backup");

    const opts: BackupOptions = {
      dbPath: srcPath,
      outPath: destPath,
      force: false,
      dryRun: false,
    };

    const result = runBackup(opts, makeMockDb({ integrity: "ok" }));
    fs.unlinkSync(srcPath);
    fs.unlinkSync(destPath);

    expect(result.success).toBe(false);
    expect(result.message).toContain("--force");
  });

  it("succeeds with --force when destination exists", () => {
    const srcPath = tmpPath();
    const destPath = tmpPath();
    fs.writeFileSync(srcPath, "fake db");
    fs.writeFileSync(destPath, "existing backup");

    const opts: BackupOptions = {
      dbPath: srcPath,
      outPath: destPath,
      force: true,
      dryRun: false,
    };

    const result = runBackup(opts, makeMockDb({ integrity: "ok", rowCount: 99 }));
    fs.unlinkSync(srcPath);
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(99);
  });

  it("returns success=true and skips files in dry-run", () => {
    const srcPath = tmpPath();
    fs.writeFileSync(srcPath, "fake db");

    const opts: BackupOptions = {
      dbPath: srcPath,
      outPath: tmpPath(),
      force: false,
      dryRun: true,
    };

    const result = runBackup(opts, makeMockDb({}));
    fs.unlinkSync(srcPath);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Dry-run");
    expect(fs.existsSync(opts.outPath)).toBe(false);
  });

  it("fails when integrity check fails on backup file", () => {
    const srcPath = tmpPath();
    fs.writeFileSync(srcPath, "fake db");

    const opts: BackupOptions = {
      dbPath: srcPath,
      outPath: tmpPath(),
      force: false,
      dryRun: false,
    };

    // Mock: backup writes a file, but integrity returns "error"
    const openDb = (p: string): SqliteDb => {
      if (p === opts.dbPath) {
        return {
          backup: (dest: string) => { fs.writeFileSync(dest, "backup"); },
          pragmaIntegrity: () => "ok",
          countEvents: () => 5,
          close: () => {},
        };
      }
      // backup file — bad integrity
      return {
        backup: () => {},
        pragmaIntegrity: () => "*** list of page failures ***",
        countEvents: () => 5,
        close: () => {},
      };
    };

    const result = runBackup(opts, openDb);
    fs.unlinkSync(srcPath);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Integrity check failed");
  });

  it("records row count in result", () => {
    const srcPath = tmpPath();
    fs.writeFileSync(srcPath, "fake db");

    const opts: BackupOptions = {
      dbPath: srcPath,
      outPath: tmpPath(),
      force: false,
      dryRun: false,
    };

    const result = runBackup(opts, makeMockDb({ integrity: "ok", rowCount: 77 }));
    fs.unlinkSync(srcPath);

    expect(result.rowCount).toBe(77);
    expect(result.integrityOk).toBe(true);
    expect(result.success).toBe(true);
  });
});

// ── runRestore ────────────────────────────────────────────────────────────────

describe("runRestore", () => {
  it("fails when --from is not provided", () => {
    const opts: RestoreOptions = {
      fromPath: "",
      dbPath: tmpPath(),
      force: false,
      dryRun: false,
    };
    const result = runRestore(opts, makeMockDb({}));
    expect(result.success).toBe(false);
    expect(result.message).toContain("--from");
  });

  it("fails when backup file does not exist", () => {
    const opts: RestoreOptions = {
      fromPath: "/nonexistent/backup.db",
      dbPath: tmpPath(),
      force: false,
      dryRun: false,
    };
    const result = runRestore(opts, makeMockDb({}));
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("refuses to restore if backup integrity check fails", () => {
    const backupPath = tmpPath();
    fs.writeFileSync(backupPath, "corrupt");

    const opts: RestoreOptions = {
      fromPath: backupPath,
      dbPath: tmpPath(),
      force: false,
      dryRun: false,
    };

    const result = runRestore(opts, makeMockDb({ integrity: "*** corruption ***" }));
    fs.unlinkSync(backupPath);

    expect(result.success).toBe(false);
    expect(result.message).toContain("integrity check failed");
    // Live DB must NOT be touched
    expect(fs.existsSync(opts.dbPath)).toBe(false);
  });

  it("fails when dest exists and --force not set", () => {
    const backupPath = tmpPath();
    const destPath = tmpPath();
    fs.writeFileSync(backupPath, "backup");
    fs.writeFileSync(destPath, "live db");

    const opts: RestoreOptions = {
      fromPath: backupPath,
      dbPath: destPath,
      force: false,
      dryRun: false,
    };

    const result = runRestore(opts, makeMockDb({ integrity: "ok" }));
    fs.unlinkSync(backupPath);
    fs.unlinkSync(destPath);

    expect(result.success).toBe(false);
    expect(result.message).toContain("--force");
  });

  it("succeeds with --force overwrite", () => {
    const backupPath = tmpPath();
    const destPath = tmpPath();
    fs.writeFileSync(backupPath, "backup-content");
    fs.writeFileSync(destPath, "old-live-db");

    const opts: RestoreOptions = {
      fromPath: backupPath,
      dbPath: destPath,
      force: true,
      dryRun: false,
    };

    const result = runRestore(opts, makeMockDb({ integrity: "ok", rowCount: 30 }));
    const destContent = fs.readFileSync(destPath, "utf8");
    fs.unlinkSync(backupPath);
    fs.unlinkSync(destPath);

    expect(result.success).toBe(true);
    expect(destContent).toBe("backup-content");
    expect(result.rowCount).toBe(30);
  });

  it("dry-run succeeds without touching files", () => {
    const backupPath = tmpPath();
    fs.writeFileSync(backupPath, "backup");
    const destPath = tmpPath();

    const opts: RestoreOptions = {
      fromPath: backupPath,
      dbPath: destPath,
      force: false,
      dryRun: true,
    };

    const result = runRestore(opts, makeMockDb({ integrity: "ok" }));
    fs.unlinkSync(backupPath);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Dry-run");
    expect(fs.existsSync(destPath)).toBe(false);
  });
});

// ── Roundtrip ─────────────────────────────────────────────────────────────────

describe("backup + restore roundtrip", () => {
  it("preserves row count through backup → restore cycle", () => {
    const srcPath = tmpPath();
    const backupPath = tmpPath();
    const restorePath = tmpPath();

    fs.writeFileSync(srcPath, "source-db");

    const EXPECTED_ROWS = 123;

    // Backup step: mock DB copies file and reports rowCount
    const backupOpenDb = (p: string): SqliteDb => ({
      backup: (dest: string) => { fs.copyFileSync(p, dest); },
      pragmaIntegrity: () => "ok",
      countEvents: () => EXPECTED_ROWS,
      close: () => {},
    });

    const backupResult = runBackup(
      { dbPath: srcPath, outPath: backupPath, force: false, dryRun: false },
      backupOpenDb
    );
    expect(backupResult.success).toBe(true);
    expect(backupResult.rowCount).toBe(EXPECTED_ROWS);

    // Restore step
    const restoreResult = runRestore(
      { fromPath: backupPath, dbPath: restorePath, force: false, dryRun: false },
      backupOpenDb
    );
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.rowCount).toBe(EXPECTED_ROWS);

    // File content preserved
    expect(fs.readFileSync(restorePath, "utf8")).toBe(
      fs.readFileSync(backupPath, "utf8")
    );

    fs.unlinkSync(srcPath);
    fs.unlinkSync(backupPath);
    fs.unlinkSync(restorePath);
  });
});
