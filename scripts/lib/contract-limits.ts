/**
 * contract-limits.ts — Single source of truth for contract-derived constants.
 *
 * Every value here **mirrors** a constant defined in the Rust contract source.
 * When a contract constant changes, update both this file and the corresponding
 * Rust file, then run:
 *
 *   node scripts/emit-caps-table.mjs --check
 *
 * to verify that docs/LIMITS.md is still consistent.
 *
 * Source cross-references
 * ───────────────────────
 *  Constant                    │ Rust source
 *  ────────────────────────────┼──────────────────────────────────────────────
 *  CURRENT_SCHEMA_VERSION      │ contract/src/migration.rs   CURRENT_VERSION
 *  MAX_BATCH_SIZE              │ contract/src/batch.rs       MAX_BATCH_SIZE
 *  MAX_BATCH_SIZE_CEILING      │ contract/src/lib.rs         set_max_batch_size (guard: size > 200)
 *  MAX_BATCH_PAUSE             │ contract/src/lib.rs         MAX_BATCH_PAUSE_SUBSCRIPTIONS
 *  MAX_WHITELIST_BATCH         │ contract/src/lib.rs         MAX_WHITELIST_BATCH_SIZE
 *  SUBSCRIPTION_TTL_LEDGERS    │ contract/src/lib.rs         SUBSCRIPTION_TTL_LEDGERS
 *  GLOBAL_MAX_VOLUME_PER_HOUR  │ contract/src/lib.rs         GLOBAL_MAX_VOLUME_PER_HOUR
 *  MAX_AMOUNT                  │ contract/src/lib.rs         MAX_AMOUNT
 *  MAX_SUBSCRIPTION_AMOUNT     │ contract/src/lib.rs         MAX_SUBSCRIPTION_AMOUNT
 *  LEDGERS_PER_DAY             │ contract/src/spending_limit.rs LEDGERS_PER_DAY
 *  UPGRADE_TTL_LEDGERS         │ contract/src/upgrade.rs     (extend_ttl value: 17280)
 *  XLM_DECIMALS                │ Stellar protocol            XLM uses 7 decimal places
 *
 * Stroop divisor
 * ──────────────
 * XLM amounts on Stellar are stored in "stroops" — the smallest indivisible
 * unit.  1 XLM = 10^7 stroops (XLM_DECIMALS = 7).
 *
 * IMPORTANT: Other SAC tokens (non-XLM) may have a different number of
 * decimal places.  Do NOT use XLM_DECIMALS as the divisor for arbitrary tokens.
 * Instead, query the token's `decimals()` entry-point or pass the decimal count
 * explicitly (see allowance-utils.ts:formatTokenAmount).
 */

// ── Schema version ────────────────────────────────────────────────────────────

/**
 * Current contract storage schema version.
 * Mirrors contract/src/migration.rs: CURRENT_VERSION = 2.
 */
export const CURRENT_SCHEMA_VERSION = 2;

// ── Batch sizes ───────────────────────────────────────────────────────────────

/**
 * Default maximum number of users processed in a single batch_charge call.
 * Mirrors contract/src/batch.rs: MAX_BATCH_SIZE = 50.
 */
export const MAX_BATCH_SIZE = 50;

/**
 * Hard ceiling on the configurable batch size (set_max_batch_size rejects values above this).
 * Mirrors contract/src/lib.rs: set_max_batch_size guard (size > 200).
 */
export const MAX_BATCH_SIZE_CEILING = 200;

/**
 * Maximum number of subscriptions that can be paused in a single call.
 * Mirrors contract/src/lib.rs: MAX_BATCH_PAUSE_SUBSCRIPTIONS = 25.
 */
export const MAX_BATCH_PAUSE = 25;

/**
 * Maximum number of addresses in a single whitelist batch operation.
 * Mirrors contract/src/lib.rs: MAX_WHITELIST_BATCH_SIZE = 50.
 */
export const MAX_WHITELIST_BATCH = 50;

// ── Ledger-time constants ─────────────────────────────────────────────────────

/**
 * Approximate number of ledgers closed in one day on Stellar (~5 s/ledger).
 * Mirrors contract/src/spending_limit.rs: LEDGERS_PER_DAY = 17_280.
 * Also used as the TTL for pending upgrades in contract/src/upgrade.rs.
 *
 * NOTE: Based on the ~5 s/ledger assumption — validate against the live
 * network if precision matters.
 */
export const LEDGERS_PER_DAY = 17_280;

/**
 * TTL applied to pending WASM upgrade proposals (in ledgers).
 * Mirrors contract/src/upgrade.rs extend_ttl call (17_280).
 * Intentionally equals LEDGERS_PER_DAY — proposals expire after ~24 h.
 */
export const UPGRADE_TTL_LEDGERS = LEDGERS_PER_DAY;

/**
 * TTL for active subscriptions in persistent storage (~1 year).
 * Mirrors contract/src/lib.rs: SUBSCRIPTION_TTL_LEDGERS = 6_307_200.
 */
export const SUBSCRIPTION_TTL_LEDGERS = 6_307_200;

// ── Amount limits ─────────────────────────────────────────────────────────────

/**
 * Maximum amount for a single pay-per-use transaction (in token base units).
 * Mirrors contract/src/lib.rs: MAX_AMOUNT = 100_000_000_000.
 */
export const MAX_AMOUNT = 100_000_000_000n;

/**
 * Maximum amount for a subscription charge (in token base units).
 * Mirrors contract/src/lib.rs: MAX_SUBSCRIPTION_AMOUNT = 100_000_000_000_000.
 */
export const MAX_SUBSCRIPTION_AMOUNT = 100_000_000_000_000n;

/**
 * Global maximum token volume processed per hour across all merchants (in token base units).
 * Mirrors contract/src/lib.rs: GLOBAL_MAX_VOLUME_PER_HOUR = 50_000_000_000_000.
 */
export const GLOBAL_MAX_VOLUME_PER_HOUR = 50_000_000_000_000n;

// ── Token decimals ────────────────────────────────────────────────────────────

/**
 * Number of decimal places for the XLM native token (and most SAC tokens).
 * 1 XLM = 10^XLM_DECIMALS stroops = 10_000_000 stroops.
 *
 * WARNING: This is specific to XLM and XLM-derived SAC tokens.
 * Non-XLM SEP-41 tokens may use a different decimal count — query
 * the token's `decimals()` entry-point rather than hard-coding this value.
 */
export const XLM_DECIMALS = 7;

/**
 * Number of stroops in one XLM (10^7).
 * Convenience alias: use this when dealing specifically with XLM amounts.
 *
 * WARNING: Do NOT use for non-XLM token amounts — see XLM_DECIMALS note above.
 */
export const STROOPS_PER_XLM = 10 ** XLM_DECIMALS; // 10_000_000

// ── Hour constant ─────────────────────────────────────────────────────────────

/**
 * Number of seconds in one hour.
 * Mirrors contract/src/lib.rs: HOUR_IN_SECONDS = 3600.
 */
export const HOUR_IN_SECONDS = 3_600;
