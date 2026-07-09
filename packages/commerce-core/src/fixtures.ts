import {
  assertQuoteReconciles,
  computeWaterfall,
  type WaterfallInput,
  type WaterfallResult,
} from '@platform/contracts';

/**
 * Fixture builders over the PINNED canonical waterfall (§5.4/§5.5) — the
 * money-reconciliation CI gate runs on these. Per ADR-001 this package holds
 * no order state machine and redefines no canonical shape; every amount here
 * is derived by the pinned `computeWaterfall`, never computed locally.
 */

/** §5.4 worked baseline: B 10,000 · C 1,000 · M 1,500 · D 1,000. */
export const WORKED_BASELINE_INPUT: WaterfallInput = {
  sellerBasePrice: 10_000,
  sellerFundedCommission: 1_000,
  resellerMarkup: 1_500,
  deliveryFee: 1_000,
  paymentMode: 'FULL_PREPAY',
};

/** Founder's fixed non-divisible regression (RoundingLaw v1): B 10,001 · C 333 · M 778 · D 600. */
export const NON_DIVISIBLE_REGRESSION_INPUT: WaterfallInput = {
  sellerBasePrice: 10_001,
  sellerFundedCommission: 333,
  resellerMarkup: 778,
  deliveryFee: 600,
  paymentMode: 'FULL_PREPAY',
};

/** Build a fixture quote's money fields via the pinned waterfall, then assert it reconciles. */
export function buildFixtureQuoteMoney(input: WaterfallInput): WaterfallResult {
  const result = computeWaterfall(input);
  assertQuoteReconciles(result);
  return result;
}
