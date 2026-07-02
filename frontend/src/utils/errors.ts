export const CONTRACT_ERRORS: Record<string, string> = {
  "interval not elapsed yet": "Your next charge date hasn't arrived yet.",
  "subscription is not active": "This subscription has been cancelled.",
  "no subscription found": "No subscription found. Please subscribe first.",
  "already initialized": "Contract is already set up.",
  "amount must be positive": "Amount must be greater than zero.",
  "interval must be positive": "Billing interval must be greater than zero.",
  "daily limit exceeded": "Daily limit exceeded.",
  "subscription paused": "Subscription paused.",
  "insufficient allowance": "Insufficient allowance.",
  "merchant not whitelisted": "Merchant not whitelisted.",
  "admin not set": "Contract admin is not configured.",
  require_auth: "Wallet authorization required. Connect as the contract admin.",
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

export function parseContractError(simulationResult: unknown): string | null {
  if (!simulationResult) return null;

  let rawContent = "";

  if (typeof simulationResult === "string") {
    rawContent = simulationResult;
  } else if (typeof simulationResult === "object") {
    try {
      rawContent = JSON.stringify(simulationResult, (_, v) =>
        typeof v === "bigint" ? v.toString() : v
      );
    } catch {
      rawContent = String(simulationResult);
    }
  }

  if (!rawContent) return null;

  const normalized = rawContent.toLowerCase();

  for (const [panic, message] of Object.entries(CONTRACT_ERRORS)) {
    if (normalized.includes(panic.toLowerCase())) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("payflow:error", { detail: message })
        );
      }
      return message;
    }
  }

  return null;
}
