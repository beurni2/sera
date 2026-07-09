#!/usr/bin/env node
// Consumption pre-flight baseline (CONSUMING.md): import computeWaterfall +
// assertQuoteReconciles from the pinned @platform/contracts and assert the
// §5.4 worked baseline literally. Exits non-zero on any divergence.
import { computeWaterfall, assertQuoteReconciles } from '@platform/contracts';

const r = computeWaterfall({
  sellerBasePrice: 10_000,
  sellerFundedCommission: 1_000,
  resellerMarkup: 1_500,
  deliveryFee: 1_000,
  paymentMode: 'FULL_PREPAY',
});

console.log(`productSubtotal           ${r.productSubtotal}`);
console.log(`buyerTotal                ${r.buyerTotal}`);
console.log(`sellerNet                 ${r.sellerNet}`);
console.log(`resellerNet               ${r.resellerNet}`);
console.log(`platformProductFeeRevenue ${r.platformProductFeeRevenue}`);

const expected = {
  productSubtotal: 11_500,
  buyerTotal: 12_500,
  sellerNet: 8_500,
  resellerNet: 2_000,
  platformProductFeeRevenue: 1_000,
};
for (const [k, v] of Object.entries(expected)) {
  if (r[k] !== v) {
    console.error(`BASELINE MISMATCH: ${k} expected ${v}, got ${r[k]}`);
    process.exit(1);
  }
}

assertQuoteReconciles(r);
console.log('assertQuoteReconciles: no throw');
console.log('§5.4 worked baseline OK (10,000 / 1,000 / 1,500 / 1,000)');
