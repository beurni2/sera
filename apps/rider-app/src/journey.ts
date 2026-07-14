import {
  FAILURE_REASON_IDS,
  stepAfterDoorSignal,
  stepAfterEvidenceAck,
  stepAfterInspection,
  stepAfterWindowExpiry,
  type CustodyStep,
} from './custody-flow';
import type { FlushOutcome } from './offline/outbox';

/**
 * WO-4.1 — the rider journey as DATA. The App renders a stack over this map;
 * the spine test walks it (BFS from START must reach every screen) so the
 * walkable-world promise is asserted, not assumed. No navigation library: a
 * state stack keeps the bundle inside budgets.
 *
 * THE RULE LAW: custody-flow.ts owns every custody transition. The edges out
 * of the rule-owned screens below are COMPUTED by evaluating those functions
 * over their full input domains (both connectivity branches, both payment
 * modes, both door signals, all seven failure reasons) — this file never
 * re-encodes a transition, it enumerates what the rules produce.
 */

export type Screen = 'service' | 'courses' | 'affectation' | 'retour_colis' | CustodyStep;

export const START: Screen = 'service';

/** WO-2.4 mapping, kept from the shell: the door inspection precedes the
 * drop in BOTH payment modes — a server-acked evidence outcome of 'drop'
 * enters through door_inspection. SE-I06: the ack, not connectivity, is the
 * edge out of evidence_pending. */
const afterAck = (ack: FlushOutcome): CustodyStep => {
  const next = stepAfterEvidenceAck(ack);
  return next === 'drop' ? 'door_inspection' : next;
};

const uniq = (steps: readonly CustodyStep[]): readonly CustodyStep[] => [...new Set(steps)];

/**
 * Where a course card may open a course: seed entry steps plus every step
 * the in-course « Retour » can deposit a course at (state kept — see
 * COURSE_BACK_STEPS). Closed courses never reopen; their card is not
 * pressable.
 */
export const COURSE_OPEN_STEPS: readonly Screen[] = [
  'affectation',
  'verify',
  'seal',
  'evidence',
  'evidence_pending',
  'door_inspection',
  'payment_wait',
  'drop',
  'refusal_reason',
  'retry_window',
  'refused_final',
  'retour_colis',
];


/** Forward edges only — « Retour » pops the stack (or, mid-custody, returns
 * to the course list) and is always available. */
export const JOURNEY: Record<Screen, readonly Screen[]> = {
  service: ['affectation', 'courses'],
  affectation: ['verify', 'courses'],
  courses: COURSE_OPEN_STEPS,
  // The checklist gate is policy DATA (POLICY_CHECK_IDS all checked), not a
  // transition function — accept and refuse are the two documented arms.
  verify: ['seal', 'refused'],
  refused: ['courses'],
  seal: ['evidence'],
  // SE-I06: capturing ALWAYS lands evidence_pending (online or offline); the
  // drop stays locked until the server ack. Never an edge straight to the door.
  evidence: ['evidence_pending'],
  // The ONLY forward edge is the authoritative server ack, produced by
  // stepAfterEvidenceAck: applied/idempotentReplay → door_inspection;
  // collision-refused maps to itself (waiting is a state, not an edge). « Retour »
  // to the course list is the quiet arm.
  evidence_pending: [
    ...uniq([afterAck('applied'), afterAck('collision-refused')]).filter((s) => s !== 'evidence_pending'),
    'courses',
  ],
  // Both payment modes, produced by stepAfterInspection; the problem path
  // (refusal ladder entry) is the documented quiet arm.
  door_inspection: [
    ...uniq([
      stepAfterInspection('DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR'),
      stepAfterInspection('FULL_PREPAY'),
    ]),
    'refusal_reason',
  ],
  // SE-I11: ONLY the provider-confirmed signal produces a way forward;
  // the pending signal maps to itself (waiting is a state, not an edge).
  payment_wait: uniq([stepAfterDoorSignal('confirmed'), stepAfterDoorSignal('pending')]).filter(
    (s) => s !== 'payment_wait',
  ),
  drop: ['delivered', 'refusal_reason'],
  delivered: ['courses'],
  refusal_reason: ['retry_window'],
  // The retry re-runs inspection → provider-confirmed payment → drop
  // (safest default: the drop code stays LAST, never reachable around the
  // payment leg); the expiry arms are produced by stepAfterWindowExpiry
  // over all seven canonical reasons.
  retry_window: uniq([
    'door_inspection',
    ...FAILURE_REASON_IDS.map((reason) => stepAfterWindowExpiry(reason)),
  ]),
  refused_final: ['retour_colis'],
  reschedule_planned: ['courses'],
  retour_colis: ['courses'],
};

/**
 * WO-4.1 back-navigation rule (widened after the verifier's blocking
 * finding — it originally covered only the five sealed steps): a course's
 * truth lives in `course.step`, so popping the stack ANYWHERE inside a
 * course can re-show a screen whose actions are stale — the store refuses
 * the move (custody stays safe) but the rider hits a dead button, and
 * mid-ladder the pop re-shows the drop screen: a lie about custody. One
 * uniform rule instead: inside a course, « Retour » returns to the course
 * list; the course keeps its exact step and reopening it resumes where
 * custody truly stands. Pops remain only outside courses.
 */
export const COURSE_BACK_STEPS: readonly Screen[] = (Object.keys(JOURNEY) as Screen[]).filter(
  (s) => s !== 'service' && s !== 'courses',
);
