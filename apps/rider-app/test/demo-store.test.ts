import { describe, expect, it } from 'vitest';
import {
  POLICY_CHECK_IDS,
  SANDBOX_PAYMENT_MODE,
  stepAfterInspection,
  stepAfterWindowExpiry,
  type PolicyCheckId,
} from '../src/custody-flow.js';
import * as store from '../src/demo/store.js';
import {
  acceptInspection,
  acknowledgeCourse,
  applyProviderDoorSignal,
  beginPickup,
  captureEvidence,
  chooseFailureReason,
  completeReturn,
  createDemoWorld,
  expireRetryWindow,
  passVerification,
  prepareReturn,
  refusePickup,
  registerSeal,
  reportProblem,
  retryDelivery,
  seedCourses,
  validateDropCode,
} from '../src/demo/store.js';

/**
 * WO-4.1 — the demo world obeys the custody law. The FULL walk runs through
 * the custody-flow.ts rule functions (the store guards every source step and
 * throws on any out-of-order move); the refusal branch is as walkable as the
 * happy one; window expiry takes exactly the arm stepAfterWindowExpiry
 * dictates; and the SE-I11 seam holds: the door-payment wait advances ONLY
 * on the provider-confirmed signal — a value the rider asserts does not
 * exist in the types and throws at runtime.
 */

const allChecks = (): Partial<Record<PolicyCheckId, boolean>> =>
  Object.fromEntries(POLICY_CHECK_IDS.map((id) => [id, true]));

