import type { RouteManifest } from '@platform/contracts';

/**
 * WO-6.9-c · D3 — the LIVE BOARD read-model (SE-I03 · SE-I04 · task status is
 * never custody truth). PURE derivation, no I/O and NO custody WRITE: the
 * console renders custody, it never mutates a CustodyRecord (that is the
 * custody-service's authority). Mirrors the board's three governing sentences:
 *
 *  - SE-I03: "A courier has at most one active RouteManifest and one current
 *    stop." → `currentStop` is exactly `orderedStops[0]` (or null when the
 *    manifest is empty); the rest are `upcomingStops`.
 *  - SE-I04: "Every package has exactly one current custodian; task status
 *    alone MUST NOT be custody truth." → each inventory package carries exactly
 *    one `currentCustodian` (custody truth), rendered independently of the task.
 *  - PART 8 §3: "if the task says delivered and custody says otherwise, custody
 *    wins, and the divergence is an incident." → when a task claims delivered
 *    but custody has NOT reached the customer, the board renders CUSTODY (still
 *    held) and raises the divergence AS AN INCIDENT — never as agreement.
 */

/** Custody truth for one carried package — the custody-service is the source. */
export interface PackageCustody {
  readonly packageId: string;
  /** SE-I04: exactly one current custodian (e.g. `rider:issa`, `hub:ouaga`, `customer`). */
  readonly currentCustodian: string;
  /** The task's self-reported status — NEVER trusted as custody truth. */
  readonly taskStatus: string;
}

/** One package as the board renders it — custody truth first, divergence flagged. */
export interface BoardPackage {
  readonly packageId: string;
  readonly currentCustodian: string;
  readonly taskStatus: string;
  /**
   * 'incident' when the task claims delivered but custody has not reached the
   * customer — custody wins and the board shows it as an incident. 'agreement'
   * otherwise. There is NO third, quiet state: a divergence is never hidden.
   */
  readonly render: 'agreement' | 'incident';
}

export interface RiderBoard {
  readonly riderId: string;
  readonly manifestId: string;
  readonly version: number;
  /** SE-I03: exactly one current stop (the head of the ordered list), or null. */
  readonly currentStop: string | null;
  readonly upcomingStops: readonly string[];
  readonly packages: readonly BoardPackage[];
  /** True when any carried package is in the incident (divergence) state. */
  readonly hasIncident: boolean;
}

/** A task that claims delivery but whose package has not reached the customer is
 * a custody divergence: custody wins, the board renders an incident (PART 8 §3). */
export function isDivergence(pkg: PackageCustody): boolean {
  return pkg.taskStatus === 'delivered' && pkg.currentCustodian !== 'customer';
}

/**
 * Derive one rider's board from the canonical RouteManifest + custody truth.
 * The manifest's `custodyInventory` and the custody records must describe the
 * same package set; a package in the manifest with no custody record throws
 * (an unowned package is never renderable — SE-I04). Pure: no write, no clock.
 */
export function deriveRiderBoard(manifest: RouteManifest, custody: readonly PackageCustody[]): RiderBoard {
  const byId = new Map(custody.map((c) => [c.packageId, c] as const));
  const packages: BoardPackage[] = manifest.custodyInventory.map((packageId) => {
    const c = byId.get(packageId);
    if (c === undefined) {
      // SE-I04: a package on the manifest with no custodian is never rendered
      // as owned-by-nobody — that is a data fault, surfaced loudly, not hidden.
      throw new Error(`board: package ${packageId} on manifest ${manifest.id} has no custody record (SE-I04: never unowned)`);
    }
    return {
      packageId: c.packageId,
      currentCustodian: c.currentCustodian,
      taskStatus: c.taskStatus,
      render: isDivergence(c) ? 'incident' : 'agreement',
    };
  });
  const [currentStop = null, ...upcomingStops] = manifest.orderedStops;
  return {
    riderId: manifest.riderId,
    manifestId: manifest.id,
    version: manifest.version,
    currentStop,
    upcomingStops,
    packages,
    hasIncident: packages.some((p) => p.render === 'incident'),
  };
}
