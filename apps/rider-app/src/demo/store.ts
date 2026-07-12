import type { Screen } from '../journey';
import { SANDBOX_ASSIGNMENT } from '../sandbox-assignment';
import {
  CONNECTIVITY,
  POLICY_CHECK_IDS,
  SANDBOX_DOOR_SIGNAL,
  SANDBOX_PAYMENT_MODE,
  nextAfterEvidence,
  stepAfterDoorSignal,
  stepAfterInspection,
  stepAfterWindowExpiry,
  type FailureReasonId,
  type PolicyCheckId,
} from '../custody-flow';

/**
 * WO-4.1 demo world — in-memory, seeded, honest. Every custody move on every
 * demo course goes through custody-flow.ts (the rule source); each walk
 * function guards its source step, so an out-of-order move throws instead of
 * happening. Seed names are obviously fictional — « (démo) » on every course
 * — so demo data can never pass for real user data. Locations are
 * landmark-first (SE0.3): [landmark, directions, zone].
 */

/** A course's position in the walkable world: the assignment card, then the
 * custody steps custody-flow.ts names, then the return leg. */
export type CourseStep = Exclude<Screen, 'service' | 'courses'>;

export type CourseKind = 'livraison' | 'deuxieme_passage' | 'retour';

export interface DemoCourse {
  readonly id: string;
  /** Seed data, not UI chrome — obviously fictional French demo content. */
  readonly name: string;
  readonly locationLines: readonly [string, string, string];
  readonly kind: CourseKind;
  /** Lineage: a 2e passage carries attempt 2 and shows it. */
  readonly attempt: 1 | 2;
  readonly step: CourseStep;
  /** Offline law: an ack — or a decline (WO-4.3) — queued without the
   * network is PENDING, it confers nothing. */
  readonly ack: 'none' | 'ack_pending' | 'decline_pending';
  readonly failureReason: FailureReasonId | null;
  /** WO-4.3 — how a proposal ended, when it did not become a pickup: the
   * rider gave it back (server-confirmed decline) or the window passed. */
  readonly proposalOutcome: 'declined' | 'expired' | null;
  /** A closed course stays on the list with its honest status; it no longer
   * opens. */
  readonly closed: boolean;
}

export interface DemoWorld {
  courses: DemoCourse[];
}

const seed = (
  id: string,
  name: string,
  locationLines: readonly [string, string, string],
  kind: CourseKind,
  attempt: 1 | 2,
  step: CourseStep,
  failureReason: FailureReasonId | null = null,
  ack: DemoCourse['ack'] = 'none',
): DemoCourse => ({ id, name, locationLines, kind, attempt, step, ack, failureReason, proposalOutcome: null, closed: false });

export function seedCourses(): DemoCourse[] {
  return [
    // The happy walk — the same Gounghin sandbox world the console assigns
    // from; the full custody walk starts at the assignment card.
    seed('course-awa', 'Colis pour Awa (démo)', SANDBOX_ASSIGNMENT.locationLines, 'livraison', 1, 'affectation'),
    // The reschedule walk — a 2e passage: custody is already sealed from the
    // first attempt, the rider returns to the client's door.
    seed(
      'course-salif',
      'Colis pour Salif (démo)',
      ['Derrière la grande mosquée', 'Portail vert, à côté du tailleur', 'Dapoya'],
      'deuxieme_passage',
      2,
      'door_inspection',
    ),
    // The return walk — the ladder already ended at refused_final for a
    // buyer-fault reason (seed pinned by test: stepAfterWindowExpiry must
    // produce refused_final for it — the seed bends to the rules).
    seed(
      'course-mariam',
      'Colis pour Mariam (démo)',
      ['Face au château d’eau', 'Cour commune, deuxième porte', 'Tanghin'],
      'retour',
      1,
      'refused_final',
      'change_of_mind',
    ),
    // The offline branch, honest and walkable: the photo went out without
    // the network — queued = PENDING, the drop step stays LOCKED.
    seed(
      'course-issouf',
      'Colis pour Issouf (démo)',
      ['À côté de la station', 'Kiosque jaune devant la cour', 'Pissy'],
      'livraison',
      1,
      'evidence_pending',
    ),
    // WO-4.3, the offline-DECLINE branch, honest and walkable (the Issouf
    // pattern): the refusal went out without the network — queued = PENDING,
    // it confers nothing; the course is still proposed and the window still
    // runs.
    seed(
      'course-fatou',
      'Colis pour Fatou (démo)',
      ['En face du maquis', 'Cour au portail rouge', 'Cissin'],
      'livraison',
      1,
      'affectation',
      null,
      'decline_pending',
    ),
  ];
}

