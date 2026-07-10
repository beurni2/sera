import { describe, expect, it } from 'vitest';
import { DeliveryOutcomeSchema } from '@platform/contracts';
import { PICKUP_VERIFICATION_POLICY_V1 } from '../src/pickup-verification-policy.js';
import { CustodySpine } from '../src/custody-spine.js';
import { REFUSAL_LADDER_POLICY_V1, openRetryWindow, resolveExpiredWindow } from '../src/refusal-ladder.js';
import { CustodyLedger } from '../src/custody-ledger.js';
import { OPS_AGING_POLICY_V1, OpsMonitor } from '../src/ops-monitor.js';

const T = '2026-07-10T12:00:00.000Z';
const T_PLUS_16MIN = '2026-07-10T12:16:00.000Z';
const T_PLUS_10MIN = '2026-07-10T12:10:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';
const CHAIN = { order_id: 'order-e2-0001', task_id: 'task-e2-0001', package_id: 'pkg-e2-0001', correlation_id: 'corr-e2-0001' };
const allPass = Object.fromEntries(PICKUP_VERIFICATION_POLICY_V1.checks.map((c) => [c, true]));

const evidenceBundle = (over: Record<string, unknown> = {}) => ({
  taskId: CHAIN.task_id,
  packageId: CHAIN.package_id,
  custodySealId: 'seal-e2-0001',
  artifacts: [{ ref: 'media/drop-photo.jpg', sha256: SHA, mimeType: 'image/jpeg' }],
  capturedAt: T,
  ...over,
});

function spineWithCourierCustody(): CustodySpine {
  const spine = new CustodySpine(CHAIN, 'sup-1');
  expect(spine.secrets.register('pickup_verification_code', CHAIN.order_id, 'pvc-1')).toEqual({ ok: true });
  expect(spine.secrets.register('custody_seal', CHAIN.order_id, 'seal-e2-0001')).toEqual({ ok: true });
  expect(spine.secrets.register('buyer_drop_code', CHAIN.order_id, 'drop-1')).toEqual({ ok: true });
  spine.establishSellerCustody(T);
  const v = spine.verifyPickup({ orderId: CHAIN.order_id, riderId: 'r-1', checkResults: allPass, dwellSec: 150, evidenceBundleId: 'eb-1', custodySealId: 'seal-e2-0001' }, 'pvc-1', T);
  if (v.kind !== 'accepted') throw new Error('setup verify');
  const c = spine.beginCustody({ riderId: 'r-1', verificationOrderId: CHAIN.order_id, custodySealId: 'seal-e2-0001', sealPhotoRefs: ['media/seal.jpg'], at: T });
  if (!c.ok) throw new Error('setup custody');
  return spine;
}

describe('WO-2.2 item 1 — every non-happy resolution is a canonical DeliveryOutcome; bare failed is unrepresentable', () => {
  it('a door refusal produces a strict canonical outcome: family retry, taxonomy reason, fault attributed, honest window', () => {
    const spine = spineWithCourierCustody();
    const refused = spine.recordDoorRefusal('insufficient_balance', T);
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    expect(DeliveryOutcomeSchema.safeParse(refused.outcome).success).toBe(true);
    expect(refused.outcome).toMatchObject({
      family: 'retry',
      reasonCode: 'insufficient_balance',
      faultClass: 'buyer',
      humanReasonRef: 'reason.insufficient_balance',
      attempt: { number: 1, at: T, windowExpiresAt: '2026-07-10T12:15:00.000Z' },
    });
  });

  it("a reason OUTSIDE the taxonomy refuses closed — and 'failed' is not a family the schema can parse", () => {
    const spine = spineWithCourierCustody();
    expect(spine.recordDoorRefusal('gave_up', T)).toEqual({ ok: false, reason: 'reason_not_in_taxonomy', detail: 'gave_up' });
    expect(
      DeliveryOutcomeSchema.safeParse({
        taskId: 't', orderId: 'o', family: 'failed', reasonCode: 'honest_absence',
        humanReasonRef: 'reason.honest_absence', faultClass: 'buyer', attempt: { number: 1, at: T },
      }).success,
    ).toBe(false);
  });

  it('door refusal before custody refuses closed', () => {
    const spine = new CustodySpine(CHAIN, 'sup-1');
    expect(spine.recordDoorRefusal('honest_absence', T)).toEqual({ ok: false, reason: 'refusal_before_custody' });
  });
});

