#!/usr/bin/env node
/**
 * check-node-version.cjs
 *
 * Runs as an `engines` preinstall check.  Exits 1 with a clear message when
 * the running Node version is below the project minimum (22.5.0), which is
 * required for `node:sqlite` (--experimental-sqlite) used by the indexer.
 */

"use strict";

const MIN_MAJOR = 22;
const MIN_MINOR = 5;
const MIN_VERSION = `${MIN_MAJOR}.${MIN_MINOR}.0`;

const [, , nodeMajor, nodeMinor] = process.version
  .replace("v", "")
  .split(".")
  .reduce((acc, v, i) => [...acc, i, Number(v)], [null, null]);

const [major, minor] = process.version
  .replace("v", "")
  .split(".")
  .map(Number);

if (major < MIN_MAJOR || (major === MIN_MAJOR && minor < MIN_MINOR)) {
  process.stderr.write(
    `\nERROR: PayFlow requires Node.js >= ${MIN_VERSION}.\n` +
      `       You are running ${process.version}.\n\n` +
      `       The indexer uses node:sqlite (--experimental-sqlite) which was\n` +
      `       introduced in Node 22.5.0.  Please upgrade:\n\n` +
      `         nvm install 22 && nvm use 22\n` +
      `         # or: https://nodejs.org/en/download\n\n`,
  );
  process.exit(1);
}
