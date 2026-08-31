export const CONTRACT_ERRORS: Record<string, string> = {
  // Numeric Soroban codes are stable; keep legacy code 30 as a compatibility alias.
  "error(Contract, #18)": "Payments are temporarily paused by the contract administrator.",
  "error(Contract, #30)": "Payments are temporarily paused by the contract administrator.",
  "#18": "Payments are temporarily paused by the contract administrator.",
  "#30": "Payments are temporarily paused by the contract administrator.",
  // Legacy / string variants
  "interval not elapsed yet": "Your next charge date hasn't arrived yet.",
  "subscription is not active": "This subscription has been cancelled.",
  "no subscription found": "No subscription found. Please subscribe first.",
  "already initialized": "Contract is already set up.",
  "amount must be positive": "Amount must be greater than zero.",
  "interval must be positive": "Billing interval must be greater than zero.",
  "contract paused": "Payments are temporarily paused by the contract administrator.",
  "contractpaused": "Payments are temporarily paused by the contract administrator.",
  "admin not set": "Contract admin is not configured.",
  require_auth: "Wallet authorization required. Connect as the contract admin.",
  entryexpired:
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  archived:
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  "-32700":
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  "#24": "Destination already has an active subscription.",
  "#21": "You have no withdrawable revenue yet.",
  zerobalanceavailable: "You have no withdrawable revenue yet.",

  // Full Soroban RPC numeric codes from docs/ERROR-CODES.md
  "error(contract, #1)": "Contract is already set up.",
  "error(contract, #2)": "Amount must be greater than zero.",
  "error(contract, #3)": "Billing interval must be greater than zero.",
  "error(contract, #4)": "No subscription found. Please subscribe first.",
  "error(contract, #5)": "This subscription has been cancelled.",
  "error(contract, #6)": "Your next charge date hasn't arrived yet.",
  "error(contract, #7)": "Service temporarily unavailable.",
  "error(contract, #8)": "Increase your token allowance and try again.",
  "error(contract, #9)": "This subscription lapsed. Please subscribe again.",
  "error(contract, #10)": "Merchant pending approval.",
  "error(contract, #11)": "You cannot refer yourself.",
  "error(contract, #12)": "Invalid token address.",
  "error(contract, #13)": "Invalid fee configuration.",
  "error(contract, #14)": "Label must be 64 bytes or fewer.",
  "error(contract, #15)": "Amount exceeds maximum.",
  "error(contract, #16)": "Subscription is not active.",
  "error(contract, #17)": "Resume your subscription to continue.",
  "error(contract, #18)": "Protocol is paused for maintenance. Try again later.",
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
  "error(contract, #30)": "Service temporarily unavailable.",
  "error(contract, #32)": "Invalid recipient.",
  "error(contract, #33)": "Invalid volume cap.",
  "error(contract, #34)": "Invalid fee bounds.",
  "error(contract, #35)": "Fee out of bounds at commit.",
  "error(contract, #36)": "Arithmetic overflow.",
  "error(contract, #41)": "Cannot clear active subscriber.",
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