describe('WO-2.2 item 2 — the ONE retry window (policy data), then the ladder: both arms', () => {
  it('policy carries the ~15 min default as versioned DATA and the two §6.4 sets', () => {
    expect(REFUSAL_LADDER_POLICY_V1.version).toBe('refusal-ladder-policy.v1');
    expect(REFUSAL_LADDER_POLICY_V1.retryWindowMin).toBe(15);
    expect([...REFUSAL_LADDER_POLICY_V1.nonEscalatingReasons]).toEqual(['honest_absence', 'unusable_location', 'provider_failure']);
    expect([...REFUSAL_LADDER_POLICY_V1.escalatingReasons]).toEqual(['insufficient_balance', 'change_of_mind', 'repeated_abuse', 'fraud']);
  });

  it('ESCALATING ARM: window expiry on an escalating code → family return, buyer fault (the §6.4 "then buyer-fault refusal")', () => {
    const spine = spineWithCourierCustody();
    spine.recordDoorRefusal('change_of_mind', T);
    const escalated = spine.escalateExpiredWindow(T_PLUS_16MIN);
    expect(escalated.ok).toBe(true);
    if (!escalated.ok) return;
    expect(escalated.outcome).toMatchObject({ family: 'return', reasonCode: 'change_of_mind', faultClass: 'buyer', attempt: { number: 2 } });
  });

  it('NON-ESCALATING ARM: honest_absence and provider_failure do NOT escalate — family reschedule, provider fault attributed to the provider', () => {
    for (const [reason, fault] of [['honest_absence', 'buyer'], ['provider_failure', 'payment_provider']] as const) {
      const spine = spineWithCourierCustody();
      spine.recordDoorRefusal(reason, T);
      const resolved = spine.escalateExpiredWindow(T_PLUS_16MIN);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      expect(resolved.outcome).toMatchObject({ family: 'reschedule', reasonCode: reason, faultClass: fault });
    }
  });

  it('the window is HONEST: escalation before expiry refuses (window_not_expired); a second window does not exist', () => {
    const spine = spineWithCourierCustody();
    spine.recordDoorRefusal('change_of_mind', T);
    expect(spine.escalateExpiredWindow(T_PLUS_10MIN)).toEqual({ ok: false, reason: 'window_not_expired' });
    spine.escalateExpiredWindow(T_PLUS_16MIN);
    // The ladder proceeded — the (now return-family) outcome cannot re-enter the window step:
    expect(spine.escalateExpiredWindow(T_PLUS_16MIN)).toEqual({ ok: false, reason: 'attempt_out_of_sequence' });
    expect(resolveExpiredWindow({ retryOutcome: (openRetryWindow({ taskId: 't', orderId: 'o', reasonCode: 'fraud', at: T }) as { ok: true; outcome: never }).outcome, now: T_PLUS_10MIN })).toEqual({ ok: false, reason: 'window_not_expired' });
  });
});

describe('WO-2.2 item 3 — buyer-fault refusal: fee retained (record only), re-seal with ledger continuity, structured emission, return opened', () => {
  function buyerFaultSpine(): CustodySpine {
    const spine = spineWithCourierCustody();
    spine.recordDoorRefusal('insufficient_balance', T);
    spine.escalateExpiredWindow(T_PLUS_16MIN);
    return spine;
  }

  it('applies: new return-seal registered + ledger entry, chain still VERIFIES, custodian unchanged (courier), fee-retained recorded, delivery.refused.v1 + return.logistics_requested.v1 emitted', () => {
    const spine = buyerFaultSpine();
    const applied = spine.applyBuyerFaultRefusal({ returnSealId: 'return-seal-77', at: T_PLUS_16MIN });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1'); // custody preserved
    expect(spine.ledger.all().at(-1)!.payload).toEqual({ sealKind: 'return_seal' });
    expect(spine.isFeeRetainedRecorded(CHAIN.order_id)).toBe(true);
    expect(applied.events.map((e) => e.name)).toEqual(['delivery.refused.v1', 'return.logistics_requested.v1']);
    expect(applied.events[0]!.payload).toMatchObject({
      family: 'return', reason_code: 'insufficient_balance', fault_class: 'buyer', fee_retained: true,
    });
    // No amount rides any of it (SE-I09):
    expect(Object.keys(applied.events[0]!.payload).join(',')).not.toMatch(/amount|fcfa|net/i);
    expect(spine.returnFlowState()).toBe('opened');
  });

  it('cannot apply without an escalated buyer-fault outcome (reschedule arm or no ladder → refused)', () => {
    const spine = spineWithCourierCustody();
    expect(spine.applyBuyerFaultRefusal({ returnSealId: 'x', at: T })).toEqual({ ok: false, reason: 'no_buyer_fault_refusal' });
    spine.recordDoorRefusal('honest_absence', T);
    spine.escalateExpiredWindow(T_PLUS_16MIN); // reschedule arm
    expect(spine.applyBuyerFaultRefusal({ returnSealId: 'x', at: T_PLUS_16MIN })).toEqual({ ok: false, reason: 'no_buyer_fault_refusal' });
  });

  it('the old custody seal stays consumed — the return seal is a NEW single-use secret, no substitution', () => {
    const spine = buyerFaultSpine();
    spine.applyBuyerFaultRefusal({ returnSealId: 'return-seal-77', at: T_PLUS_16MIN });
    expect(spine.secrets.consume('custody_seal', CHAIN.order_id, 'seal-e2-0001', T)).toEqual({ ok: false, reason: 'secret_already_used' });
    expect(spine.secrets.consume('return_seal', CHAIN.order_id, 'return-seal-77', T).ok).toBe(true);
  });
});

