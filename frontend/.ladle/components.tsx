/**
 * Ladle global provider — wraps every story with the same light/dark CSS
 * variables that the full app uses so skeleton shimmer, badge colours, and
 * button tokens render correctly without mounting the full React tree.
 */
import React from "react";
import type { GlobalProvider } from "@ladle/react";
import "../src/index.css";

export const Provider: GlobalProvider = ({ children, globalState }) => (
  <div data-theme={globalState.theme === "dark" ? "dark" : "light"} style={{ padding: "1rem" }}>
    {children}
  </div>
);
