# Documentation Guards

PayFlow includes automated scripts to ensure documentation quality and consistency. These guards validate links, error codes, limits, and table formatting.

## Overview

Five guard scripts run automatically on every PR that modifies `*.md` files or anything in the `docs/` directory:

| Guard | File | Purpose |
|-------|------|---------|
| **check-doc-links** | `scripts/check-doc-links.mjs` | Validates that all markdown links point to existing files and valid anchors |
| **check-error-codes** | `scripts/check-error-codes.mjs` | Ensures error codes in docs match contract definitions |
| **check-quicklinks** | `scripts/check-quicklinks.mjs` | Verifies core documentation files exist and common references are valid |
| **test-limits-claims** | `scripts/test-limits-claims.mjs` | Checks that documented limits match contract constants |
| **test-caps-table** | `scripts/test-caps-table.mjs` | Validates markdown table structure and formatting |

## Running Locally

### Run All Guards

```bash
npm run docs:check-all
```

This runs all five guards in sequence. If any fails, the entire command exits with code 1.

### Run Individual Guards

```bash
# Check for broken documentation links
npm run docs:check-links

# Check error codes against contract
npm run docs:check-errors

# Check quicklinks and core files
npm run docs:check-quicklinks

# Check documented limits
npm run docs:test-limits

# Check table formatting
npm run docs:test-tables
```

## In CI

The `.github/workflows/docs.yml` workflow runs all five guards on:

- Push to `master` with `*.md` or `docs/**` changes
- Pull requests to `master` with `*.md` or `docs/**` changes

Each guard runs in parallel as a separate job. If any guard fails, the PR cannot be merged.

### Viewing CI Results

After pushing a branch or opening a PR:

1. Go to the PR page on GitHub
2. Scroll to the "Checks" section
3. Each guard shows as a separate check:
   - ✅ **Passed** — Guard completed successfully
   - ❌ **Failed** — Guard found issues (expand to see details)
4. Click "Details" on a failed check to see the full output

## Guard Details

### check-doc-links

**What it checks:**
- All markdown links point to existing files
- All anchor links to target files exist
- Relative paths resolve correctly from the current directory

**What it ignores:**
- External links (`http://`, `https://`)
- Anchor-only links within the same file

**Example failure:**

```
❌ Broken link in docs/API.md:42
   Link: [Architecture Overview](ARCHITECTURE.md)
   File not found: docs/ARCHITECTURE.md
```

**Fix:** Correct the file path or create the referenced file.

---

### check-error-codes

**What it checks:**
- Error codes mentioned in docs are defined in `contract/src/errors.rs`
- Warns about undocumented error references

**What it ignores:**
- Common false positives (HTTP, UUID, API, SDK, etc.)
- External error specifications

**Example warning:**

```
⚠️  Potential undocumented error in docs/API.md:15
    Code reference: ERR_INVALID_TOKEN
    This code may not be defined in contract/src/errors.rs
```

**Fix:** Either define the error in the contract or remove it from docs. This is informational and does not block PRs.

---

### check-quicklinks

**What it checks:**
- Core documentation files exist
- Common references to standard files are valid

**Example failure:**

```
❌ Missing expected documentation: docs/TESTING.md
```

**Fix:** Create the missing file or update references to point to an existing file.

---

### test-limits-claims

**What it checks:**
- Documented limits are consistent with `contract/src/limits.rs`
- Claims about max amounts, thresholds, and retention periods are accurate

**What it ignores:**
- If `limits.rs` doesn't exist (planned dependencies)
- General number mentions in prose

**Example warning:**

```
⚠️  Documentation references different limit values than contract defines
```

**Fix:** Update docs to match the contract, or update the contract and re-run.

---

### test-caps-table

**What it checks:**
- All markdown tables have valid structure (pipes and dashes)
- Header/separator/body row column counts match
- Separator uses valid markdown (dashes with optional colons: `-`, `:-`, `-:`, `:-:`)

**Example failure:**

```
❌ Table error in docs/API.md:10
   Row 1 has 3 cells but header has 4
```

**Fix:** Add or remove cells to match the header count, or fix the header itself.

---

## Common Issues & Solutions

### "Broken link: File not found"

**Cause:** You linked to a file that doesn't exist.

**Solution:** 
- Verify the file path is correct (case-sensitive on Linux/Mac)
- Create the file if it's supposed to exist
- Fix the link if the file is at a different path

### "Broken anchor: Anchor not found"

**Cause:** You linked to a heading that doesn't exist or has a typo.

**Solution:**
- Check the exact heading text in the target file
- Anchors are auto-generated from heading text: lowercase, spaces → hyphens, special chars removed
- Example: `## API Reference` → anchor is `#api-reference`

### "Table error: Row X has Y cells but header has Z"

**Cause:** Your markdown table has inconsistent column counts.

**Solution:**
- Count pipes `|` in the header row
- Ensure every data row has the same number of pipes
- Add `|` separators or empty cells to match

### "Missing expected documentation"

**Cause:** Core docs are missing (e.g., `docs/TESTING.md`).

**Solution:**
- Create the missing file, or
- Update references if the file was renamed

## Continuous Improvement

These guards can be extended with new checks:

1. Add a new script in `scripts/` following the existing patterns
2. Add it to `.github/workflows/docs.yml` in the matrix
3. Add an npm script entry in `package.json`
4. Document it in this file

Example new guard idea: checking that code examples in docs are syntactically valid.

## Disabling a Guard (Rare)

If a guard is producing false positives and needs fixes:

1. **Temporary disable:** Comment out the job in `.github/workflows/docs.yml`
2. **Fix the guard:** Update the script logic
3. **Re-enable:** Uncomment and test locally first with `npm run docs:check-all`

Do not merge PRs that disable guards permanently without discussion.

## References

- Guard scripts: `scripts/check-*.mjs`, `scripts/test-*.mjs`
- CI workflow: `.github/workflows/docs.yml`
- Local npm scripts: `package.json` (search for `docs:`)
