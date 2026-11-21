/** localStorage key under which the user's custom RPC URL is persisted. */
export const CUSTOM_RPC_URL_KEY = "flowpay_custom_rpc_url";

/** Read and parse the stored custom RPC URL. Returns null on missing/invalid. */
export function readCustomRpcUrl(): string | null {
  try {
    const raw = localStorage.getItem(CUSTOM_RPC_URL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string;
    return parsed && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Stroops in 1 XLM (Number form — safe for display arithmetic). */
export const STROOPS_PER_XLM = 10_000_000;
/** Stroops in 1 XLM (BigInt form — required for precision-safe conversions). */
export const STROOPS_PER_XLM_BIGINT = BigInt(STROOPS_PER_XLM);
export const MIN_STROOPS = 1n;

/** Seconds in a day — mirrors MIN_INTERVAL_SECONDS in CONTRACT_LIMITS. */
export const SECONDS_PER_DAY = 86_400;
/** Seconds in a 7-day week. */
export const SECONDS_PER_WEEK = 604_800;
/** Seconds in a 30-day "month" (the billing cycle approximation used by the UI). */
export const SECONDS_PER_MONTH = 2_592_000;
// Generic UI ceiling: 9e15 stays within Number.MAX_SAFE_INTEGER for XLM conversion.
// Contract actions also enforce the lower caps below, mirrored from contract/src/lib.rs.
export const MAX_STROOPS = 9_000_000_000_000_000n;

export const BILLING_INTERVALS = [
  { label: "Daily", value: SECONDS_PER_DAY },
  { label: "Weekly", value: SECONDS_PER_WEEK },
  { label: "Monthly (~30d)", value: SECONDS_PER_MONTH },
] satisfies { label: string; value: number }[];

export const DEFAULT_EXPIRATION_LEDGER = 30;

/**
 * Hard limits enforced by the on-chain contract.
 *
 * Source of truth: `contract/src/caps.rs` (batch and page caps) together with
 * the amount/interval guards in `contract/src/lib.rs`. The operator-facing table
 * built from the batch caps lives in `docs/LIMITS.md`; `node
 * scripts/emit-caps-table.mjs --check` fails the build's doc check when the two
 * disagree.
 *
 * Frontend callers must read these values from here rather than re-declaring
 * them, so a cap change on the contract side propagates to the UI in one place.
 */
export const CONTRACT_LIMITS = {
  /** Max `amount` accepted by `pay_per_use()` — contract/src/lib.rs. */
  MAX_PAY_PER_USE_AMOUNT: 100_000_000_000n,
  /** Max `amount` accepted by `subscribe()` — contract/src/lib.rs. */
  MAX_SUBSCRIPTION_AMOUNT: 100_000_000_000_000n,
  /** Min `interval` (seconds) accepted by `subscribe()` — one day. */
  MIN_INTERVAL_SECONDS: SECONDS_PER_DAY,
  /**
   * Max addresses per `batch_pause_subscriptions` / `batch_cancel` call.
   * Mirrors `caps::MAX_BATCH_PAUSE_SUBSCRIPTIONS` in contract/src/caps.rs.
   */
  MAX_BATCH_PAUSE: 25,
  /**
   * Max addresses per `whitelist_batch_add` / `whitelist_batch_remove` call.
   * Mirrors `caps::MAX_WHITELIST_BATCH_SIZE` in contract/src/caps.rs.
   */
  MAX_BATCH_WHITELIST: 50,
} as const;

/** Hard cap on the number of entries persisted to the address book. */
export const MAX_ADDRESS_BOOK_ENTRIES = 250;