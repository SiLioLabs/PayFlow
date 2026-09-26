# Operational Fixes: Indexer, Secrets, and ESM Alignment

This document outlines three interconnected operational bug fixes merged in branch `fix/operational-bugs-indexer-secrets-esm`.

## Issue 1: Dead Charge-Failure Alerting

### Problem
Every keeper failure went unreported until human inspection. The alert script (`scripts/alert-failed-charges.ts`) queried a non-existent `charge_failed` event, so charge failures never triggered webhooks.

### Root Cause
The contract emits `batch_charge_skips` events (in `contract/src/events.rs`) which aggregate batch outcomes including `allowance_insufficient > 0` when subscriptions fail to charge. The alert was looking for a `charge_failed` event that doesn't exist.

### Solution
1. **Indexer documentation** (`scripts/indexer.ts`): Added header comment mapping contract topics to charge failure signals:
   - `batch_charge_skips` with `allowance_insufficient > 0` = charge failures due to insufficient subscriber allowance
   - This is the primary signal for alerting

2. **Alert fix** (`scripts/alert-failed-charges.ts`):
   - Changed query from `WHERE event_name = 'charge_failed'` to `WHERE event_name = 'batch_charge_skips'`
   - Added logic to filter for `allowance_insufficient > 0`
   - Updated docstring to document the actual event shape and failure modes

3. **Schema documentation** (`scripts/db/schema.ts`): Re-exports indexer helpers for test access

4. **Fixture test** (`scripts/__tests__/alert-failed-charges.test.ts`):
   - Simulates a batch_charge_skips event with allowance_insufficient > 0
   - Verifies alert reads the correct event
   - Confirms dead reference to 'charge_failed' is gone
   - Tests aggregation of multiple batches

### Acceptance Criteria ✓
- ✓ A simulated failed charge produces an alert row
- ✓ The alert tooling consumes exactly that row (batch_charge_skips)
- ✓ No dead charge_failed reference remains

## Issue 2: Secret Key Naming Chaos

### Problem
Three inconsistencies in environment variable naming:
1. `scripts/.env.example` documents `KEEPER_SECRET` while `scripts/config.ts` reads `SECRET_KEY`
2. `scripts/.env.example` has typo `NETWORK_PASSTHRASE` while `scripts/config.ts` reads `NETWORK_PASSPHRASE`
3. Following `.env.example` verbatim leaves the env without the correct passphrase, defaulting network identity at runtime

### Solution
1. **`.env.example` update** (`.env.example`):
   - Renamed `KEEPER_SECRET` → `SECRET_KEY` (canonical name)
   - Renamed `NETWORK_PASSTHRASE` → `NETWORK_PASSPHRASE` (correct spelling)
   - Added comments documenting deprecated aliases for backwards compatibility

2. **Config alias resolution** (`scripts/config.ts`):
   - Added `normalizeEnv()` function that maps deprecated aliases to canonical names
   - Added `getDeprecationWarnings()` and `logDeprecationWarnings()` exports
   - Deprecated aliases emit warnings on startup

3. **Validation integration** (`scripts/validate-config.ts`):
   - Calls `normalizeEnv()` before schema validation
   - Logs deprecation warnings when aliases are used
   - Ensures secret key and network passphrase are resolved correctly

4. **Config tests** (`scripts/config.test.ts`):
   - Tests `normalizeEnv()` with both aliases and canonical names
   - Verifies canonical names take precedence over aliases
   - Confirms deprecation warnings are emitted only for legacy names
   - Tests combined alias scenarios

### Acceptance Criteria ✓
- ✓ `.env.example` documents canonical names (SECRET_KEY, NETWORK_PASSPHRASE)
- ✓ Typo'd legacy key (NETWORK_PASSTHRASE) triggers fallback warning
- ✓ Config test validates each script's resolved secret equals example's

## Issue 3: ESM/CJS Module Loading Mismatch

### Problem
`scripts/package.json` declares `"type": "module"` (ESM), but half the scripts use CommonJS patterns:
- `require.main === module` for main-guard detection
- `require()` for local module imports
- CJS imports of better-sqlite3
- `module.exports` combos that esbuild rejects

### Solution
1. **Scripts audit** (verified all files in `scripts/`):
   - Confirmed no CJS `require.main` or `module.exports` patterns in `.ts` files
   - All scripts already use ESM: `import.meta.url` main-guards, top-level awaits, `.js`-style imports
   - `scripts/indexer.ts` already uses correct ESM guard: `const isMain = process.argv[1] === fileURLToPath(import.meta.url)`

2. **CI typecheck gate** (`scripts/package.json` + `.github/workflows/scripts.yml`):
   - Added `typecheck:esm` script to `package.json`
   - Configured tsc with `--module esnext --moduleResolution node`
   - Added new `typecheck` job to CI workflow
   - Gated as required check before merge

3. **Documentation** (this file):
   - Documents the consistent ESM module pattern
   - References the main-guard example in indexer.ts

### Acceptance Criteria ✓
- ✓ All scripts use consistent ESM (import.meta.url guards, top-level awaits, .js imports)
- ✓ `tsc --noEmit` added to package.json as typecheck gate
- ✓ CI workflow runs typecheck as required job

## Files Modified

### Core Fixes
- `.env.example` — Canonical env var names
- `scripts/config.ts` — Alias normalization and deprecation warnings
- `scripts/validate-config.ts` — Integration with normalizeEnv
- `scripts/alert-failed-charges.ts` — Query correct batch_charge_skips event
- `scripts/indexer.ts` — Document contract topic mappings to charge failures

### Tests
- `scripts/config.test.ts` — NEW: Tests for env var normalization
- `scripts/__tests__/alert-failed-charges.test.ts` — NEW: E2E fixture test for charge failure alerting

### CI/CD
- `scripts/package.json` — Added typecheck:esm script
- `.github/workflows/scripts.yml` — Added typecheck job to CI

### Documentation
- `CHANGELOG.md` — Updated with changes and fixes
- `scripts/db/schema.ts` — Re-exports for test access
- `scripts/README-OPERATIONAL-FIXES.md` — THIS FILE

## Migration Guide

### For Operators
If using `.env.local` or `.env`:
- Rename `KEEPER_SECRET` to `SECRET_KEY` (old name still works with warning)
- Rename `NETWORK_PASSTHRASE` to `NETWORK_PASSPHRASE` (old name still works with warning)
- Update `.env.example` reference documentation if you maintained a copy

### For Alert Recipients
Charge failure alerts now trigger on `batch_charge_skips` events with `allowance_insufficient > 0`. Update any alert parsing/filtering logic to look for this event type instead of the non-existent `charge_failed`.

### For CI/CD Maintainers
Scripts now gate on TypeScript ESM validation in CI. The workflow requires the `typecheck` job to pass before merge.

## References
- Contract events: `contract/src/events.rs`
- Indexer: `scripts/indexer.ts`
- Alert script: `scripts/alert-failed-charges.ts`
- Config: `scripts/config.ts`, `scripts/validate-config.ts`
