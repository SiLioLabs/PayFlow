import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { RpcHealthProvider } from "./context/RpcHealthContext";
import { ShortcutRegistryProvider } from "./context/ShortcutRegistry";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RpcHealthProvider>
      <ShortcutRegistryProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ShortcutRegistryProvider>
    </RpcHealthProvider>
  </React.StrictMode>
);
