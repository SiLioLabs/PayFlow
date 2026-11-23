// Vitest 2 (vite-node) strips the `node:` prefix from `node:sqlite` and then
// fails to resolve the bare `sqlite` id. vitest.config.mts aliases that id
// here, and we load the real builtin through Node's own require.
import { createRequire } from "node:module";

const sqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const { DatabaseSync, StatementSync } = sqlite;