describe('WO-2.2 item 4 — two-key return (SE6.2): custody preserved home; both-or-neither; claims are records', () => {
  function openReturnSpine(): CustodySpine {
    const spine = spineWithCourierCustody();
    spine.recordDoorRefusal('fraud', T);
    spine.escalateExpiredWindow(T_PLUS_16MIN);
    spine.applyBuyerFaultRefusal({ returnSealId: 'return-seal-77', at: T_PLUS_16MIN });
    const armed = spine.armReturnKeys('seller-key-abc', 'rider-key-xyz');
    if (!armed.ok) throw new Error('setup arm');
    return spine;
  }

  it('TWO KEYS handover: custody transitions courier→seller ONLY on both keys; custody.returned_to_supplier.v1; chain verifies', () => {
    const spine = openReturnSpine();
    const handover = spine.completeReturnHandover('seller-key-abc', 'rider-key-xyz', T_PLUS_16MIN);
    expect(handover.ok).toBe(true);
    if (!handover.ok) return;
    expect(handover.event.name).toBe('custody.returned_to_supplier.v1');
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('seller:sup-1');
    expect(spine.returnFlowState()).toBe('closed');
    expect(spine.ledger.verifyChain()).toEqual({ valid: true });
  });

  it('A SINGLE KEY REFUSES and burns NOTHING: wrong rider key → refusal, seller key still consumable, custody stays with the courier', () => {
    const spine = openReturnSpine();
    const attempt = spine.completeReturnHandover('seller-key-abc', 'rider-key-WRONG', T_PLUS_16MIN);
    expect(attempt).toEqual({ ok: false, reason: 'return_two_key_refused', detail: 'second:secret_mismatch' });
    expect(spine.ledger.currentCustodian(CHAIN.package_id)).toBe('courier:r-1');
    // Both-or-neither: the valid seller key was NOT burned by the failed attempt —
    const retry = spine.completeReturnHandover('seller-key-abc', 'rider-key-xyz', T_PLUS_16MIN);
    expect(retry.ok).toBe(true);
  });

  it('handover without an open return flow refuses closed', () => {
    const spine = spineWithCourierCustody();
    expect(spine.completeReturnHandover('a', 'b', T)).toEqual({ ok: false, reason: 'return_not_open' });
  });

  it('Séra-fault damage on return → a canonical CustodyLiabilityClaim RECORD (dispatcher-declared amount) + claim_opened event; a non-canonical claim refuses', () => {
    const spine = openReturnSpine();
    const filed = spine.fileCustodyLiabilityClaim(
      { orderId: CHAIN.order_id, cause: 'sera_damage', amount: 11_500, evidenceBundleId: 'eb-return-1', state: 'opened' },
      T_PLUS_16MIN,
    );
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.event.name).toBe('custody_liability.claim_opened.v1');
    // The EVENT carries no amount — the claim record holds the declared
    // figure; Séra emits signals, never amounts:
    expect(Object.keys(filed.event.payload).join(',')).not.toMatch(/amount|fcfa/i);
    expect(spine.allLiabilityClaims()).toHaveLength(1);
    expect(spine.fileCustodyLiabilityClaim({ orderId: CHAIN.order_id, cause: 'dropped_kerb' }, T_PLUS_16MIN))
      .toEqual({ ok: false, reason: 'claim_not_canonical' });
  });
});

