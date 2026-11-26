import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptsDir = fileURLToPath(new URL("..", import.meta.url));

describe("keeper module entrypoint", () => {
  it("can be imported without starting the keeper", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          "await import('./keeper.ts')",
        ],
        {
          cwd: scriptsDir,
          env: {
            ...process.env,
            CONTRACT_ID: "",
            KEEPER_PUBLIC_KEY: "",
            KEEPER_SECRET: "",
          },
        },
      ),
    ).not.toThrow();
  });
});