export const STROOPS_PER_XLM = 10_000_000;
export const MIN_STROOPS = 1n;
// Generic UI ceiling: 9e15 stays within Number.MAX_SAFE_INTEGER for XLM conversion.
// Contract actions also enforce the lower caps below, mirrored from contract/src/lib.rs.
export const MAX_STROOPS = 9_000_000_000_000_000n;

export const BILLING_INTERVALS = [
  { label: "Daily", value: 86_400 },
  { label: "Weekly", value: 604_800 },
  { label: "Monthly (~30d)", value: 2_592_000 },
] satisfies { label: string; value: number }[];

export const DEFAULT_EXPIRATION_LEDGER = 30;

export const CONTRACT_LIMITS = {
  MAX_PAY_PER_USE_AMOUNT: 100_000_000_000n,
  MAX_SUBSCRIPTION_AMOUNT: 100_000_000_000_000n,
  MIN_INTERVAL_SECONDS: 86400,
  /** Max addresses per batch_pause_subscriptions call */
  MAX_BATCH_PAUSE: 25,
  /** Max addresses per whitelist_batch_add / whitelist_batch_remove call */
  MAX_BATCH_WHITELIST: 50,
} as const;

/** Hard cap on the number of entries persisted to the address book. */
export const MAX_ADDRESS_BOOK_ENTRIES = 250;