import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        HTMLElement: "readonly",
        KeyboardEvent: "readonly",
        HTMLInputElement: "readonly",
        HTMLDivElement: "readonly",
        clearTimeout: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        Blob: "readonly",
        URL: "readonly",
        performance: "readonly",
        CustomEvent: "readonly",
        RequestInit: "readonly",
        Response: "readonly",
        localStorage: "readonly",
        React: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  prettierConfig,
];