export function createDemoWorld(): DemoWorld {
  return { courses: seedCourses() };
}

function courseById(world: DemoWorld, id: string): DemoCourse {
  const course = world.courses.find((c) => c.id === id);
  if (course === undefined) throw new Error(`unknown demo course: ${id}`);
  return course;
}

function expectStep(course: DemoCourse, allowed: readonly CourseStep[]): void {
  if (course.closed || !allowed.includes(course.step)) {
    throw new Error(`custody out of order: course ${course.id} is at '${course.step}'${course.closed ? ' (closed)' : ''}, move requires ${allowed.join(' | ')}`);
  }
}

function update(world: DemoWorld, id: string, patch: Partial<DemoCourse>): DemoCourse {
  world.courses = world.courses.map((c) => (c.id === id ? { ...c, ...patch } : c));
  return courseById(world, id);
}

/** The rider's ack — queued = PENDING, never done; it confers nothing. */
export function acknowledgeCourse(world: DemoWorld, id: string): void {
  expectStep(courseById(world, id), ['affectation']);
  update(world, id, { ack: 'ack_pending' });
}

/**
 * WO-4.3 — the rider gives the course back. The captureEvidence convention:
 * both connectivity arms are real code paths. OFFLINE: the decline is
 * queued = PENDING, it confers NOTHING — the course stays proposed and the
 * answer window still runs (only a server-confirmed decline releases;
 * kernel law). ONLINE (server-confirmed): the course returns to the
 * dispatch list — closed here with its honest outcome, as dignified as an
 * acceptance.
 */
export function declineCourse(
  world: DemoWorld,
  id: string,
  connectivity: typeof CONNECTIVITY = CONNECTIVITY,
): CourseStep {
  expectStep(courseById(world, id), ['affectation']);
  if (connectivity === 'offline') {
    return update(world, id, { ack: 'decline_pending' }).step;
  }
  return update(world, id, { proposalOutcome: 'declined', closed: true }).step;
}

/**
 * WO-4.3 — the answer window passed (5 min — the WO-1.2 ack deadline; the
 * live sweep drives this at assembly, the demo exposes it as an explicit
 * lever). Expiry bites PENDING acks and PENDING declines alike — queued =
 * pending, never done. The course closes with its honest outcome; the
 * dispatcher's list gets the task back.
 */
export function expireProposal(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['affectation']);
  return update(world, id, { proposalOutcome: 'expired', closed: true }).step;
}

/** Walking to the pickup — navigation, custody has not begun. */
export function beginPickup(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['affectation']);
  return update(world, id, { step: 'verify' }).step;
}

/** The policy checklist gate (SE-I05 mirror): every check, or no seal. */
export function passVerification(
  world: DemoWorld,
  id: string,
  checks: Readonly<Partial<Record<PolicyCheckId, boolean>>>,
): CourseStep {
  expectStep(courseById(world, id), ['verify']);
  if (!POLICY_CHECK_IDS.every((checkId) => checks[checkId] === true)) {
    throw new Error('pickup verification requires every policy check');
  }
  return update(world, id, { step: 'seal' }).step;
}

/** The refusal arm — as dignified as acceptance; the course closes. */
export function refusePickup(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['verify']);
  return update(world, id, { step: 'refused', closed: true }).step;
}

/** Seal posed — custody begins (live registration lands at assembly). */
export function registerSeal(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['seal']);
  return update(world, id, { step: 'evidence' }).step;
}

