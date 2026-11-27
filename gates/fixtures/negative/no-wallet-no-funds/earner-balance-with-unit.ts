// NEGATIVE FIXTURE: an earner's balance named with its currency. This gate
// MUST fail on this file. Never import this.
export interface EarnerMoneyRecord {
  sellerBalanceFcfa: number;
  readonly reseller_balance_xof: number;
}
