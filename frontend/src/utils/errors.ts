/**
 * Customer-facing messages for FlowPay contract errors.
 *
 * CANONICAL SOURCE: `contract/src/errors.rs` — the `ContractError` enum is the
 * wire contract for every numeric code below. This map derives from it and is
 * checked against it: `src/utils/errors.test.ts` parses `errors.rs` at test
 * time and fails if a code is missing here, duplicated here, or mapped to two
 * different messages. Change a variant there and that test fails here.
 *
 * Conformance table (code → `ContractError` variant):
 *
 *    1 AlreadyInitialized              17 SubscriptionPaused         33 InvalidVolumeCap
 *    2 AmountMustBePositive           18 ContractPaused             34 InvalidFeeBounds
 *    3 IntervalMustBePositive         19 IntervalTooShort           35 FeeOutOfBoundsAtCommit
 *    4 NoSubscriptionFound            20 BatchTooLarge              36 ArithmeticOverflow
 *    5 SubscriptionInactive            21 ZeroBalanceAvailable       37 — catalog gap, no variant
 *    6 IntervalNotElapsed             22 MerchantFrozen             38 RefundMerchantMismatch
 *    7 NotInitialized                 23 NoPendingProposal          39 RefundAmountMustBePositive
 *    8 InsufficientAllowance          24 SubscriptionAlreadyActive  40 InsufficientMerchantBalance
 *    9 GracePeriodElapsed             25 DailyLimitExceeded         41 CannotClearActiveSubscriber
 *   10 MerchantNotWhitelisted         26 InvalidFeeCollector        42 SchemaMigrationRequired
 *   11 SelfReferral                   27 InvalidPauseExpiry         43 ResumeGraceLapsed
 *   12 InvalidTokenAddress            28 GlobalVolumeExceeded       44 AdminAlreadySet
 *   13 InvalidFeeBps                  29 InvalidBatchSize           45 NoPendingAdmin
 *   14 MetadataLabelTooLong           30 ContractPausedError (dep.) 31 Reserved31 (reserved)
 *   15 AmountExceedsMaximum           32 InvalidRecipient
 *   16 SubscriptionNotActive          —
 *
 * Codes 30 and 31 (deprecated / reserved) and 37 (catalog gap) are documented
 * and mapped, not dropped — see the inline notes at those codes below.
 */
