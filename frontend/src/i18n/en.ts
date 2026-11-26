/**
 * English (en) message catalog — the single source of truth for all
 * user-visible strings in the core flows.
 *
 * Keys follow a namespaced dot-path: `<area>.<specific>`.
 * Values must be plain strings; use {placeholder} notation for interpolation
 * (resolved by the `t()` function in `i18n/index.tsx`).
 *
 * HOW TO ADD A STRING
 * 1. Add a key+value here.
 * 2. Call `t("your.key")` in the component (or `t("your.key", { x: val })`).
 * 3. The catalog conformance test in `src/utils/i18n.test.ts` will catch any
 *    key referenced in the code that is missing from this file.
 *
 * HOW TO ADD A LANGUAGE
 * Create `src/i18n/<locale>.ts` with the same key set, then register it in
 * `src/i18n/index.tsx`'s CATALOGS map.
 */

export const en: Record<string, string> = {
  // ── Subscribe form ─────────────────────────────────────────────────────────
  "subscribe.title": "New Subscription",
  "subscribe.merchant.label": "Merchant address",
  "subscribe.merchant.placeholder": "G…",
  "subscribe.merchant.addressBook": "Select from Address Book",
  "subscribe.amount.label": "Amount",
  "subscribe.token.label": "Token Address",
  "subscribe.token.placeholder": "Token Address G…",
  "subscribe.referrer.label": "Referrer (optional)",
  "subscribe.referrer.placeholder": "Optional referrer G…",
  "subscribe.submit": "Subscribe",
  "subscribe.submit.pending": "Confirming…",
  "subscribe.submit.validating": "Validating…",
  "subscribe.submit.ariaOffline": "Subscribe (unavailable while offline)",
  "subscribe.submit.ariaPaused": "Subscribe (unavailable during maintenance)",
  "subscribe.submit.titleOffline": "You're offline — wallet actions are unavailable",
  "subscribe.success": "Subscribed!",
  "subscribe.announced.submitted": "Transaction submitted",
  "subscribe.announced.confirmed": "Transaction confirmed",
  "subscribe.validation.invalidAddress": "Invalid Stellar address format",
  "subscribe.validation.selfReferral": "Cannot refer yourself — the contract will reject this",

  // ── Subscription card ──────────────────────────────────────────────────────
  "card.cancel": "Cancel",
  "card.pause": "Pause",
  "card.resume": "Resume",
  "card.pauseUntil": "Pause until…",
  "card.transfer": "Transfer",
  "card.status.active": "Active",
  "card.status.paused": "Paused",
  "card.status.cancelled": "Cancelled",
  "card.status.trial": "Trial",
  "card.pause.success": "Paused successfully.",
  "card.pause.pending": "Pausing…",
  "card.pause.until": "Paused until {date}.",
  "card.resume.scheduledAt": "Scheduled to resume {date}",
  "card.allowance.healthy": "Healthy",
  "card.allowance.low": "Allowance too low",
  "card.allowance.none": "No allowance — charges will fail",
  "card.allowance.unknown": "Unknown",
  "card.cancel.success": "Subscription cancelled.",
  "card.cancel.pending": "Cancelling…",
  "card.transfer.success": "Subscription transferred.",
  "card.transfer.pending": "Transferring…",
  "card.resume.success": "Resumed.",
  "card.resume.pending": "Resuming…",

  // ── Dashboard ──────────────────────────────────────────────────────────────
  "dashboard.noSubscription": "No active subscription.",
  "dashboard.loading": "Loading…",
  "dashboard.error.load": "Failed to load subscription.",

  // ── Common actions ─────────────────────────────────────────────────────────
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.save": "Save",
  "common.retry": "Retry",
  "common.error.prefix": "Error: {message}",
  "common.offline": "You are offline.",

  // ── Contract errors (mirrors CONTRACT_ERRORS keys in utils/errors.ts) ──────
  "error.alreadyInitialized": "Contract is already set up.",
  "error.amountMustBePositive": "Amount must be greater than zero.",
  "error.intervalMustBePositive": "Billing interval must be greater than zero.",
  "error.noSubscriptionFound": "No subscription found. Please subscribe first.",
  "error.subscriptionInactive": "This subscription has been cancelled.",
  "error.intervalNotElapsed": "Your next charge date hasn't arrived yet.",
  "error.notInitialized": "Contract is not set up yet. Service temporarily unavailable.",
  "error.insufficientAllowance": "Increase your token allowance and try again.",
  "error.gracePeriodElapsed": "This subscription lapsed. Please subscribe again.",
  "error.merchantNotWhitelisted": "This merchant is not whitelisted. Ask the protocol admin to add them first.",
  "error.selfReferral": "You cannot refer yourself.",
  "error.invalidTokenAddress": "Invalid token address.",
  "error.invalidFeeBps": "Invalid fee configuration.",
  "error.metadataLabelTooLong": "Label must be 64 bytes or fewer.",
  "error.amountExceedsMaximum": "Amount exceeds maximum.",
  "error.subscriptionNotActive": "Subscription is not active.",
  "error.subscriptionPaused": "Resume your subscription to continue.",
  "error.contractPaused": "Payments are temporarily paused by the contract administrator.",
  "error.intervalTooShort": "Interval is too short.",
  "error.batchTooLarge": "Batch too large.",
  "error.zeroBalanceAvailable": "You have no withdrawable revenue yet.",
  "error.merchantFrozen": "This merchant is temporarily unavailable.",
  "error.noPendingProposal": "No pending proposal.",
  "error.subscriptionAlreadyActive": "Destination already has an active subscription.",
  "error.dailyLimitExceeded": "Daily spending limit reached. Try a smaller amount or wait.",
  "error.invalidFeeCollector": "Invalid fee collector.",
  "error.invalidPauseExpiry": "Pick a pause end time in the future.",
  "error.globalVolumeExceeded": "Protocol capacity reached; try later.",
  "error.invalidBatchSize": "Invalid batch size.",
  "error.reserved31": "This error code is reserved and is not used by the current contract.",
  "error.invalidRecipient": "Invalid recipient.",
  "error.invalidVolumeCap": "Invalid volume cap.",
  "error.invalidFeeBounds": "Invalid fee bounds.",
  "error.feeOutOfBoundsAtCommit": "Fee out of bounds at commit.",
  "error.arithmeticOverflow": "Arithmetic overflow.",
  "error.catalogGap37": "This error code is not used by the current contract.",
  "error.refundMerchantMismatch": "Refund can only be issued by the subscription's merchant.",
  "error.refundAmountMustBePositive": "Prorated refund amount is zero; nothing to refund.",
  "error.insufficientMerchantBalance": "Merchant has insufficient balance to fund this refund.",
  "error.cannotClearActiveSubscriber": "Cannot clear active subscriber.",
  "error.schemaMigrationRequired": "Contract storage must be migrated before this operation.",
  "error.resumeGraceLapsed": "Subscription grace period has lapsed; please re-subscribe.",
  "error.adminAlreadySet": "Contract admin is already set.",
  "error.noPendingAdmin": "There is no pending admin transfer to accept.",
  "error.intervalExceedsMaximum": "Billing interval must not exceed 400 years.",
  "error.freezeReasonTooLong": "Merchant freeze reason must be 128 bytes or fewer.",
  "error.archived": "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  "error.requireAuth": "Wallet authorization required. Connect as the contract admin.",
};
