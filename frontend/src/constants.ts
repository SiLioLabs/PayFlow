export const STROOPS_PER_XLM = 10_000_000;
export const MIN_STROOPS = 1n;
export const MAX_STROOPS = 9_000_000_000_000_0000n;

export const BILLING_INTERVALS = [
  { label: "Daily", value: 86_400 },
  { label: "Weekly", value: 604_800 },
  { label: "Monthly (~30d)", value: 2_592_000 },
] satisfies { label: string; value: number }[];

export const DEFAULT_EXPIRATION_LEDGER = 30;

export const CONTRACT_LIMITS = {
  MAX_PAY_PER_USE_AMOUNT: 100_000_000_000n,
  MAX_SUBSCRIPTION_AMOUNT: 1_000_000_000_000n,
  MIN_INTERVAL_SECONDS: 3600,
} as const;
