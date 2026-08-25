import type { SubscriptionValidationReport } from "../types";

/**
 * Maps contract violation codes to operator-friendly diagnostic messages.
 */
const VIOLATION_MESSAGES: Record<string, string> = {
  missing_renewal_record: "Missing renewal record",
  missing_subscription_record: "Missing subscription record",
  missing_charge_history: "Missing charge history record",
  invalid_subscription_status: "Invalid subscription status",
  corrupted_expiration_timestamp: "Corrupted expiration timestamp",
  corrupted_last_charged: "Corrupted last-charged timestamp",
  invalid_state_transition: "Invalid state transition",
  corrupted_merchant_reference: "Corrupted merchant reference",
  corrupted_token_reference: "Corrupted token reference",
  corrupted_referrer_reference: "Corrupted referrer reference",
  schema_version_mismatch: "Schema version mismatch",
  orphaned_metadata: "Orphaned metadata record",
  no_subscription_found: "No subscription found for this address",
};

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Convert a contract violation code or message into human-readable text. */
export function formatViolation(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Unknown validation issue";

  const key = normalizeKey(trimmed);
  if (VIOLATION_MESSAGES[key]) {
    return VIOLATION_MESSAGES[key];
  }

  // Already human-readable (contains spaces and no snake_case-only pattern)
  if (/\s/.test(trimmed) && !/^[a-z0-9_]+$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function collectValidationMessages(report: {
  violations: string[];
  missingRecords: string[];
  invalidStateTransitions: string[];
  corruptedReferences: string[];
}): string[] {
  const all = [
    ...report.violations,
    ...report.missingRecords,
    ...report.invalidStateTransitions,
    ...report.corruptedReferences,
  ];

  const seen = new Set<string>();
  const messages: string[] = [];

  for (const item of all) {
    const formatted = formatViolation(item);
    if (!seen.has(formatted)) {
      seen.add(formatted);
      messages.push(formatted);
    }
  }

  return messages;
}

export function hasValidationFailures(report: SubscriptionValidationReport): boolean {
  return (
    !report.isValid ||
    report.violations.length > 0 ||
    report.missingRecords.length > 0 ||
    report.invalidStateTransitions.length > 0 ||
    report.corruptedReferences.length > 0
  );
}