describe('WO-2.2 NB fixes — attack replays', () => {
  it('NB②: a SECOND successful submission of the bound bundle REFUSES — no double-append, no re-emit (the WO-2.1 verifier probe)', () => {
    const spine = spineWithCourierCustody();
    expect(spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T)).toMatchObject({ ok: true, pending: false });
    const events = spine.allEvents().length;
    const ledger = spine.ledger.all().length;
    expect(spine.submitDeliveryEvidence(evidenceBundle(), 'server_confirmed', T)).toEqual({ ok: false, reason: 'evidence_already_submitted' });
    expect(spine.allEvents().length).toBe(events);
    expect(spine.ledger.all().length).toBe(ledger);
  });

  it("NB⑤: append() deep-copies — the WO-2.1 verifier's exact write-side probe now finds the store immune", () => {
    const ledger = new CustodyLedger();
    ledger.append({ packageId: 'p', kind: 'custody_transition', payload: { to: 'seller:s' }, at: T });
    const body = { packageId: 'p', kind: 'custody_seal_registered' as const, payload: { photoRefs: ['honest.jpg'] }, at: T };
    ledger.append(body);
    (body.payload.photoRefs as string[]).push('poisoned-after-append.jpg');
    expect(ledger.all()[1]!.payload['photoRefs']).toEqual(['honest.jpg']);
    expect(ledger.verifyChain()).toEqual({ valid: true });
  });

  it('NB④ (founder HARD REQUIREMENT): the offline flush drains EXCLUSIVELY through the server_confirmed binding path — a foreign queued bundle is refused at flush', () => {
    const spine = spineWithCourierCustody();
    expect(spine.submitDeliveryEvidence(evidenceBundle({ packageId: 'pkg-FOREIGN' }), 'queued_offline', T)).toEqual({ ok: true, pending: true });
    expect(spine.submitDeliveryEvidence(evidenceBundle(), 'queued_offline', T)).toEqual({ ok: true, pending: true });
    expect(spine.hasPendingOfflineEvidence()).toBe(true);
    const flushed = spine.flushOfflineEvidence(T_PLUS_10MIN);
    expect(flushed).toEqual({ drained: 2, accepted: 1, refusals: [{ reason: 'evidence_chain_mismatch' }] });
    expect(spine.hasPendingOfflineEvidence()).toBe(false);
    // The accepted one is the BOUND one, and validation now proceeds normally:
    const decided = spine.decideValidation(T_PLUS_10MIN);
    expect(decided.ok && decided.decision.result).toBe('validated');
  });
});

describe('WO-2.2 item 8 — ops alerts (reconciliation.alert.v1)', () => {
  it('impossible custody → alert emitted with the package and detail', () => {
    const ops = new OpsMonitor();
    const observed = ops.observe({ scenario: 'impossible_custody', packageId: 'pkg-9', detail: 'custodian_conflict refused at store', at: T });
    expect(observed.alerted).toBe(true);
    expect(observed.event?.name).toBe('reconciliation.alert.v1');
    expect(observed.event?.payload).toMatchObject({ scenario: 'impossible_custody', package_id: 'pkg-9' });
  });

  it('evidence-not-validated aging: young evidence does NOT alert; past the policy window it does (age honest)', () => {
    const ops = new OpsMonitor();
    expect(OPS_AGING_POLICY_V1.evidenceDecisionAgingMin).toBe(30);
    expect(ops.observe({ scenario: 'evidence_not_validated_aging', taskId: 't-1', submittedAt: T, now: T_PLUS_10MIN }).alerted).toBe(false);
    const aged = ops.observe({ scenario: 'evidence_not_validated_aging', taskId: 't-1', submittedAt: T, now: '2026-07-10T12:45:00.000Z' });
    expect(aged.alerted).toBe(true);
    expect(aged.event?.payload).toMatchObject({ scenario: 'evidence_not_validated_aging', task_id: 't-1', age_min: 45 });
    expect(ops.allAlerts()).toHaveLength(1);
  });
});

describe('WO-2.2 NB③ — RegisterOutcome is CHECKED at every caller (source-scan enforcement)', () => {
  it('no bare statement-position secrets.register() call exists in scripts/ or custody-service — every caller consumes the outcome', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const roots = [join(import.meta.dirname, '../../../scripts'), join(import.meta.dirname, '..')];
    const bare: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', '.turbo'].includes(name)) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|mjs)$/.test(name)) {
          readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
            // Statement position: the line BEGINS with the call — nothing
            // captures or checks the outcome.
            if (/^\s*[\w$.]*\.secrets\.register\(/.test(line)) bare.push(`${path}:${i + 1}`);
          });
        }
      }
    };
    for (const root of roots) walk(root);
    expect(bare, `unchecked secrets.register() calls:\n${bare.join('\n')}`).toEqual([]);
  });
});
