export interface Subscription {
  merchant: string;
  amount: string;
  interval: number;
  last_charged: number;
  active: boolean;
  label?: string;
}

export interface ChargeEvent {
  date: Date;
  amount: string;
  txHash: string;
  merchant: string;
}
