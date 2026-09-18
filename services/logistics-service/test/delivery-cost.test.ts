import { DeliveryCostSchema } from '@platform/contracts';
import { describe, expect, it } from 'vitest';
import {
  FLEET_OVERHEAD_ITEMS,
  allocatedFleetOverheadFcfa,
  attemptCostFcfa,
  deliveryCost,
  deliveryCostRange,
  parseHypotheses,
  type CostHypotheses,
} from '../src/delivery-cost.js';

/**
 * FLOTTE-1 — §7.1 line by line, with TEST figures (never defaults: the
 * module carries none; these are this suite's own, chosen so every division
 * lands on a whole franc and the arithmetic can be checked by hand).
 */

const overhead = (each: number) => Object.fromEntries(FLEET_OVERHEAD_ITEMS.map((k) => [k, each])) as Record<(typeof FLEET_OVERHEAD_ITEMS)[number], number>;

const H: CostHypotheses = {
  riderCostPerShiftFcfa: 8_000,
  deliveriesPerShift: 8,
  electricityPerDeliveryFcfa: 100,
  failedAttemptRate: 0.2,
  monthlyFleetOverheadFcfa: overhead(10_000), // 12 lines × 10 000 = 120 000
  monthlyDispatchOverheadFcfa: 60_000,
  monthlyDeliveries: 600,
};

describe('deliveryCost — §7.1 decomposition, whole francs, canon shape', () => {
  it('one attempt = time-share + electricity; direct amortizes the failed attempts over the successes', () => {
    expect(attemptCostFcfa(H)).toBe(1_100); // 8000/8 + 100
    const c = deliveryCost('ord-1', 1_500, H);
    expect(c.directDeliveryCost).toBe(1_375); // 1100 / (1 − 0.2)
    expect(c.returnDeliveryCost).toBe(2_200); // outbound + return
    expect(allocatedFleetOverheadFcfa(H)).toBe(200); // 120 000 / 600, the twelve lines counted once
    expect(c.allocatedFleetOverhead).toBe(200);
    expect(c.allocatedDispatchOverhead).toBe(100); // 60 000 / 600
    expect(c.fullyLoadedDeliveryCost).toBe(1_675); // direct + allocated
    expect(c.deliveryFunding).toBe(1_500);
    expect(c.deliveryContributionMargin).toBe(125); // D − direct
    expect(DeliveryCostSchema.parse(c)).toEqual(c);
  });

  it('a negative contribution margin is a lawful figure — the truth, not an optimistic one', () => {
    const c = deliveryCost('ord-2', 1_000, H);
    expect(c.deliveryContributionMargin).toBe(-375);
    expect(DeliveryCostSchema.parse(c).deliveryContributionMargin).toBe(-375);
  });

  it('an overhead line counted twice would change the allocation — each of the twelve counts once', () => {
    const h2 = { ...H, monthlyFleetOverheadFcfa: { ...overhead(10_000), depreciation: 20_000 } };
    expect(allocatedFleetOverheadFcfa(h2)).toBe(Math.round(130_000 / 600));
  });

  it('the three scenarios are reported together, each on its own hypotheses', () => {
    const set = { low: H, base: { ...H, failedAttemptRate: 0.5 }, high: { ...H, riderCostPerShiftFcfa: 16_000 } };
    const r = deliveryCostRange('ord-3', 1_500, set);
    expect(r.low.directDeliveryCost).toBe(1_375);
    expect(r.base.directDeliveryCost).toBe(2_200);
    expect(r.high.directDeliveryCost).toBe(2_625); // (2000 + 100) / 0.8
    expect(Object.keys(r)).toEqual(['low', 'base', 'high']);
  });
});

describe('parseHypotheses — the founder’s numbers, bounded at the door', () => {
  const raw = { low: H, base: H, high: H };
  it('accepts the whole set and nothing less', () => {
    expect(parseHypotheses(raw)).toEqual(raw);
    expect(parseHypotheses({ low: H, base: H })).toBeNull();
    expect(parseHypotheses(null)).toBeNull();
  });
  it('one bad number refuses the whole set: a fraction of a franc, a zero divisor, a rate of 1, a missing overhead line', () => {
    expect(parseHypotheses({ ...raw, base: { ...H, electricityPerDeliveryFcfa: 1.5 } })).toBeNull();
    expect(parseHypotheses({ ...raw, base: { ...H, deliveriesPerShift: 0 } })).toBeNull();
    expect(parseHypotheses({ ...raw, base: { ...H, failedAttemptRate: 1 } })).toBeNull();
    const { depreciation: _gone, ...rest } = overhead(1);
    expect(parseHypotheses({ ...raw, base: { ...H, monthlyFleetOverheadFcfa: rest } })).toBeNull();
    expect(parseHypotheses({ ...raw, base: { ...H, monthlyDeliveries: -1 } })).toBeNull();
  });
});
