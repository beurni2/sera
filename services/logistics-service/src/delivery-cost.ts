import { DeliveryCostSchema, type DeliveryCost } from '@platform/contracts';

/**
 * ═══ FLOTTE-1 (SE7.2) — the delivery-cost decomposition, pure ═══
 *
 * Sera-Build-Spec §7.1 (NORMATIVE): « `directDeliveryCost` (successful; rider
 * time-share + electricity + failed-attempt-amortized) · `returnDeliveryCost`
 * (outbound + return) · `allocatedFleetOverhead` (depreciation, battery-
 * replacement reserve, maintenance, tyres/brakes, insurance, registration,
 * theft/accident reserve, rider phone/data, charging infra, downtime,
 * supervision, support/reconciliation — amortized per delivery, counted
 * once) · `allocatedDispatchOverhead` · `fullyLoadedDeliveryCost = direct +
 * allocated` · `deliveryContributionMargin = D − directDeliveryCost`. Report
 * low/base/high ranges, never a single optimistic figure. » Canon §5.6:
 * `DeliveryCost{ orderId, directDeliveryCost, returnDeliveryCost,
 * allocatedFleetOverhead, allocatedDispatchOverhead, fullyLoadedDeliveryCost,
 * deliveryFunding, deliveryContributionMargin }` — margins may be negative.
 *
 * ⏳ THE NUMBERS ARE THE FOUNDER'S. No canon document names a rider's cost
 * per shift, an electricity figure or a depreciation line: every input here
 * is a HYPOTHESIS he types on his console, kept as three scenarios (low,
 * base, high) so the desk reports ranges. Nothing in this module carries a
 * default figure — an unset hypothesis is « à renseigner », never a guess
 * (failure mode #3: inventing numbers for an open decision).
 *
 * Whole francs throughout: every intermediate is rounded to the franc at the
 * line where the spec names a quantity, so the sum reconciles line by line.
 */

export const FLEET_OVERHEAD_ITEMS = [
  'depreciation',
  'batteryReserve',
  'maintenance',
  'tyresBrakes',
  'insurance',
  'registration',
  'theftAccidentReserve',
  'riderPhoneData',
  'chargingInfra',
  'downtime',
  'supervision',
  'supportReconciliation',
] as const;
export type FleetOverheadItem = (typeof FLEET_OVERHEAD_ITEMS)[number];

export interface CostHypotheses {
  /** What one rider shift costs Séra, in francs — the time-share numerator. */
  readonly riderCostPerShiftFcfa: number;
  /** Deliveries one shift is expected to complete — the time-share divisor (≥ 1). */
  readonly deliveriesPerShift: number;
  /** Electricity for one attempt, in francs. */
  readonly electricityPerDeliveryFcfa: number;
  /** Attempts that fail, as a share in [0, 1) — amortized over the successes. */
  readonly failedAttemptRate: number;
  /** The twelve overhead lines, per month, in francs — each counted ONCE. */
  readonly monthlyFleetOverheadFcfa: Readonly<Record<FleetOverheadItem, number>>;
  readonly monthlyDispatchOverheadFcfa: number;
  /** Deliveries per month the overhead is spread over (≥ 1). */
  readonly monthlyDeliveries: number;
}

export type Scenario = 'low' | 'base' | 'high';
export const SCENARIOS: readonly Scenario[] = ['low', 'base', 'high'];
export type CostHypothesesSet = Readonly<Record<Scenario, CostHypotheses>>;

const isFranc = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isDivisor = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const isRate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1;

/** The founder's typed hypotheses, bounded at the door: one bad number
 *  refuses the whole set (a half-set would report a half-truth). */
