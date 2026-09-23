import type { RouteManifest } from '@platform/contracts';

/**
 * ═══ MANIFESTE-1 — the rider's RouteManifest, DERIVED (SE3.1, SE-I03) ═══
 *
 * Sera-Build-Spec §5: `RouteManifest{ id, riderId, version, orderedStops[],
 * custodyInventory[], status }`. SE-I03: « A courier has at most one active
 * RouteManifest and one current stop. » SE-I04: « task status alone MUST NOT
 * be custody truth. » Building-Plan SE3.1: « Ordered manifest; one active
 * route + one current stop; single-job (no batching); package accounted at
 * close; cancelled task can't leave custody inventory. » §8 SE3: « single-job
 * in pilot (no operational batching until E6); data model batch-capable ».
 *
 * WHY DERIVED, NEVER STORED. A second store beside the assignment book and
 * the custody ledger would be a third truth that drifts from both. The
 * manifest is computed on every read from the two truths that exist — the
 * book's courses and custody's OWN word on who holds each package — so:
 *   · one active manifest per rider holds BY CONSTRUCTION (its id is the
 *     rider's), and the one current stop is the head of the ordered stops;
 *   · the data model is batch-capable (arrays), while the pilot's single-job
 *     rule is enforced where it belongs — the assign door refuses a second
 *     live course;
 *   · « cancelled task can't leave custody inventory »: a course the desk
 *     took back or retired while the LEDGER still names this rider custodian
 *     stays in `custodyInventory` with no stop — the package is carried, the
 *     desk sees it, and the manifest cannot close over it;
 *   · « package accounted at close »: `closed` only when no stop remains AND
 *     nothing is carried — a manifest never closes with a package on it.
 *
 * The custody facts this reads are custody's answers, dated. When custody
 * could not be asked and no earlier answer exists, the course is walked as
 * not-yet-picked-up (both stops) and the reading is marked unknown — never a
 * guess from the task's status.
 */

export type StopKind = 'ramassage' | 'livraison' | 'retour';

export interface ManifestStop {
  readonly stopId: string;
  readonly kind: StopKind;
  readonly assignmentId: string;
  readonly taskId: string;
  readonly orderId: string;
}

/** One course as the book holds it, plus the two return flags the book keeps beside it. */
export interface ManifestCourse {
  readonly assignmentId: string;
  readonly taskId: string;
  readonly orderId: string;
  /** The book's status — active statuses walk stops; any other status only
   *  keeps a package the ledger still places with this rider. */
  readonly active: boolean;
  readonly retourOuvert: boolean;
  readonly retourDecide: boolean;
  /**
   * COLIS-FOURNISSEUR-1 — the OTHER orders this course carries (a package):
   * each article has its own custody file, so each is read on its own and
   * each held one rides the inventory. Absent on a course carrying one order.
   */
  readonly autres?: readonly string[];
  /** COLIS-FOURNISSEUR-1 — which orders are in the return bag, when one is
   *  open. Absent: an open return carries every order of the course. */
  readonly enRetour?: readonly string[];
}

/** Custody's own answer for one order, as last heard, with when. */
export interface CustodianFact {
  /** `courier:<riderId>` · `seller:<id>` · `customer` · null (chain open, nobody yet, or not open). */
  readonly custodian: string | null;
  readonly packageId: string | null;
  readonly asOf: string;
}

export interface RiderManifestView extends RouteManifest {
  readonly stops: readonly ManifestStop[];
  /** SE-I03 — the ONE current stop: the head of `orderedStops`, or none. */
  readonly currentStop: ManifestStop | null;
  /** Which courses were judged on a custody answer, and which on none. */
  readonly custodyReadings: readonly { orderId: string; reading: 'coursier' | 'ailleurs' | 'inconnue'; asOf: string | null }[];
}

export const courierActor = (riderId: string): string => `courier:${riderId}`;

export function deriveManifest(
  riderId: string,
  courses: readonly ManifestCourse[],
  custody: (orderId: string) => CustodianFact | undefined,
): RiderManifestView {
  const stops: ManifestStop[] = [];
  const inventory: string[] = [];
  const readings: { orderId: string; reading: 'coursier' | 'ailleurs' | 'inconnue'; asOf: string | null }[] = [];
  let heldCount = 0;
  for (const course of courses) {
    const ordres = [course.orderId, ...(course.autres ?? [])];
    const tenus: string[] = [];
    for (const orderId of ordres) {
      const fact = custody(orderId);
      const held = fact !== undefined && fact.custodian === courierActor(riderId);
      readings.push({
        orderId,
        reading: fact === undefined ? 'inconnue' : held ? 'coursier' : 'ailleurs',
        asOf: fact?.asOf ?? null,
      });
      if (!held) continue;
      heldCount += 1;
      tenus.push(orderId);
      if (fact.packageId !== null && !inventory.includes(fact.packageId)) inventory.push(fact.packageId);
    }
    if (tenus.length > 0) {
      if (course.active) {
        // Still ONE current stop at a time: the buyer's door while any held
        // article is still hers to receive, then the road home for what is
        // in the return bag (a package split at the door has both, in order).
        const enRetour = (orderId: string): boolean =>
          course.retourDecide || (course.enRetour ?? (course.retourOuvert ? ordres : [])).includes(orderId);
        for (const kind of ['livraison', 'retour'] as const) {
          if (!tenus.some((id) => enRetour(id) === (kind === 'retour'))) continue;
          stops.push({ stopId: `${kind}-${course.assignmentId}`, kind, assignmentId: course.assignmentId, taskId: course.taskId, orderId: course.orderId });
        }
      }
      // Not active and still held: the package rides the inventory with no
      // stop — the desk must give it a road. Never dropped.
      continue;
    }
    if (course.active) {
      stops.push({ stopId: `ramassage-${course.assignmentId}`, kind: 'ramassage', assignmentId: course.assignmentId, taskId: course.taskId, orderId: course.orderId });
      stops.push({ stopId: `livraison-${course.assignmentId}`, kind: 'livraison', assignmentId: course.assignmentId, taskId: course.taskId, orderId: course.orderId });
    }
  }
  return {
    id: `man-${riderId}`,
    riderId,
    // Every custody begin advances the manifest once (a stop completed);
    // deterministic from the facts, never a counter kept somewhere else.
    version: 1 + heldCount,
    orderedStops: stops.map((s) => s.stopId),
    custodyInventory: inventory,
    status: stops.length === 0 && inventory.length === 0 ? 'closed' : 'active',
    stops,
    currentStop: stops[0] ?? null,
    custodyReadings: readings,
  };
}

/** The package ids the ledger places with this rider — the end-shift
 *  declaration's `heldPackageIds` (SE3.2), read off the same facts. */
export function heldPackageIds(riderId: string, courses: readonly ManifestCourse[], custody: (orderId: string) => CustodianFact | undefined): string[] {
  return deriveManifest(riderId, courses, custody).custodyInventory.slice();
}
