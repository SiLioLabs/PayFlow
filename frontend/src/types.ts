export interface Subscription {
  merchant: string;
  amount: string;
  interval: number;
  last_charged: number;
  active: boolean;
}
