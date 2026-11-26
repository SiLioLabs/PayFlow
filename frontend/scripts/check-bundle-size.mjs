import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KIB = 1024;
const DEFAULT_BUDGETS = {
  "stellar-sdk": 500 * KIB,
  "react-vendor": 200 * KIB,
  default: 300 * KIB,
};

export function evaluateBundleSizes(assets, budgets = DEFAULT_BUDGETS) {
  return assets.map(({ name, size }) => {
    const chunk = name.startsWith("stellar-sdk-")
      ? "stellar-sdk"
      : name.startsWith("react-vendor-")
        ? "react-vendor"
        : "default";
    const budget = budgets[chunk];

    return { name, size, budget, overBudget: size > budget };
  });
}

function checkBuildOutput() {
  const assetsDirectory = fileURLToPath(new URL("../dist/assets/", import.meta.url));
  const assets = readdirSync(assetsDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({
      name,
      size: statSync(join(assetsDirectory, name)).size,
    }));

  if (assets.length === 0) {
    throw new Error(`No JavaScript assets found in ${assetsDirectory}`);
  }

  const results = evaluateBundleSizes(assets);
  for (const { name, size, budget, overBudget } of results) {
    const status = overBudget ? "OVER BUDGET" : "OK";
    console.log(
      `${status}: ${name} — ${(size / KIB).toFixed(1)} KiB / ${(budget / KIB).toFixed(0)} KiB`,
    );
  }

  if (results.some(({ overBudget }) => overBudget)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkBuildOutput();
  } catch (error) {
    console.error(`Bundle size check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
