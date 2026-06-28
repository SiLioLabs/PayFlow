import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { RpcHealthProvider } from "./context/RpcHealthContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RpcHealthProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </RpcHealthProvider>
  </React.StrictMode>
);
