import { Component, type ErrorInfo, type ReactNode } from "react";

// ── Error reporter type ───────────────────────────────────────────────────────

/**
 * Shape of the payload passed to every `onError` reporter call.
 *
 * All string fields are pre-redacted: Stellar addresses, contract IDs, and
 * secret keys are replaced with `[redacted]` before the payload is built.
 * See `redactError` in this module for the redaction rules.
 */
export interface ErrorReport {
  /** Redacted error message. */
  message: string;
  /** Error class name, e.g. "TypeError". */
  name: string;
  /** Redacted component stack from React's ErrorInfo. */
  componentStack: string;
  /** ISO-8601 timestamp of when the boundary caught the error. */
  timestamp: string;
}

/**
 * Callback signature for the pluggable error reporter.
 *
 * The reporter is called once per boundary catch. It receives a pre-redacted
 * `ErrorReport` and may do anything with it (send to a backend, log to a
 * service, write to a local store). Errors thrown inside the reporter are
 * swallowed so they cannot trigger the boundary again.
 */
export type ErrorReporter = (report: ErrorReport) => void;

// ── Redaction ─────────────────────────────────────────────────────────────────

/**
 * Replace identifiable Stellar strings in `text` with `[redacted]`.
 *
 * Rules (applied in order):
 * 1. Stellar secret keys  — S + 55 base32 chars  (`S[A-Z2-7]{55}`)
 * 2. Contract IDs         — C + 55 base32 chars  (`C[A-Z2-7]{55}`)
 * 3. Public keys          — G + 55 base32 chars  (`G[A-Z2-7]{55}`)
 *
 * Secret keys are matched first so they cannot be confused with public keys.
 * The base32 alphabet is `[A-Z2-7]` (RFC 4648); lowercase variants are also
 * matched via the `i` flag.
 */
export function redactError(text: string): string {
  return text
    .replace(/S[A-Z2-7]{55}/gi, "[redacted]") // secret keys first
    .replace(/C[A-Z2-7]{55}/gi, "[redacted]") // contract IDs
    .replace(/G[A-Z2-7]{55}/gi, "[redacted]"); // public keys
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Optional error reporter invoked after every boundary catch.
   *
   * **Disabled by default** — the boundary logs to the console in development
   * but never calls this prop unless the caller provides one explicitly.
   *
   * The reporter receives an `ErrorReport` with all Stellar addresses, contract
   * IDs, and secret keys replaced by `[redacted]`. Errors thrown inside the
   * reporter are caught and silently ignored so they cannot re-trigger the
   * boundary.
   *
   * To opt in at the app root, build a reporter that posts to your backend and
   * pass it via `VITE_ERROR_REPORT_URL` wiring in `main.tsx`. See
   * `docs/DEPLOYMENT.md` for the full opt-in instructions.
   */
  onError?: ErrorReporter;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught:", error, info.componentStack);
    }

    const { onError } = this.props;
    if (onError) {
      const report: ErrorReport = {
        message: redactError(error.message),
        name: error.name,
        componentStack: redactError(info.componentStack ?? ""),
        timestamp: new Date().toISOString(),
      };
      try {
        onError(report);
      } catch {
        // Swallow reporter errors — never let the reporter re-trigger the boundary.
      }
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="card error-boundary__card">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-danger)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="error-boundary__icon"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted text-sm mb-6">
              An unexpected error occurred. Try reloading the page.
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
