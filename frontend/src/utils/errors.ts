export const CONTRACT_ERRORS: Record<string, string> = {
  "interval not elapsed yet": "Your next charge date hasn't arrived yet.",
  "subscription is not active": "This subscription has been cancelled.",
  "no subscription found": "No subscription found. Please subscribe first.",
  "already initialized": "Contract is already set up.",
  "amount must be positive": "Amount must be greater than zero.",
  "interval must be positive": "Billing interval must be greater than zero.",
  "admin not set": "Contract admin is not configured.",
  require_auth: "Wallet authorization required. Connect as the contract admin.",
  entryexpired:
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  archived:
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  "-32700":
    "Your subscription data has been archived by the Stellar network. Use Restore to recover it.",
  "#24": "That address already has an active subscription.",
  "#21": "You have no withdrawable revenue yet.",
  zerobalanceavailable: "You have no withdrawable revenue yet.",
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