describe('demo world custody walk', () => {
  it('walks the FULL happy path through custody-flow: verify → accept → seal → evidence → door → provider signal → drop → validé', () => {
    const world = createDemoWorld();
    const id = 'course-awa';
    acknowledgeCourse(world, id);
    const acked = world.courses.find((c) => c.id === id)!;
    expect(acked.ack).toBe('ack_pending'); // queued = pending — it confers nothing
    expect(acked.step).toBe('affectation');
    expect(beginPickup(world, id)).toBe('verify');
    // the policy checklist gates the seal: a partial checklist is refused
    expect(() => passVerification(world, id, { order_ref: true })).toThrow();
    expect(passVerification(world, id, allChecks())).toBe('seal');
    expect(registerSeal(world, id)).toBe('evidence');
    // WO-2.4: the door inspection precedes the drop in the online branch
    expect(captureEvidence(world, id, 'online')).toBe('door_inspection');
    // Option-B: the inspection outcome comes from stepAfterInspection
    expect(acceptInspection(world, id, SANDBOX_PAYMENT_MODE)).toBe(stepAfterInspection(SANDBOX_PAYMENT_MODE));
    expect(applyProviderDoorSignal(world, id, 'confirmed')).toBe('drop');
    expect(validateDropCode(world, id)).toBe('delivered');
    expect(world.courses.find((c) => c.id === id)!.closed).toBe(true);
  });

  it('the refusal branch is walkable and dignified: refusing at verification closes the course', () => {
    const world = createDemoWorld();
    const id = 'course-awa';
    beginPickup(world, id);
    expect(refusePickup(world, id)).toBe('refused');
    expect(world.courses.find((c) => c.id === id)!.closed).toBe(true);
    // no seal can follow a refusal — out-of-order moves throw
    expect(() => registerSeal(world, id)).toThrow();
  });

  it('offline evidence stays queued = PENDING and the drop stays locked', () => {
    const world = createDemoWorld();
    const id = 'course-awa';
    beginPickup(world, id);
    passVerification(world, id, allChecks());
    registerSeal(world, id);
    expect(captureEvidence(world, id, 'offline')).toBe('evidence_pending');
    expect(() => validateDropCode(world, id)).toThrow(); // finality never happens offline
    // the seeded offline course carries the same honest state
    expect(seedCourses().find((c) => c.id === 'course-issouf')!.step).toBe('evidence_pending');
  });

  it('window expiry walks the arm stepAfterWindowExpiry dictates: honest absence → reschedule + a 2e passage with lineage', () => {
    const world = createDemoWorld();
    const id = 'course-awa';
    beginPickup(world, id);
    passVerification(world, id, allChecks());
    registerSeal(world, id);
    captureEvidence(world, id, 'online');
    reportProblem(world, id);
    chooseFailureReason(world, id, 'honest_absence');
    expect(stepAfterWindowExpiry('honest_absence')).toBe('reschedule_planned');
    expect(expireRetryWindow(world, id)).toBe(stepAfterWindowExpiry('honest_absence'));
    expect(world.courses.find((c) => c.id === id)!.closed).toBe(true);
    const secondPass = world.courses.find((c) => c.id === `${id}-p2`)!;
    expect(secondPass.attempt).toBe(2);
    expect(secondPass.kind).toBe('deuxieme_passage');
    expect(secondPass.step).toBe('door_inspection'); // custody continues — the walk resumes at the door
    expect(secondPass.name).toContain('(démo)');
  });

  it('the retry re-runs the door leg — the drop code is never reachable around the payment', () => {
    const world = createDemoWorld();
    const id = 'course-salif'; // seeded 2e passage, already at the door
    reportProblem(world, id);
    chooseFailureReason(world, id, 'provider_failure');
    expect(retryDelivery(world, id)).toBe('door_inspection');
    expect(acceptInspection(world, id)).toBe('payment_wait');
    expect(() => validateDropCode(world, id)).toThrow(); // no drop while the payment waits
  });

  it('the escalating arm walks to refused_final and the two-key return closes the course', () => {
    const world = createDemoWorld();
    const id = 'course-salif';
    reportProblem(world, id);
    chooseFailureReason(world, id, 'change_of_mind');
    expect(stepAfterWindowExpiry('change_of_mind')).toBe('refused_final');
    expect(expireRetryWindow(world, id)).toBe(stepAfterWindowExpiry('change_of_mind'));
    expect(prepareReturn(world, id)).toBe('retour_colis');
    expect(completeReturn(world, id)).toBe('retour_colis');
    expect(world.courses.find((c) => c.id === id)!.closed).toBe(true);
  });

  it('the door-payment wait advances ONLY on the provider-confirmed signal (SE-I11 canon seam)', () => {
    const world = createDemoWorld();
    const id = 'course-salif';
    expect(acceptInspection(world, id)).toBe('payment_wait');
    // the pending signal does not advance the walk
    expect(applyProviderDoorSignal(world, id, 'pending')).toBe('payment_wait');
    // a value asserted by the rider is not a provider signal: the type
    // refuses it at compile time AND the walk throws at runtime
    expect(() =>
      // @ts-expect-error — outside the provider signal type (SE-I11)
      applyProviderDoorSignal(world, id, 'moi_le_livreur'),
    ).toThrow();
    // no drop code while the payment is unconfirmed
    expect(() => validateDropCode(world, id)).toThrow();
    // the provider-confirmed signal is the only way forward
    expect(applyProviderDoorSignal(world, id, 'confirmed')).toBe('drop');
    // and the store has exactly ONE door-advance surface — the signal one
    const doorSurfaces = Object.keys(store).filter((k) => /door|signal|pay/i.test(k));
    expect(doorSurfaces).toEqual(['applyProviderDoorSignal']);
  });

  it('seeds: 3+ courses, one of each walk, every name démo-marked, locations landmark-first', () => {
    const seeds = seedCourses();
    expect(seeds.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(seeds.map((c) => c.kind));
    expect(kinds.has('livraison')).toBe(true);
    expect(kinds.has('deuxieme_passage')).toBe(true);
    expect(kinds.has('retour')).toBe(true);
    for (const c of seeds) {
      expect(c.name).toContain('(démo)');
      expect(c.locationLines).toHaveLength(3);
    }
  });

  it('reset restores the exact seed; the seeded return course obeys the expiry rule', () => {
    const world = createDemoWorld();
    beginPickup(world, 'course-awa');
    refusePickup(world, 'course-awa');
    expect(createDemoWorld().courses).toEqual(seedCourses());
    const retour = seedCourses().find((c) => c.kind === 'retour')!;
    expect(retour.step).toBe('refused_final');
    expect(retour.failureReason).not.toBeNull();
    // the seed bends to the rules: its recorded reason really escalates
    expect(stepAfterWindowExpiry(retour.failureReason!)).toBe('refused_final');
  });
});
