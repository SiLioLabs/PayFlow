import { describe, it, expect } from "vitest";
import {
  collectValidationMessages,
  formatViolation,
  hasValidationFailures,
} from "../utils/subscriptionValidation";
import type { SubscriptionValidationReport } from "../types";

describe("subscriptionValidation utils", () => {
  it("formats known violation codes into human-readable messages", () => {
    expect(formatViolation("missing_renewal_record")).toBe("Missing renewal record");
    expect(formatViolation("invalid_subscription_status")).toBe("Invalid subscription status");
  });

  it("collects unique validation messages across categories", () => {
    const report = {
      violations: ["missing_renewal_record"],
      missingRecords: ["missing_charge_history"],
      invalidStateTransitions: ["invalid_state_transition"],
      corruptedReferences: ["corrupted_token_reference"],
    };

    const messages = collectValidationMessages(report);
    expect(messages).toContain("Missing renewal record");
    expect(messages).toContain("Missing charge history record");
    expect(messages).toContain("Invalid state transition");
    expect(messages).toContain("Corrupted token reference");
    expect(messages.length).toBe(4);
  });

  it("detects validation failures", () => {
    const valid: SubscriptionValidationReport = {
      isValid: true,
      violations: [],
      missingRecords: [],
      invalidStateTransitions: [],
      corruptedReferences: [],
    };
    const invalid: SubscriptionValidationReport = {
      ...valid,
      isValid: false,
      violations: ["invalid_subscription_status"],
    };

    expect(hasValidationFailures(valid)).toBe(false);
    expect(hasValidationFailures(invalid)).toBe(true);
  });
});
