#!/usr/bin/env node
// Pre-flight-4 / WO-SE0.1 READ FIRST: the pinned Quote carries NO
// supplyMode/handlingClass/kittingSealId (Séra Spec §5.6 L69 — PackLab
// fields ride the DeliveryTask/package context, never the Quote).
import { QuoteSchema, computeWaterfall } from '@platform/contracts';
const keys = Object.keys(QuoteSchema.shape);
const gated = ['supplyMode', 'handlingClass', 'kittingSealId'].filter((k) => keys.includes(k));
if (gated.length > 0) {
  console.error(`quote-shape-check FAILED — gated fields on the pinned Quote: ${gated.join(', ')}`);
  process.exit(1);
}
const w = computeWaterfall({ sellerBasePrice: 10000, sellerFundedCommission: 1000, resellerMarkup: 1500, deliveryFee: 1000, paymentMode: 'FULL_PREPAY' });
const { roundingLawVersion: _rl, ...money } = w;
const base = {
  id: 'q_1', attributionResellerId: 'res_1', ...money,
  paymentProcessingFeeEstimate: 0, taxFields: {},
  policyVersions: { settlementPolicyVersion: 'v1', inspectionPolicyVersion: 'v1' },
  expiry: '2026-08-09T00:00:00Z',
};
if (!QuoteSchema.safeParse(base).success) {
  console.error('quote-shape-check FAILED — clean canonical quote does not parse');
  process.exit(1);
}
for (const [k, v] of [['supplyMode', 'SELLER_HELD'], ['handlingClass', 'X'], ['kittingSealId', 'seal_1']]) {
  if (QuoteSchema.safeParse({ ...base, [k]: v }).success) {
    console.error(`quote-shape-check FAILED — Quote WITH ${k} parsed (must be strict-refused)`);
    process.exit(1);
  }
}
console.log(`quote-shape-check OK — ${keys.length} Quote keys; supplyMode/handlingClass/kittingSealId absent and strict-refused (§5.6 L69)`);
