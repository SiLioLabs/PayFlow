/**
 * logger-redaction.test.ts — the logger must never write secret material.
 *
 * The keeper, the DLQ replayer, the admin tool and the allowance top-up tool
 * all read a Stellar secret key from the environment. If any of them leaks
 * that key into a log line, a CI log, or an alerting webhook, the key is
 * compromised. These tests feed a realistic secret through every logging
 * sink and assert that the raw key never reaches the output.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  logger,
  createRootLogger,
  redactSecrets,
  redactValue,
  isSecretEnvVar,
  SECRET_ENV_VARS,
  SECRET_MASK,
} from "../logger.js";

/**
 * A structurally valid Stellar secret key: `S` followed by 55 base32
 * characters. It is syntactically realistic but was generated for this test
 * and funds nothing.
 */
const REALISTIC_SECRET =
  "S" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".repeat(2).slice(0, 55);

function captureLogs(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  return {
    stdout,
    stderr,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe("redactSecrets", () => {
  const originalSecret = process.env.SECRET_KEY;

  beforeEach(() => {
    process.env.SECRET_KEY = REALISTIC_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = originalSecret;
  });

  it("masks a Stellar secret key that appears verbatim in the text", () => {
    const out = redactSecrets(`failed to sign with ${REALISTIC_SECRET}`);
    expect(out).not.toContain(REALISTIC_SECRET);
    expect(out).toContain(SECRET_MASK);
  });

  it("masks the live value of a secret-bearing environment variable", () => {
    const out = redactSecrets(`key=${REALISTIC_SECRET}`);
    expect(out).not.toContain(REALISTIC_SECRET);
  });

  it("masks `NAME=value` pairs for every documented secret variable", () => {
    for (const name of SECRET_ENV_VARS) {
      const out = redactSecrets(`${name}=super-secret-value`);
      expect(out).not.toContain("super-secret-value");
      expect(out).toContain(SECRET_MASK);
    }
  });

  it("masks `NAME=value` pairs for secret-shaped names that are not listed", () => {
    const out = redactSecrets("DEPLOYER_PRIVATE_KEY=abc123def456");
    expect(out).not.toContain("abc123def456");
  });

  it("leaves non-secret values untouched", () => {
    const msg = "Contract CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC ok";
    expect(redactSecrets(msg)).toBe(msg);
  });

  it("is a no-op for empty input", () => {
    expect(redactSecrets("")).toBe("");
  });
});

describe("isSecretEnvVar", () => {
  it("recognises the documented secret variables", () => {
    for (const name of SECRET_ENV_VARS) {
      expect(isSecretEnvVar(name)).toBe(true);
    }
  });

  it("recognises secret-shaped names by suffix", () => {
    expect(isSecretEnvVar("MY_SERVICE_SECRET")).toBe(true);
    expect(isSecretEnvVar("MY_SERVICE_SECRET_KEY")).toBe(true);
    expect(isSecretEnvVar("MY_SERVICE_PRIVATE_KEY")).toBe(true);
  });

  it("does not treat ordinary variables as secret", () => {
    expect(isSecretEnvVar("CONTRACT_ID")).toBe(false);
    expect(isSecretEnvVar("TOKEN_ADDRESS")).toBe(false);
    expect(isSecretEnvVar("BATCH_SIZE")).toBe(false);
  });
});

describe("redactValue", () => {
  it("scrubs nested strings in objects and arrays", () => {
    const out = redactValue({
      user: "GAAA",
      keys: ["S" + "A".repeat(55)],
      nested: { secret: "SECRET_KEY=abcdef123456" },
    }) as Record<string, unknown>;

    expect(JSON.stringify(out)).not.toContain("A".repeat(55));
    expect(JSON.stringify(out)).not.toContain("abcdef123456");
  });

  it("leaves non-string scalars untouched", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
  });
});

describe("logger sinks", () => {
  const originalSecret = process.env.SECRET_KEY;
  const originalFormat = process.env.LOG_FORMAT;

  beforeEach(() => {
    process.env.SECRET_KEY = REALISTIC_SECRET;
    process.env.LOG_FORMAT = "json";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SECRET_KEY;
    else process.env.SECRET_KEY = originalSecret;
    if (originalFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalFormat;
  });

  it("redacts a secret passed in the message", () => {
    const sink = captureLogs();
    try {
      logger.error(`signing failed for ${REALISTIC_SECRET}`);
    } finally {
      sink.restore();
    }

    const output = [...sink.stdout, ...sink.stderr].join("");
    expect(output).not.toContain(REALISTIC_SECRET);
    expect(output).toContain(SECRET_MASK);
  });

  it("redacts a secret passed in the context", () => {
    const sink = captureLogs();
    try {
      logger.info("tx failed", { key: REALISTIC_SECRET });
    } finally {
      sink.restore();
    }

    const output = [...sink.stdout, ...sink.stderr].join("");
    expect(output).not.toContain(REALISTIC_SECRET);
    expect(output).toContain(SECRET_MASK);
  });

  it("redacts a secret carried by an Error context (message and stack)", () => {
    const sink = captureLogs();
    try {
      const err = new Error(`boom ${REALISTIC_SECRET}`);
      logger.error("operation failed", err);
    } finally {
      sink.restore();
    }

    const output = [...sink.stdout, ...sink.stderr].join("");
    expect(output).not.toContain(REALISTIC_SECRET);
  });

  it("redacts a secret carried by a child logger's bound context", () => {
    const sink = captureLogs();
    try {
      const child = createRootLogger({ key: REALISTIC_SECRET });
      child.warn("child log");
    } finally {
      sink.restore();
    }

    const output = [...sink.stdout, ...sink.stderr].join("");
    expect(output).not.toContain(REALISTIC_SECRET);
  });

  it("still emits the log line itself", () => {
    const sink = captureLogs();
    try {
      logger.info("hello world");
    } finally {
      sink.restore();
    }

    const output = [...sink.stdout, ...sink.stderr].join("");
    expect(output).toContain("hello world");
  });
});