/** Evidence photo — the branch comes from nextAfterEvidence; the WO-2.4
 * mapping keeps the door inspection ahead of the drop in both modes.
 * Offline: queued = PENDING, the drop step stays LOCKED. */
export function captureEvidence(
  world: DemoWorld,
  id: string,
  connectivity: typeof CONNECTIVITY = CONNECTIVITY,
): CourseStep {
  expectStep(courseById(world, id), ['evidence']);
  const next = nextAfterEvidence(connectivity);
  return update(world, id, { step: next === 'drop' ? 'door_inspection' : next }).step;
}

/** The client agrees at the door — the branch comes from stepAfterInspection
 * (Option-B: payment before the drop code; FULL_PREPAY: straight to drop). */
export function acceptInspection(
  world: DemoWorld,
  id: string,
  mode: typeof SANDBOX_PAYMENT_MODE = SANDBOX_PAYMENT_MODE,
): CourseStep {
  expectStep(courseById(world, id), ['door_inspection']);
  return update(world, id, { step: stepAfterInspection(mode) }).step;
}

/** SE-I11: the ONLY way out of payment_wait. The input is the PROVIDER
 * signal and nothing else — no function in this module advances the door
 * state on the rider's word, and a value outside the signal type throws. */
export function applyProviderDoorSignal(
  world: DemoWorld,
  id: string,
  signal: typeof SANDBOX_DOOR_SIGNAL,
): CourseStep {
  expectStep(courseById(world, id), ['payment_wait']);
  if (signal !== 'confirmed' && signal !== 'pending') {
    throw new Error('only the provider signal moves the door state (SE-I11)');
  }
  return update(world, id, { step: stepAfterDoorSignal(signal) }).step;
}

/** The buyer's drop code — the LAST step; the course closes delivered. */
export function validateDropCode(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['drop']);
  return update(world, id, { step: 'delivered', closed: true }).step;
}

/** The refusal-ladder entry — from the door or the drop, it whispers. */
export function reportProblem(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['door_inspection', 'drop']);
  return update(world, id, { step: 'refusal_reason' }).step;
}

/** One canonical reason opens the ONE retry window. */
export function chooseFailureReason(world: DemoWorld, id: string, reason: FailureReasonId): CourseStep {
  expectStep(courseById(world, id), ['refusal_reason']);
  return update(world, id, { failureReason: reason, step: 'retry_window' }).step;
}

/** The retry re-runs inspection → provider-confirmed payment → drop: the
 * drop code stays LAST (safest default, journaled — never a shortcut past
 * the payment leg). */
export function retryDelivery(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['retry_window']);
  return update(world, id, { step: 'door_inspection' }).step;
}

/** Window expiry — the arm comes from stepAfterWindowExpiry. A first-attempt
 * reschedule spawns the honest 2e passage course (lineage visible); the
 * expired attempt closes. */
export function expireRetryWindow(world: DemoWorld, id: string): CourseStep {
  const course = courseById(world, id);
  expectStep(course, ['retry_window']);
  if (course.failureReason === null) throw new Error('window expiry requires the chosen reason');
  const next = stepAfterWindowExpiry(course.failureReason);
  if (next === 'reschedule_planned') {
    if (course.attempt === 1) {
      world.courses = [
        ...world.courses,
        {
          ...course,
          id: `${course.id}-p2`,
          kind: 'deuxieme_passage',
          attempt: 2,
          step: 'door_inspection',
          failureReason: null,
          closed: false,
        },
      ];
    }
    return update(world, id, { step: next, closed: true }).step;
  }
  return update(world, id, { step: next }).step;
}

/** From the dignified stop to the return leg — the package goes back. */
export function prepareReturn(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['refused_final']);
  return update(world, id, { step: 'retour_colis' }).step;
}

/** SE6.2 two-key return: the seller's code and the rider's code, both or
 * neither — the demo states it and closes the course; the live handover
 * (both keys consumed together) lands with the service at assembly. */
export function completeReturn(world: DemoWorld, id: string): CourseStep {
  expectStep(courseById(world, id), ['retour_colis']);
  return update(world, id, { closed: true }).step;
}