export function parseHypotheses(raw: unknown): CostHypothesesSet | null {
  if (raw === null || typeof raw !== 'object') return null;
  const out: Partial<Record<Scenario, CostHypotheses>> = {};
  for (const s of SCENARIOS) {
    const h = (raw as Record<string, unknown>)[s];
    if (h === null || typeof h !== 'object') return null;
    const r = h as Record<string, unknown>;
    const items = r['monthlyFleetOverheadFcfa'];
    if (items === null || typeof items !== 'object') return null;
    const overhead: Partial<Record<FleetOverheadItem, number>> = {};
    for (const item of FLEET_OVERHEAD_ITEMS) {
      const v = (items as Record<string, unknown>)[item];
      if (!isFranc(v)) return null;
      overhead[item] = v;
    }
    if (
      !isFranc(r['riderCostPerShiftFcfa']) ||
      !isDivisor(r['deliveriesPerShift']) ||
      !isFranc(r['electricityPerDeliveryFcfa']) ||
      !isRate(r['failedAttemptRate']) ||
      !isFranc(r['monthlyDispatchOverheadFcfa']) ||
      !isDivisor(r['monthlyDeliveries'])
    ) {
      return null;
    }
    out[s] = {
      riderCostPerShiftFcfa: r['riderCostPerShiftFcfa'],
      deliveriesPerShift: r['deliveriesPerShift'],
      electricityPerDeliveryFcfa: r['electricityPerDeliveryFcfa'],
      failedAttemptRate: r['failedAttemptRate'],
      monthlyFleetOverheadFcfa: overhead as Record<FleetOverheadItem, number>,
      monthlyDispatchOverheadFcfa: r['monthlyDispatchOverheadFcfa'],
      monthlyDeliveries: r['monthlyDeliveries'],
    };
  }
  return out as CostHypothesesSet;
}

/** One attempt on the road: the rider's time-share plus the electricity. */
export function attemptCostFcfa(h: CostHypotheses): number {
  return Math.round(h.riderCostPerShiftFcfa / h.deliveriesPerShift) + h.electricityPerDeliveryFcfa;
}

/** The twelve lines summed ONCE, then spread over the month's deliveries. */
export function allocatedFleetOverheadFcfa(h: CostHypotheses): number {
  let total = 0;
  for (const item of FLEET_OVERHEAD_ITEMS) total += h.monthlyFleetOverheadFcfa[item];
  return Math.round(total / h.monthlyDeliveries);
}

/**
 * The canon DeliveryCost for one order under one scenario. `deliveryFunding`
 * is D — the delivery fee the order carried, which Séra never computes
 * (SE-I09): it is read off the order, or typed by the founder for a what-if.
 */
export function deliveryCost(orderId: string, deliveryFunding: number, h: CostHypotheses): DeliveryCost {
  const attempt = attemptCostFcfa(h);
  // A successful delivery carries the attempts that failed before it:
  // attempts per success = 1 / (1 − r), so the failed share is r / (1 − r).
  const directDeliveryCost = Math.round(attempt / (1 - h.failedAttemptRate));
  const returnDeliveryCost = 2 * attempt;
  const allocatedFleetOverhead = allocatedFleetOverheadFcfa(h);
  const allocatedDispatchOverhead = Math.round(h.monthlyDispatchOverheadFcfa / h.monthlyDeliveries);
  const cost = {
    orderId,
    directDeliveryCost,
    returnDeliveryCost,
    allocatedFleetOverhead,
    allocatedDispatchOverhead,
    fullyLoadedDeliveryCost: directDeliveryCost + allocatedFleetOverhead + allocatedDispatchOverhead,
    deliveryFunding,
    deliveryContributionMargin: deliveryFunding - directDeliveryCost,
  };
  // The canon shape, at the boundary — a figure that does not fit it is a bug, never a row.
  return DeliveryCostSchema.parse(cost);
}

/** The three scenarios — « never a single optimistic figure ». */
export function deliveryCostRange(orderId: string, deliveryFunding: number, set: CostHypothesesSet): Readonly<Record<Scenario, DeliveryCost>> {
  return {
    low: deliveryCost(orderId, deliveryFunding, set.low),
    base: deliveryCost(orderId, deliveryFunding, set.base),
    high: deliveryCost(orderId, deliveryFunding, set.high),
  };
}
