/**
 * Verifies that frontend/index.html contains a valid Content-Security-Policy
 * meta tag with the expected directives.
 *
 * Lives in src/utils/ so vitest.config.ts routes it to the Node environment
 * (environmentMatchGlobs: ["src/utils/*.test.ts", "node"]), which is required
 * to read index.html from the filesystem.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = join(__dirname, "../../index.html");

function parseCspMeta(html: string): string | null {
  // The content attribute is double-quoted and contains single-quoted CSP values
  // like 'self', so we cannot use [^"']+ — we need to match up to the closing
  // double quote only.
  const m = html.match(
    /<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/is,
  );
  if (m) return m[1];
  // Also match content-before-http-equiv attribute ordering.
  const m2 = html.match(
    /<meta\s[^>]*content="([^"]+)"[^>]*http-equiv="Content-Security-Policy"/is,
  );
  return m2 ? m2[1] : null;
}

function directiveValue(csp: string, directive: string): string | null {
  // Normalise whitespace inside the CSP value (newlines / multiple spaces).
  const flat = csp.replace(/\s+/g, " ").trim();
  const re = new RegExp(`${directive}([^;]*)(;|$)`, "i");
  const m = flat.match(re);
  return m ? m[1].trim() : null;
}

describe("index.html Content-Security-Policy meta tag", () => {
  const html = readFileSync(INDEX_HTML, "utf8");
  const csp = parseCspMeta(html);

  it("has a CSP meta tag", () => {
    expect(csp).not.toBeNull();
  });

  it("sets default-src 'self'", () => {
    const v = directiveValue(csp!, "default-src");
    expect(v).not.toBeNull();
    expect(v).toContain("'self'");
  });

  it("script-src includes 'self' and 'wasm-unsafe-eval'", () => {
    const v = directiveValue(csp!, "script-src");
    expect(v).not.toBeNull();
    expect(v).toContain("'self'");
    expect(v).toContain("'wasm-unsafe-eval'");
  });

  it("script-src includes a sha256 hash for the inline theme script", () => {
    const v = directiveValue(csp!, "script-src");
    expect(v).toMatch(/'sha256-[A-Za-z0-9+/]+=*'/);
  });

  it("connect-src allows Soroban testnet RPC", () => {
    const v = directiveValue(csp!, "connect-src");
    expect(v).not.toBeNull();
    expect(v).toContain("https://soroban-testnet.stellar.org");
  });

  it("connect-src allows Soroban mainnet RPC", () => {
    const v = directiveValue(csp!, "connect-src");
    expect(v).toContain("https://soroban-mainnet.stellar.org");
  });

  it("connect-src allows Horizon endpoints", () => {
    const v = directiveValue(csp!, "connect-src");
    expect(v).toContain("https://horizon-testnet.stellar.org");
    expect(v).toContain("https://horizon.stellar.org");
  });

  it("object-src is 'none'", () => {
    const v = directiveValue(csp!, "object-src");
    expect(v).not.toBeNull();
    expect(v!.trim()).toBe("'none'");
  });

  it("frame-ancestors is 'none'", () => {
    const v = directiveValue(csp!, "frame-ancestors");
    expect(v).not.toBeNull();
    expect(v!.trim()).toBe("'none'");
  });

  it("base-uri restricts to 'self'", () => {
    const v = directiveValue(csp!, "base-uri");
    expect(v).not.toBeNull();
    expect(v).toContain("'self'");
  });

  it("form-action restricts to 'self'", () => {
    const v = directiveValue(csp!, "form-action");
    expect(v).not.toBeNull();
    expect(v).toContain("'self'");
  });
});