export const CONTRACT_ERRORS: Record<string, string> = {
  // ── Canonical contract codes ───────────────────────────────────────────────
  // One key per code, `error(contract, #N)`. These keys are lowercase because
  // `friendlyError` lowercases the raw error before matching: a capitalised key
  // such as "error(Contract, #18)" can never match anything, which is how a
  // second, contradictory message for code 18 survived here.
  "error(contract, #1)": "Contract is already set up.",
  "error(contract, #2)": "Amount must be greater than zero.",
  "error(contract, #3)": "Billing interval must be greater than zero.",
  "error(contract, #4)": "No subscription found. Please subscribe first.",
  "error(contract, #5)": "This subscription has been cancelled.",
  "error(contract, #6)": "Your next charge date hasn't arrived yet.",
  "error(contract, #7)": "Contract is not set up yet. Service temporarily unavailable.",
  "error(contract, #8)": "Increase your token allowance and try again.",
  "error(contract, #9)": "This subscription lapsed. Please subscribe again.",
  "error(contract, #10)": "This merchant is not whitelisted. Ask the protocol admin to add them first.",
  "error(contract, #11)": "You cannot refer yourself.",
  "error(contract, #12)": "Invalid token address.",
  "error(contract, #13)": "Invalid fee configuration.",
  "error(contract, #14)": "Label must be 64 bytes or fewer.",
  "error(contract, #15)": "Amount exceeds maximum.",
  "error(contract, #16)": "Subscription is not active.",
  "error(contract, #17)": "Resume your subscription to continue.",
  // Code 18 is ContractPaused (admin pause). It previously carried two different
  // messages; the one below is the single canonical wording and matches the
  // legacy "contract paused" string variants further down.
  "error(contract, #18)": "Payments are temporarily paused by the contract administrator.",
  "error(contract, #19)": "Interval is too short.",
  "error(contract, #20)": "Batch too large.",
  "error(contract, #21)": "You have no withdrawable revenue yet.",
  "error(contract, #22)": "This merchant is temporarily unavailable.",
  "error(contract, #23)": "No pending proposal.",
  "error(contract, #24)": "Destination already has an active subscription.",
  "error(contract, #25)": "Daily spending limit reached. Try a smaller amount or wait.",
  "error(contract, #26)": "Invalid fee collector.",
  "error(contract, #27)": "Pick a pause end time in the future.",
  "error(contract, #28)": "Protocol capacity reached; try later.",
  "error(contract, #29)": "Invalid batch size.",
  // Code 30 `ContractPausedError` — DEPRECATED alias of ContractPaused (18).
  // Documented, not dropped: a contract deployed before the alias was retired
  // can still emit it, and an unmapped code falls through to the raw panic text.
  // It previously carried two further messages ("Service temporarily
  // unavailable." and the admin-pause text) under different key casings.
  "error(contract, #30)": "Payments are temporarily paused by the contract administrator.",
  // Code 31 `Reserved31` — reserved gap in the catalog, never emitted.
  "error(contract, #31)": "This error code is reserved and is not used by the current contract.",
  "error(contract, #32)": "Invalid recipient.",
  "error(contract, #33)": "Invalid volume cap.",
  "error(contract, #34)": "Invalid fee bounds.",
  "error(contract, #35)": "Fee out of bounds at commit.",
  "error(contract, #36)": "Arithmetic overflow.",
  // Code 37 — historical gap in the catalog: no `ContractError` variant holds
  // this code and none is planned. Kept mapped so a stray 37 cannot reach the
  // user as raw panic text; remove only if a variant ever claims this code.
  "error(contract, #37)": "This error code is not used by the current contract.",
  "error(contract, #38)": "Refund can only be issued by the subscription's merchant.",
  "error(contract, #39)": "Prorated refund amount is zero; nothing to refund.",
  "error(contract, #40)": "Merchant has insufficient balance to fund this refund.",
  "error(contract, #41)": "Cannot clear active subscriber.",
  "error(contract, #42)": "Contract storage must be migrated before this operation.",
  "error(contract, #43)": "Subscription grace period has lapsed; please re-subscribe.",
  "error(contract, #44)": "Contract admin is already set.",
  // 45 `NoPendingAdmin` — `accept_admin` called with no staged transfer.
  "error(contract, #45)": "There is no pending admin transfer to accept.",

  // ── Bare-code aliases ──────────────────────────────────────────────────────
  // For transports that surface just the number ("#18", "ContractError #18").
  // Every alias repeats its code's canonical message verbatim — the conformance
  // test asserts that, so an alias can never drift into a second wording.
  //
  // Only two-digit codes are aliased. `friendlyError` matches by substring, so
  // a bare "#2" would also match "error(contract, #24)" and report the wrong
  // condition; every single-digit code (1–9) is a prefix of a two-digit one.
  "#10": "This merchant is not whitelisted. Ask the protocol admin to add them first.",
  "#18": "Payments are temporarily paused by the contract administrator.",
  "#21": "You have no withdrawable revenue yet.",
  "#24": "Destination already has an active subscription.",
  "#30": "Payments are temporarily paused by the contract administrator.",

  // ── Legacy string variants ────────────────────────────────────────────────
  // Pre-typed-error panic strings from older deployments, kept for wire
  // compatibility. These are a separate namespace from the numeric codes above
  // and keep their original wording.
  "interval not elapsed yet": "Your next charge date hasn't arrived yet.",
  "subscription is not active": "This subscription has been cancelled.",
  "no subscription found": "No subscription found. Please subscribe first.",
  "already initialized": "Contract is already set up.",
  "amount must be positive": "Amount must be greater than zero.",
  "interval must be positive": "Billing interval must be greater than zero.",
  "contract paused": "Payments are temporarily paused by the contract administrator.",
  "contractpaused": "Payments are temporarily paused by the contract administrator.",
  // Pre-`initialize` admin reads now abort with the typed
  // `error(contract, #7)` (NotInitialized) instead of the old
  // "admin not set" host panic string, so no string key is needed here.
  "merchantnotwhitelisted": "This merchant is not whitelisted. Ask the protocol admin to add them first.",
  "merchant not whitelisted": "This merchant is not whitelisted. Ask the protocol admin to add them first.",
  "zerobalanceavailable": "You have no withdrawable revenue yet.",
  require_auth: "Wallet authorization required. Connect as the contract admin.",
  entryexpired:
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  archived:
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  "-32700":
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
};

export function friendlyError(raw: string): string {
  const normalized = raw.toLowerCase();

  for (const [panic, message] of Object.entries(CONTRACT_ERRORS)) {
    if (normalized.includes(panic)) {
      return message;
    }
  }

  return raw;
}
