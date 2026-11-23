import { vi } from "vitest";
import type {
  MerchantSubscriber,
  ContractEvent,
  SubscriptionHealth,
  ChargeSimResult,
  ContractHealthReport,
  ContractHealthCheckReport,
  ProtocolStats,
  DailyLimitStatus,
} from "../../stellar";

// ── Config ────────────────────────────────────────────────────────────────────
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
export const TOKEN_CONTRACT_ID = "CB64D3BV7P25CBZ76AEGY2FJD2N2Z35TXTLA2HO7DS4SYYBZWAZZTACC";
export const DEFAULT_TOKEN = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

// ── Server & RPC Helpers ──────────────────────────────────────────────────────
export const server = {
  getAccount: vi.fn().mockResolvedValue({ id: "mock-account", sequence: "1" }),
  simulateTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
  getEvents: vi.fn().mockResolvedValue({ events: [], latestLedger: 100 }),
  getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", events: [] }),
  getHealth: vi.fn().mockResolvedValue({ status: "healthy" }),
};

export const getServer = vi.fn(() => server);
export const horizonBaseUrl = vi.fn((passphrase?: string) => "https://horizon-testnet.stellar.org");
export const explorerBaseUrl = vi.fn((passphrase?: string) => "https://stellar.expert/explorer/testnet");
export const explorerTxUrl = vi.fn((hash: string, _passphrase?: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`);
export const isValidContractIdShape = vi.fn((id: string) => typeof id === "string" && id.startsWith("C") && id.length === 56);
export const addressVal = vi.fn();
export const VALIDATION_TIMEOUT_MS = 30_000;
export const simulateContractRead = vi.fn().mockResolvedValue(null);
export const fetchEvents = vi.fn().mockResolvedValue({ events: [] });

// ── Builders ──────────────────────────────────────────────────────────────────
export const buildTx = vi.fn().mockResolvedValue("mock-tx-xdr");
export const buildSubscribeTx = vi.fn().mockResolvedValue("mock-subscribe-xdr");
export const buildCancelTx = vi.fn().mockResolvedValue("mock-cancel-xdr");
export const buildPayPerUseTx = vi.fn().mockResolvedValue("mock-pay-per-use-xdr");
export const buildPayPerUseToTx = vi.fn().mockResolvedValue("mock-pay-per-use-to-xdr");
export const buildPauseTx = vi.fn().mockResolvedValue("mock-pause-xdr");
export const buildPauseUntilTx = vi.fn().mockResolvedValue("mock-pause-until-xdr");
export const buildResumeTx = vi.fn().mockResolvedValue("mock-resume-xdr");
export const buildTransferSubscriptionTx = vi.fn().mockResolvedValue("mock-transfer-xdr");
export const buildSetDailyLimitTx = vi.fn().mockResolvedValue("mock-set-daily-limit-xdr");
export const buildBatchChargeTx = vi.fn().mockResolvedValue("mock-batch-charge-xdr");
export const buildApproveTx = vi.fn().mockResolvedValue("mock-approve-xdr");
export const buildRepairSubscriptionTx = vi.fn().mockResolvedValue("mock-repair-xdr");
export const buildBatchPauseSubscriptionsTx = vi.fn().mockResolvedValue("mock-batch-pause-xdr");
export const buildWhitelistBatchAddTx = vi.fn().mockResolvedValue("mock-whitelist-add-xdr");
export const buildWhitelistBatchRemoveTx = vi.fn().mockResolvedValue("mock-whitelist-remove-xdr");
export const buildExtendSubscriptionTtlTx = vi.fn().mockResolvedValue("mock-extend-ttl-xdr");

// ── Reads ─────────────────────────────────────────────────────────────────────
export const simulateBatchCharge = vi.fn().mockResolvedValue([]);
export const getTrialEnd = vi.fn().mockResolvedValue(null);
export const getDailyLimit = vi.fn().mockResolvedValue(null);
export const getDailySpent = vi.fn().mockResolvedValue(0n);
export const getDayStart = vi.fn().mockResolvedValue(null);
export const getDailyLimitStatus = vi.fn().mockResolvedValue({
  limit: null,
  spent: 0n,
  remaining: null,
  dayActive: false,
  dayStart: null,
});
export const getSubscription = vi.fn().mockResolvedValue(null);
export const getSubscriptionMetadata = vi.fn().mockResolvedValue(null);

export const CHARGE_SIM_RESULTS = [
  "WouldSucceed",
  "NotDue",
  "Inactive",
  "InsufficientAllowance",
  "GracePeriodElapsed",
  "ContractPaused",
  "SubscriptionPaused",
] as const;

export const CHARGE_SIM_LABELS: Record<ChargeSimResult, string> = {
  WouldSucceed: "Next charge would succeed",
  NotDue: "Next charge is not due yet",
  Inactive: "No active subscription to charge",
  InsufficientAllowance: "Allowance is too low for the next charge",
  GracePeriodElapsed: "Grace period has elapsed — recurring charge would fail",
  ContractPaused: "Protocol is paused",
  SubscriptionPaused: "Subscription is paused — charge would fail",
};

export const normalizeSubscriptionHealth = vi.fn(
  (raw: Partial<SubscriptionHealth> | null | undefined): SubscriptionHealth | null => {
    if (!raw) return null;
    return {
      active: !!raw.active,
      charge_due: !!raw.charge_due,
      within_grace: !!raw.within_grace,
      has_sufficient_allowance: !!raw.has_sufficient_allowance,
      is_paused: !!raw.is_paused,
      trial_active: !!raw.trial_active,
      daily_limit_set: !!raw.daily_limit_set,
    };
  }
);

export const isSubscriptionHealthy = vi.fn(
  (health: SubscriptionHealth) => health.active && health.has_sufficient_allowance && !health.is_paused
);
export const subscriptionHasWarnings = vi.fn(
  (health: SubscriptionHealth) => !isSubscriptionHealthy(health) || health.within_grace || health.charge_due
);
export const subscriptionHealthBlocksPay = vi.fn(
  (health: SubscriptionHealth | null) => (!health ? false : !health.active || health.is_paused)
);
export const chargeSimIsRisky = vi.fn((result: ChargeSimResult | null) =>
  result === "InsufficientAllowance" ||
  result === "GracePeriodElapsed" ||
  result === "ContractPaused" ||
  result === "SubscriptionPaused" ||
  result === "Inactive"
);
export const chargeSimBlocksPay = vi.fn((result: ChargeSimResult | null) =>
  result === "ContractPaused" || result === "SubscriptionPaused" || result === "Inactive"
);
export const payBlockedReason = vi.fn((health: SubscriptionHealth | null, sim: ChargeSimResult | null) => {
  if (health?.is_paused || sim === "SubscriptionPaused") {
    return "Pay-per-use is unavailable while the subscription is paused. Resume first.";
  }
  if ((health && !health.active) || sim === "Inactive") {
    return "Pay-per-use requires an active subscription.";
  }
  if (sim === "ContractPaused") {
    return "Pay-per-use is unavailable while the protocol is paused.";
  }
  return null;
});
export const payWarningReason = vi.fn((health: SubscriptionHealth | null, sim: ChargeSimResult | null) => {
  if (payBlockedReason(health, sim)) return null;
  if ((health && !health.has_sufficient_allowance) || sim === "InsufficientAllowance") {
    return "Token allowance is insufficient. Increase allowance before paying or the charge may fail.";
  }
  if (health?.within_grace) return "Subscription is in its grace period. Recurring charge is overdue.";
  if (sim === "GracePeriodElapsed") return "Grace period has elapsed. Recurring charge would fail until the subscription is repaired.";
  if (health?.charge_due) return "A recurring charge is currently due.";
  return null;
});

export const decodeChargeSimResult = vi.fn().mockReturnValue(null);
export const getSubscriptionHealth = vi.fn().mockResolvedValue(null);
export const simulateCharge = vi.fn().mockResolvedValue(null);
export const getMerchantSubscribers = vi.fn().mockResolvedValue([]);
export const getMerchantRevenueHistory = vi.fn().mockResolvedValue([]);
export const getMerchantRevenue = vi.fn().mockResolvedValue(0n);
export const getBalance = vi.fn().mockResolvedValue("0");
export const getTokenBalance = vi.fn().mockResolvedValue(0n);
export const getAllowance = vi.fn().mockResolvedValue(0n);
export const getChargeHistory = vi.fn().mockResolvedValue([]);
export const getContractPaused = vi.fn().mockResolvedValue(false);
export const getContractHealth = vi.fn().mockResolvedValue({
  rpcReachable: true,
  contractPaused: false,
  tokenConfigured: true,
  activeSubscriptions: 0,
  subscriptionTtlLedgers: null,
  checkedAt: new Date(),
});
export const getProtocolStats = vi.fn().mockResolvedValue(null);
export const getContractHealthCheck = vi.fn().mockResolvedValue(null);
export const getContractAdmin = vi.fn().mockResolvedValue(null);
export const validateSubscription = vi.fn().mockResolvedValue({
  isValid: true,
  violations: [],
  missingRecords: [],
  invalidStateTransitions: [],
  corruptedReferences: [],
});
export const parseSubscriptionRepairedEvent = vi.fn().mockResolvedValue(null);
export const isArchivedError = vi.fn((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /entryexpired|archived|ttl.*expired|-32700/i.test(msg);
});
export const estimateExtendTtlFee = vi.fn().mockResolvedValue(null);
export const getSubscriptionToken = vi.fn().mockResolvedValue(null);
export const getReferral = vi.fn().mockResolvedValue(null);
export const getReferrer = vi.fn().mockResolvedValue(null);
