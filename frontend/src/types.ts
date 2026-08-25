export interface Subscription {
  merchant: string;
  amount: string;
  interval: number;
  last_charged: number;
  active: boolean;
  paused: boolean;
  trial_duration?: number;
  label?: string;
}

export interface ChargeEvent {
  date: Date;
  amount: string;
  txHash: string;
  merchant: string;
}

/** On-chain diagnostic report returned by `validate_subscription`. */
export interface SubscriptionValidationReport {
  isValid: boolean;
  violations: string[];
  missingRecords: string[];
  invalidStateTransitions: string[];
  corruptedReferences: string[];
}
