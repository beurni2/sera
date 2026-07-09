import { describe, expect, it } from 'vitest';
import {
  QuoteReconciliationError,
  assertQuoteReconciles,
  computeWaterfall,
} from '@platform/contracts';
import {
  NON_DIVISIBLE_REGRESSION_INPUT,
  WORKED_BASELINE_INPUT,
  buildFixtureQuoteMoney,
} from '../src/fixtures.js';

// CI gate: money-reconciliation (§5.4/§5.5, standing guardrail). Fixture
// quotes are built by the PINNED waterfall; the assertions below are literal.

describe('money-reconciliation gate — §5.4 worked baseline', () => {
  it('reproduces the worked baseline to the franc (10,000 / 1,000 / 1,500 / 1,000)', () => {
    const q = buildFixtureQuoteMoney(WORKED_BASELINE_INPUT);
    expect(q.productSubtotal).toBe(11_500);
    expect(q.buyerTotal).toBe(12_500);
    expect(q.sellerNet).toBe(8_500);
    expect(q.resellerNet).toBe(2_000);
    expect(q.platformProductFeeRevenue).toBe(1_000);
    // reconciliation identity, asserted literally, not just via no-throw:
    expect(q.sellerNet + q.resellerNet + q.platformProductFeeRevenue).toBe(q.productSubtotal);
    expect(q.productSubtotal + q.deliveryFee).toBe(q.buyerTotal);
  });

  it('reproduces the founder non-divisible regression exactly (RoundingLaw v1)', () => {
    const q = buildFixtureQuoteMoney(NON_DIVISIBLE_REGRESSION_INPUT);
    expect(q.sellerPlatformFee).toBe(500);
    expect(q.resellerPlatformFee).toBe(222);
    expect(q.sellerNet).toBe(9_168);
    expect(q.resellerNet).toBe(889);
    expect(q.platformProductFeeRevenue).toBe(722);
    expect(q.productSubtotal).toBe(10_779);
    expect(q.buyerTotal).toBe(11_379);
  });

  it('FULL_PREPAY funds the full buyerTotal at checkout (§5.5)', () => {
    const q = buildFixtureQuoteMoney(WORKED_BASELINE_INPUT);
    expect(q.amountPaidAtCheckout).toBe(12_500);
    expect(q.amountDueAtDelivery).toBe(0);
  });

  it('Option B funds D at checkout and productSubtotal at the door (§5.5)', () => {
    const q = buildFixtureQuoteMoney({
      ...WORKED_BASELINE_INPUT,
      paymentMode: 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR',
    });
    expect(q.amountPaidAtCheckout).toBe(1_000);
    expect(q.amountDueAtDelivery).toBe(11_500);
    expect(q.amountPaidAtCheckout + q.amountDueAtDelivery).toBe(q.buyerTotal);
  });
});

describe('money-reconciliation gate — negative direction stays armed', () => {
  it('an independent-multiplication sellerNet drifts one franc and MUST throw', () => {
    const honest = computeWaterfall(NON_DIVISIBLE_REGRESSION_INPUT);
    // The forbidden shortcut: sellerNet from its own multiplication instead
    // of subtraction — floor(0.95 × 10,001) − 333 = 9,167, not 9,168.
    const tampered = { ...honest, sellerNet: Math.floor(0.95 * 10_001) - 333 };
    expect(tampered.sellerNet).toBe(9_167);
    expect(() => assertQuoteReconciles(tampered)).toThrow(QuoteReconciliationError);
    expect(() => assertQuoteReconciles(tampered)).toThrow(/10779/);
  });

  it('a quote whose legs do not sum to buyerTotal MUST throw', () => {
    const honest = computeWaterfall(WORKED_BASELINE_INPUT);
    const tampered = { ...honest, amountDueAtDelivery: 1 };
    expect(() => assertQuoteReconciles(tampered)).toThrow(QuoteReconciliationError);
  });
});

describe('SeraDeliveryView — read-side only (SE-I09, §5.4)', () => {
  it('carries ONLY deliveryFee, amountDueAtDelivery, paymentMode — never commission or splits', async () => {
    const { toSeraDeliveryView } = await import('../src/delivery-view.js');
    const w = computeWaterfall(WORKED_BASELINE_INPUT);
    const view = toSeraDeliveryView({
      id: 'q_1',
      attributionResellerId: 'res_1',
      ...w,
      paymentProcessingFeeEstimate: 0,
      taxFields: {},
      policyVersions: { settlementPolicyVersion: 'v1', inspectionPolicyVersion: 'v1' },
      expiry: '2026-08-09T00:00:00Z',
    } as never);
    expect(view).toEqual({
      orderQuoteId: 'q_1',
      paymentMode: 'FULL_PREPAY',
      deliveryFeeFcfa: 1_000,
      amountDueAtDeliveryFcfa: 0,
    });
    expect(JSON.stringify(view)).not.toMatch(/commission|sellerNet|resellerNet|platformProductFee|gross/i);
  });
});
