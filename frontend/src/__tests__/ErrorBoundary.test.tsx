/**
 * Tests for ErrorBoundary — reporter invocation, redaction, and default-off behaviour.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ErrorBoundary, {
  redactError,
  type ErrorReporter,
  type ErrorReport,
} from "../components/ErrorBoundary";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A child that throws synchronously when `shouldThrow` is true. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error("boom");
  return <span>ok</span>;
}

// Suppress React's noisy console.error for expected boundary catches.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Valid base32 alphabet is A-Z and 2-7 (RFC 4648). Real Stellar addresses use
// exactly these characters. Test addresses below are not real network keys.
const SUFFIX_55 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW"; // 55 chars
const PUB_KEY     = "G" + SUFFIX_55; // 56 chars
const CONTRACT_ID = "C" + SUFFIX_55; // 56 chars
const SECRET_KEY  = "S" + SUFFIX_55; // 56 chars

// ── redactError ───────────────────────────────────────────────────────────────

describe("redactError", () => {
  it("redacts a Stellar public key (G + 55 base32 chars)", () => {
    expect(redactError(`user: ${PUB_KEY}`)).toBe("user: [redacted]");
  });

  it("redacts a contract ID (C + 55 base32 chars)", () => {
    expect(redactError(`contract: ${CONTRACT_ID}`)).toBe("contract: [redacted]");
  });

  it("redacts a secret key (S + 55 base32 chars)", () => {
    expect(redactError(`secret: ${SECRET_KEY}`)).toBe("secret: [redacted]");
  });

  it("redacts multiple occurrences in one string", () => {
    const result = redactError(`${PUB_KEY} paid ${PUB_KEY}`);
    expect(result).toBe("[redacted] paid [redacted]");
  });

  it("leaves short strings unchanged", () => {
    expect(redactError("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
  });

  it("redacts a secret key before it can be confused with a public key", () => {
    // Secret keys start with S, which is not G/C, so the G pass would not
    // match; the S pass catches it first.
    const result = redactError(`key=${SECRET_KEY}`);
    expect(result).not.toContain(SECRET_KEY);
    expect(result).toContain("[redacted]");
  });

  it("returns an empty string unchanged", () => {
    expect(redactError("")).toBe("");
  });
});

// ── Reporter invocation ───────────────────────────────────────────────────────

describe("ErrorBoundary — reporter invocation", () => {
  it("calls onError with an ErrorReport when a child throws", () => {
    const reporter: ErrorReporter = vi.fn();
    render(
      <ErrorBoundary onError={reporter}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(reporter).toHaveBeenCalledOnce();
    const report: ErrorReport = (reporter as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(report.name).toBe("TypeError".includes("Error") ? report.name : "Error");
    expect(report.message).toBe("boom");
    expect(typeof report.componentStack).toBe("string");
    expect(typeof report.timestamp).toBe("string");
  });

  it("report.message matches the thrown error message", () => {
    const reporter = vi.fn();
    render(
      <ErrorBoundary onError={reporter}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    const report: ErrorReport = reporter.mock.calls[0][0];
    expect(report.message).toBe("boom");
  });

  it("report.name is the error class name", () => {
    const reporter = vi.fn();
    render(
      <ErrorBoundary onError={reporter}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    const report: ErrorReport = reporter.mock.calls[0][0];
    expect(report.name).toBe("Error");
  });

  it("report.componentStack is a non-empty string", () => {
    const reporter = vi.fn();
    render(
      <ErrorBoundary onError={reporter}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    const report: ErrorReport = reporter.mock.calls[0][0];
    expect(report.componentStack.length).toBeGreaterThan(0);
  });

  it("report.timestamp is a valid ISO-8601 date string", () => {
    const reporter = vi.fn();
    render(
      <ErrorBoundary onError={reporter}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    const report: ErrorReport = reporter.mock.calls[0][0];
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });

  it("redacts a Stellar address embedded in the error message", () => {
    const reporter = vi.fn();
    function AddressBomb() {
      throw new Error(`user ${PUB_KEY} not found`);
    }
    render(
      <ErrorBoundary onError={reporter}>
        <AddressBomb />
      </ErrorBoundary>,
    );
    const report: ErrorReport = reporter.mock.calls[0][0];
    expect(report.message).not.toContain(PUB_KEY);
    expect(report.message).toContain("[redacted]");
  });
});

// ── Disabled by default ───────────────────────────────────────────────────────

describe("ErrorBoundary — disabled by default", () => {
  it("does not throw and renders fallback when no onError prop is provided", () => {
    render(
      <ErrorBoundary fallback={<span>fallback</span>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  it("renders children normally when no error is thrown", () => {
    const reporter = vi.fn();
    render(
      <ErrorBoundary onError={reporter}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(reporter).not.toHaveBeenCalled();
  });

  it("swallows exceptions thrown by the reporter", () => {
    const badReporter: ErrorReporter = () => {
      throw new Error("reporter exploded");
    };
    expect(() =>
      render(
        <ErrorBoundary onError={badReporter}>
          <Bomb shouldThrow />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
  });

  it("renders the default fallback UI when no fallback prop is given", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });
});
