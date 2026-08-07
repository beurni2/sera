/**
 * ═══ PackageClaimDO — ONE CUSTODY FILE PER PACKAGE, ENFORCED BY ADDRESS ═══
 *
 * SE-LIVE-4a. This object exists to close the one defect the founder deferred
 * out of SE-LIVE-3 and named as this slice's first prerequisite.
 *
 * THE DEFECT. Canon keys the custody record by PACKAGE —
 *
 *   Sera-Build-Spec.md:79
 *     `CustodyRecord{ packageId, currentCustodian, transitions[], exception? }
 *      // exactly one current custodian`
 *   Sera-Build-Spec.md:36 (SE-I04)
 *     « Every package has **exactly one current custodian**; task status alone
 *       MUST NOT be custody truth. »
 *
 * — while `CustodyDO` is addressed `idFromName(orderId)`. Two orders naming the
 * same `packageId` therefore opened two custody files over one physical
 * package, each with its own ledger and its own `custodianByPackage` map
 * (`src/custody-ledger.ts:61`). SE-I04 is enforced INSIDE one ledger and is
 * blind across two. That was harmless in SE-LIVE-3 because no route there
 * transitions custody — `currentCustodian` was always undefined, so there were
 * no custodians for the invariant to be violated about. SE-LIVE-4 adds the
 * seal and the transitions, and the day it does, « two files over one package »
 * becomes two live custodians for one package.
 *
 * THE FIX, and why this shape. The package gets an address of its own: one
 * instance of this class per `packageId`, holding one write-once row that names
 * the order allowed to carry it. `CustodyDO./order/open` must win that claim
 * BEFORE it writes its chain, so a second order over a claimed package never
 * gets a custody file at all. Uniqueness stops being a property somebody
 * upstream has to remember and becomes a property of where the bytes live —
 * which is the same reasoning the ecosystem already applied to storefront slugs
 * (shop-plus `storefront-do.ts:24`, « SHAPE C (founder ruling) »).
 *
 * A SEPARATE CLASS, not a `pkg:`-prefixed CustodyDO instance. Same-class
 * pointers work when nobody can choose the address; here the founder's door
 * takes an arbitrary `orderId` and routes it straight to
 * `idFromName(orderId)`, so an order literally named `pkg:pkg-1` would land on
 * a claim object and open a custody chain on top of it. A second class cannot
 * be reached by that door at all — no prefix ban to write, no prefix ban to
 * forget.
 *
 * WHAT THIS DOES NOT DEFEND. The claim row is ordinary DO storage, outside the
 * `custody:ledger-head:v1` integrity head (which covers one object's chain,
 * command log and ledger — it cannot bind a row in a different object). Someone
 * who can write storage directly can erase a claim. That is the storage-level
 * attacker the founder ruled out of scope for M4 (« defend what is reachable
 * through the door »), and it is stated here rather than papered over.
 */

const CLAIM_KEY = 'custody:package-claim:v1';
const MAX_ID = 256;

export interface PackageClaim {
  packageId: string;
  /** The ONE order whose custody file may carry this package. */
  orderId: string;
  at: string;
}

/** Written as a scan rather than a character-class regex so the control bytes
 *  it bans never have to appear literally in this file. */
function hasControlChar(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Same bound and same character class the custody door already enforces:
 *  ids are identifiers, not payloads, and control bytes never belong in one. */
const isBoundedId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.trim().length <= MAX_ID && !hasControlChar(v);

export class PackageClaimDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    /**
     * THE NAME ANCHOR — the round-5/round-6 lesson from `CustodyDO`, applied
     * here from the first line rather than after a verifier finds it. The
     * caller tells this object which package it is (a fresh header object it
     * cannot forge), and a stored claim that names a DIFFERENT package means
     * this row was moved into an object it does not belong to. A MISSING
     * header is a failure, not a skip: « a gate added later is a gate that
     * already let something through ».
     */
    const objectName = request.headers.get('X-Package-Object');
    if (!isBoundedId(objectName)) {
      return Response.json({ ok: false, reason: 'package_object_not_named' }, { status: 400 });
    }
    const held = (await this.state.storage.get<PackageClaim>(CLAIM_KEY)) ?? null;
    if (held !== null && held.packageId !== objectName) {
      return Response.json({ ok: false, reason: 'claim_does_not_name_this_object' }, { status: 409 });
    }

    /** FIRST-WINS, WRITE-ONCE. The package belongs to the order that claimed
     *  it; a re-claim by the SAME order is absorbed (so a retry after a failed
     *  chain write is not a permanent lock-out), and any other order is
     *  refused with the holder named, because « refused » with no reason
     *  leaves an operator guessing at the one moment he must not. */
    if (request.method === 'POST' && pathname === '/claim') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null || !isBoundedId(body['packageId']) || !isBoundedId(body['orderId']) || !isBoundedId(body['at'])) {
        return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
      }
      const packageId = (body['packageId'] as string).trim();
      const orderId = (body['orderId'] as string).trim();
      if (packageId !== objectName) {
        return Response.json({ ok: false, reason: 'package_id_does_not_name_this_object' }, { status: 400 });
      }
      if (held !== null) {
        return held.orderId === orderId
          ? Response.json({ ok: true, status: 'already_claimed', claim: held })
          : Response.json({ ok: false, reason: 'package_claimed_by_other_order', claim: held }, { status: 409 });
      }
      const claim: PackageClaim = { packageId, orderId, at: (body['at'] as string).trim() };
      await this.state.storage.put(CLAIM_KEY, claim);
      return Response.json({ ok: true, status: 'claimed', claim });
    }

    /** The operator read: who holds this package. No custody content, no
     *  secrets — one row saying which order's file is the real one. */
    if (request.method === 'GET' && pathname === '/claim') {
      return held === null
        ? Response.json({ ok: false, reason: 'package_unclaimed' }, { status: 404 })
        : Response.json({ ok: true, claim: held });
    }

    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }
}
