import { describe, expect, it } from 'vitest';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../src/pickup-verification-policy.js';
import { CustodySpine, LOST_CUSTODIAN } from '../src/custody-spine.js';

/**
 * A parcel lost on the road (founder ruling 2026-11-27, Sera-Build-Spec
 * §6.5), on the spine alone: only while a courier holds it, one named lost
 * custodian, one sera_loss claim at the typed amount naming the accepted
 * pickup's evidence, one package.lost.v1 — and final.
 */

const T = '2026-11-27T09:00:00.000Z';
const T2 = '2026-11-27T09:30:00.000Z';
const CHAIN = { order_id: 'order-perdu-1', task_id: 'task-perdu-1', package_id: 'pkg-perdu-1', correlation_id: 'corr-perdu-1' };
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));

function verified(): CustodySpine {
  const spine = new CustodySpine(CHAIN, 'sup-1');
  expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1')).toEqual({ ok: true });
  spine.establishSellerCustody(T);
  const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'sans-photo' }, 'pvc-1', T);
  if (v.kind !== 'accepted') throw new Error('setup verify');
  return spine;
}

function sealed(): CustodySpine {
  const spine = verified();
  const c = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-1', sealPhotoRefs: [], at: T });
  if (!c.ok) throw new Error('setup custody');
  return spine;
}

const lostEvents = (spine: CustodySpine) => spine.allEvents().filter((e) => e.name === 'package.lost.v1');

describe('the founder declares a parcel lost on the road — the custody spine', () => {
  it('with a courier holding it: the ledger names lost:sera, one sera_loss claim at the typed amount with the pickup\'s recorded evidence, one package.lost.v1 {orderId, at}', () => {
    const spine = sealed();
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    expect(spine.declareLost(12_000, T2)).toEqual({ ok: true, already: false });
    expect(LOST_CUSTODIAN).toBe('lost:sera');
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('lost:sera');
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
    expect(spine.courierHoldsCustody()).toBe(false);
    expect(spine.allLiabilityClaims()).toEqual([{ orderId: CHAIN.order_id, cause: 'sera_loss', amount: 12_000, evidenceBundleId: 'sans-photo', state: 'opened' }]);
    expect(lostEvents(spine)).toHaveLength(1);
    expect(lostEvents(spine)[0]!.payload).toEqual({ orderId: CHAIN.order_id, at: T2 });
  });

  it('before the seal: refused custody_not_with_courier, the seller still holds it, no claim, no event', () => {
    const spine = verified();
    expect(spine.declareLost(12_000, T2)).toEqual({ ok: false, reason: 'custody_not_with_courier' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('seller:sup-1');
    expect(spine.allLiabilityClaims()).toEqual([]);
    expect(lostEvents(spine)).toEqual([]);
  });

  it('twice: the second is `already` — still one claim, one event, the first amount', () => {
    const spine = sealed();
    expect(spine.declareLost(12_000, T2)).toEqual({ ok: true, already: false });
    expect(spine.declareLost(99_000, T2)).toEqual({ ok: true, already: true });
    expect(spine.allLiabilityClaims()).toHaveLength(1);
    expect(spine.allLiabilityClaims()[0]!.amount).toBe(12_000);
    expect(lostEvents(spine)).toHaveLength(1);
  });

  it('after it: every door act and the expired window answer by name and move nothing', () => {
    const spine = sealed();
    expect(spine.recordDoorRefusal('insufficient_balance', T).ok).toBe(true);
    expect(spine.declareLost(5_000, T2)).toEqual({ ok: true, already: false });
    expect(spine.escalateExpiredWindow('2026-11-27T10:00:00.000Z')).toEqual({ ok: false, reason: 'colis_declare_perdu' });
    expect(spine.currentLadderOutcome()?.family).toBe('retry');
    expect(spine.recordDoorRefusal('honest_absence', T2)).toEqual({ ok: false, reason: 'refusal_before_custody' });
    expect(spine.confirmDropAndEmitEligibility('drop-1', T2).ok).toBe(false);
    expect(spine.applyDispatcherReturn(T2)).toEqual({ ok: false, reason: 'custody_not_with_courier' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('lost:sera');
  });

  it('a liability claim on a file already lost:sera is refused colis_declare_perdu — the declaration carries its one claim', () => {
    const spine = sealed();
    expect(spine.recordDoorRefusal('insufficient_balance', T).ok).toBe(true);
    expect(spine.escalateExpiredWindow('2026-11-27T09:20:00.000Z').ok).toBe(true);
    expect(spine.openReturn({ returnSealId: 'rs-1', at: T2 }).ok).toBe(true);
    expect(spine.declareLost(8_000, T2)).toEqual({ ok: true, already: false });
    const claim = { orderId: CHAIN.order_id, cause: 'sera_loss', amount: 8_000, evidenceBundleId: 'sans-photo', state: 'opened' };
    expect(spine.fileCustodyLiabilityClaim(claim, T2)).toEqual({ ok: false, reason: 'colis_declare_perdu' });
    expect(spine.allLiabilityClaims()).toHaveLength(1);
  });

  it('an amount the canon claim refuses is refused and moves nothing', () => {
    const spine = sealed();
    expect(spine.declareLost(12.5, T2)).toEqual({ ok: false, reason: 'claim_not_canonical' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    expect(lostEvents(spine)).toEqual([]);
  });
});
