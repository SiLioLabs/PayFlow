#!/usr/bin/env bash
# scripts/check-root-hygiene.sh
#
# CI hygiene guard for issue #1488.
# Fails if any stray source file appears at the repo root that belongs in
# scripts/, contract/, or vesting/.
#
# Usage:
#   bash scripts/check-root-hygiene.sh
#
# Exit codes:
#   0 — repo root is clean
#   1 — one or more unexpected files found (prints offenders to stderr)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# File extensions that should NOT live at the repo root.
# .mjs/.cjs utilities (like check-doc-links.mjs) are intentional at root.
BANNED_EXTENSIONS=(ts rs)

# Explicit filenames that are always forbidden at the root.
BANNED_NAMES=(0 md)

FAILURES=()

for ext in "${BANNED_EXTENSIONS[@]}"; do
  while IFS= read -r -d '' file; do
    # Allow package.json sibling config files that are intentionally at root.
    FAILURES+=("$file")
  done < <(find "$REPO_ROOT" -maxdepth 1 -name "*.$ext" -print0 2>/dev/null)
done

for name in "${BANNED_NAMES[@]}"; do
  if [[ -e "$REPO_ROOT/$name" ]]; then
    FAILURES+=("$REPO_ROOT/$name")
  fi
done

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "ERROR: Stray source files found at the repo root:" >&2
  for f in "${FAILURES[@]}"; do
    echo "  $f" >&2
  done
  echo "" >&2
  echo "Move them to their canonical location (scripts/, contract/src/, etc.)" >&2
  echo "or delete them if they are obsolete duplicates." >&2
  exit 1
fi

echo "Root hygiene check passed — no stray source files at repo root."
