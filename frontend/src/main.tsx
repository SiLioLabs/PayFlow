import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary, { type ErrorReporter } from "./components/ErrorBoundary";
import { RpcHealthProvider } from "./context/RpcHealthContext";
import { ShortcutRegistryProvider } from "./context/ShortcutRegistry";
import "./index.css";

// ── Optional error reporter ───────────────────────────────────────────────────
// Disabled by default. Set VITE_ERROR_REPORT_URL in your environment to opt in.
// The reporter sends a POST with the pre-redacted ErrorReport payload (JSON).
// All Stellar addresses, contract IDs, and secret keys are stripped by the
// boundary before the payload reaches this callback — see ErrorBoundary.tsx.
const reportUrl: string | undefined = import.meta.env.VITE_ERROR_REPORT_URL;

const errorReporter: ErrorReporter | undefined = reportUrl
  ? (report) => {
      // Fire-and-forget; failures are silently dropped so a broken endpoint
      // cannot affect the user experience.
      fetch(reportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
        keepalive: true,
      }).catch(() => {});
    }
  : undefined;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RpcHealthProvider>
      <ShortcutRegistryProvider>
        <ErrorBoundary onError={errorReporter}>
          <App />
        </ErrorBoundary>
      </ShortcutRegistryProvider>
    </RpcHealthProvider>
  </React.StrictMode>
);
