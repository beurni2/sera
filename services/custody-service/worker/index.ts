import { CustodyDO } from './custody-do.js';
import { PackageClaimDO } from './package-claim-do.js';

export { CustodyDO, PackageClaimDO };

/**
 * custody-service Worker entry (SE-LIVE-3, M4).
 *
 * TWO DOORS, as of SE-LIVE-4b-ii. Everything except GET /health is gated:
 *
 *   · `/ops/*`   — the founder's `SERA_CUSTODY_OPS_SECRET`, opening EVERY
 *                  route on the object. A `riderId` he supplies is his
 *                  ATTESTATION of who acted, and is recorded as exactly that.
 *   · `/rider/*` — the rider's OWN personal code, resolved against the
 *                  logistics Worker (the one book that mints and revokes it),
 *                  opening ONLY the two acts SE-I05 gives a rider. See
 *                  RIDER_ROUTES below — that allowlist is load-bearing.
 *
 * Both are wrangler SECRETS, never `[vars]` entries (this repo is PUBLIC).
 * FAIL CLOSED: a Worker deployed before a secret is set refuses that door
 * entirely, with one identical 401.
 *
 * ⚠ HOW THIS GOT HERE — FOUNDER RULING (2026-08-06, option 2). SE-LIVE-3 ran
 * on the founder's key ALONE, because rider identity lives in logistics and
 * building a throwaway rider door was worse than waiting one slice: that slice
 * made the LEDGER live, durable and tamper-evident, and every `riderId` in it
 * was explicitly the founder's word. SE-LIVE-4b-ii is where the rider's own
 * authenticated hand arrives, so the ledger now records WHICH of the two each
 * act was (`attribution`), per act, rather than asserting one label over all
 * of them.
 *
 * SEPARATE WORKER, deliberately: the custody core hashes with node's
 * synchronous `createHash`, which needs `nodejs_compat`. Keeping custody in
 * its own Worker scopes that runtime flag to the code that needs it instead of
 * changing the runtime under the already-verified dispatch Worker, and keeps a
 * custody outage independent of a dispatch outage. The spec separates these
 * services; so does the deploy.
 *
 * ONE OBJECT PER ORDER: `idFromName(orderId)`. A package's custody file is its
 * own serialized world — two acts on one order can never interleave, and two
 * orders can never contend.
 */

// SERVICE-PROVENANCE (the F9 lesson): the deploy workflow stamps the bundle,
// /health answers with it, the post-deploy assertion polls until the live
// Worker IS this build. esbuild --define; 'dev' outside the workflow.
declare const __SERA_RELEASE__: string;
declare const __SERA_CANON__: string;

export interface Env {
  readonly CUSTODY: DurableObjectNamespace;
  /**
   * SE-LIVE-4a — the per-package claim namespace. NO ROUTE ON THIS WORKER
   * ADDRESSES IT: the founder's door resolves an order and hands it to
   * `CUSTODY`, and the custody object alone reaches the claim object, before
   * it writes its chain. That is deliberate — a package's one-file-only rule
   * should not be something an operator can reach around.
   */
  readonly PACKAGE_CLAIM: DurableObjectNamespace;
  readonly SERA_CUSTODY_OPS_SECRET?: string;
  /**
   * SE-LIVE-4b-ii — the logistics Worker, over a service binding. Custody ASKS
   * it who a rider is; custody never stores rider credentials (founder ruling
   * 2026-08-07: one book mints and revokes).
   */
  readonly LOGISTICS?: { fetch: (request: Request) => Promise<Response> };
  /** The key to logistics' `/verify/` door. Custody's own, not the founder's. */
  readonly SERA_RIDER_VERIFY_SECRET?: string;
  /**
   * COURSE-LIVRÉE (founder, 2026-08-13) — the key to logistics' `/produce/`
   * door: the CustodyDO's third outbox wire posts the provider-truth drop
   * confirmation there, which closes the course as `delivered` and frees the
   * rider. Read by the DO (it shares this env), presented over the LOGISTICS
   * binding above. `wrangler secret put` on BOTH Workers, the founder's
   * alone; unset ⇒ the wire rests honestly (`unsendable_no_config`).
   */
  readonly SERA_COURSE_LIVREE_SECRET?: string;
  /**
   * VRAI-ROUTE — the two producer keys (see PRODUCE_ROUTES below). Both are
   * wrangler SECRETS, the founder's alone to set; a Worker deployed before
   * one is set refuses that door entirely, with the same identical 401.
   */
  readonly SERA_PRODUCE_SECRET?: string;
  readonly SHOP_ARM_SECRET?: string;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * ═══ WHAT A RIDER'S CODE OPENS — AND NOTHING ELSE ═══
 *
 * ⚠ VERIFIER BLOCKER (4b round 1) — THE RIDER DOOR HAD NO ALLOWLIST. The
 * `/rider/` prefix gated AUTHENTICATION only; the path rewrite below then
 * handed whatever was asked for to the object. So one valid rider code opened
 * ALL NINE of the object's routes, on ANY order id, for EVERY rider in the
 * book — and it did so without ever consulting the founder's key. Measured on
 * the shipped bundle, three separate ways to lose a package:
 *
 *   · `/rider/secrets/arm` — re-arm the pickup code, the custody seal AND the
 *     `buyerDropCode` with values the caller chose, then verify and take
 *     custody. `SecretRegistry.register` REPLACES an unconsumed secret, so the
 *     whole window between the founder arming a code and the assigned rider
 *     arriving was open. The real rider then gets `pickup_code_refused` with
 *     the code she was handed. Breaks SE-I05 and Law 3 (« the four secrets are
 *     never substituted ») — and arms the one secret SE-I11 rests on.
 *   · `/rider/order/open` — claim a package id for a decoy order. The claim is
 *     write-once and nothing releases it, so the honest order is refused
 *     `package_claimed_by_other_order` FOREVER: Séra can never take custody of
 *     those goods.
 *   · `/rider/ledger` · `/attestations` · `/events` — any order's full custody
 *     file, read by any rider.
 *
 * THE FIX IS AN ALLOWLIST, not a denylist: a route added later is closed until
 * someone deliberately opens it, which is the only direction this can safely
 * fail. SE-I05 names exactly two rider acts — « Custody begins only after
 * **rider pickup verification** AND **custody-seal registration** » — so those
 * two are what a rider code opens. Reads are NOT here: the rider app (4c) gets
 * a bounded read when it can say what it needs, and « she might want it » is
 * not a reason to expose every order's custody file today.
 *
 * CHECKED BEFORE THE LOGISTICS HOP, deliberately: an unauthenticated caller
 * must not be able to make this Worker call another service at all. What the
 * allowlist contains is not a secret (this repo is public and the set is right
 * here) — the credential is, and that is still answered by one identical 401.
 */
/**
 * SE-LIVE-5a — the allowlist opens TWO more routes, deliberately, each with
 * its clause: `/delivery/evidence` (SE-I05: delivery requires « evidence » —
 * the rider photographs the handoff moment) and `/delivery/drop` (§63: the
 * buyer enters `buyerDropCode` LAST, on the rider's device). What stays
 * closed matters more: `/delivery/decide` is NOT here — a carrier must never
 * validate their own delivery (evidence supports, never releases) — and
 * `/secrets/arm`, `/order/open` and every read stay founder-only as before.
 */
/**
 * VRAI-ROUTE (founder, 2026-08-10) — TWO more rider acts, each with its
 * clause: `/transit/depart` and `/transit/arrive` are the journey facts Build
 * Spec §63 names (« transit … arrival ») — the « En route » and « Je suis
 * arrivé » buttons on the rider's own phone. They are not custody
 * transitions, they carry no secret, and the object refuses each unless the
 * SPINE corroborates it (custody-with-courier; departed). Everything else on
 * the object stays exactly as closed as before.
 */
const RIDER_ROUTES: ReadonlySet<string> = new Set([
  'POST /verification',
  'POST /custody/begin',
  'POST /transit/depart',
  'POST /transit/arrive',
  'POST /delivery/evidence',
  'POST /delivery/drop',
]);

/**
 * ═══ VRAI-ROUTE — THE TWO PRODUCER DOORS, each opening almost nothing ═══
 *
 * The chain used to be opened and armed by the FOUNDER'S key alone, which
 * made every live delivery wait on his hands. The founder's ruling (2026-08-10)
 * moves both acts onto machine roads — and each road gets its OWN key and its
 * OWN allowlist, because the four-secrets law (Build Spec §5.6, « never
 * substituted ») must hold at the door, not by politeness:
 *
 *   · `/produce/*`      — LOGISTICS' key (`SERA_PRODUCE_SECRET`). Opens the
 *     chain at dispatch (`/order/open`) and arms the machine-carried
 *     `pickup_verification_code` it mints at assign. It can NEVER arm the
 *     buyer's drop code: logistics is the carrier's book, and the carrier
 *     must never hold the buyer's secret.
 *   · `/produce-shop/*` — SHOP+'S key (`SHOP_ARM_SECRET`). Arms the
 *     `buyer_drop_code` minted at payment confirmation — and NOTHING else:
 *     not the pickup code (Shop+ is not the carrier), not `/order/open`
 *     (Shop+ does not know the dispatch chain).
 *
 * Neither door can arm `custody_seal` — the seal is register-at-begin now
 * (the rider's typed seal binds on first use; see custody-spine.ts). Neither
 * door reaches a read, a verification, or any delivery act. The kind check
 * below is the enforcement, not the comment.
 */
const PRODUCE_ROUTES: ReadonlySet<string> = new Set(['POST /order/open', 'POST /secrets/arm']);
const PRODUCE_SHOP_ROUTES: ReadonlySet<string> = new Set(['POST /secrets/arm']);

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [da, db] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i += 1) diff |= (va[i] as number) ^ (vb[i] as number);
  return diff === 0;
}

/** The one 401 — IDENTICAL for every rejection, so it can never leak. */
function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

async function authorized(request: Request, secret: string | undefined): Promise<boolean> {
  const configured = secret ?? '';
  const header = request.headers.get('Authorization') ?? '';
  const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';
  // Unconditional compare so timing never reveals whether a secret exists;
  // the length guard keeps it fail-closed.
  const match = await timingSafeEqual(provided, configured);
  return configured.length > 0 && match;
}

/** The order this request concerns — it names the object, so it is required
 *  on every custody route and is never inferred. */
const MAX_ORDER_ID = 256;
/**
 * ⚠ VERIFIER MINOR (round 5) — THE OUTER DOOR BOUNDS IT TOO. The order id is
 * put into a REQUEST HEADER on the way to the object, and header grammar
 * rejects CR/LF/NUL — so `new Request(...)` threw before any of the object's
 * own `MAX_ID` checks could run, and the door answered a raw, uncaught
 * `TypeError` 500 instead of the structured `{ok:false, reason}` it returns
 * everywhere else. Nothing was written and it still failed closed, but a door
 * that can be made to crash is not a door that can be reasoned about.
 */
const isUsableOrderId = (v: string): boolean =>
  v.length <= MAX_ORDER_ID && !/[\u0000-\u001f\u007f]/.test(v);

function orderIdOf(url: URL, body: unknown): string | null {
  const fromQuery = url.searchParams.get('orderId');
  if (fromQuery !== null && fromQuery.trim() !== '') return fromQuery.trim();
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const v = (body as Record<string, unknown>)['orderId'];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      // Unauthenticated liveness for the post-deploy provenance probe — no
      // custody data, no ledger, nothing enumerable.
      return Response.json({
        ok: true,
        service: 'custody-service',
        release: __SERA_RELEASE__,
        canon: __SERA_CANON__,
      });
    }

    /**
     * ═══ SE-LIVE-4b-ii — TWO DOORS, AND THE OBJECT IS TOLD WHICH ONE ═══
     *
     * `/ops/*` is the FOUNDER'S key: whatever rider it names is his
     * ATTESTATION of who acted. `/rider/*` is the RIDER'S OWN personal code,
     * resolved against logistics — the one book that mints and revokes it
     * (founder ruling 2026-08-07). A revoked code stops working here the
     * instant it stops working there, because both read the same hash.
     *
     * ⚠ THE RESOLVED IDENTITY NEVER COMES FROM THE REQUEST. On the rider path
     * the router puts logistics' answer into a FRESH headers object, so a
     * caller cannot supply it and cannot override it — the same discipline
     * `X-Custody-Object` has carried since SE-LIVE-3 round 1. A `riderId` in
     * the body is ignored on this path.
     */
    const riderPath = url.pathname.startsWith('/rider/');
    // `/produce-shop/` does not start with `/produce/` (the next byte is `-`,
    // not `/`), so the two prefixes are disjoint — but they are still tested
    // in this order so a future rename cannot silently shadow the stricter
    // door with the looser one.
    const produceShopPath = url.pathname.startsWith('/produce-shop/');
    const producePath = !produceShopPath && url.pathname.startsWith('/produce/');
    let attestedRider: string | null = null;

    if (riderPath) {
      // ⚠ THE ALLOWLIST RUNS FIRST — see RIDER_ROUTES. Answered with the same
      // `not_found` the unknown-path branch below returns, so the rider door
      // never becomes a way to enumerate what the founder's door has.
      if (!RIDER_ROUTES.has(`${request.method} ${url.pathname.replace(/^\/rider/, '')}`)) {
        return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
      }
      const header = request.headers.get('Authorization') ?? '';
      const code = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';
      if (code === '' || env.LOGISTICS === undefined || (env.SERA_RIDER_VERIFY_SECRET ?? '') === '') {
        // Fail closed, and identically: an unwired custody Worker must not be
        // distinguishable from a wrong code.
        return unauthorized();
      }
      let resolved: Response;
      try {
        resolved = await env.LOGISTICS.fetch(
          new Request('https://logistics/verify/rider-code', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `${BEARER_PREFIX}${env.SERA_RIDER_VERIFY_SECRET}`,
            },
            body: JSON.stringify({ code }),
          }),
        );
      } catch {
        // Logistics unreachable is not « bad code » — say so, structured, and
        // never with a stack trace (the round-3 door-crash lesson).
        return Response.json({ ok: false, reason: 'rider_directory_unavailable' }, { status: 503 });
      }
      /**
       * ⚠ « DOWN » AND « WRONG » ARE DIFFERENT ANSWERS, and conflating them is
       * cruel to a rider standing at a door: one means try again, the other
       * means your code is dead. A service binding surfaces a thrown target as
       * a 5xx rather than by throwing at the call site, so the catch above is
       * not enough on its own — my own test caught that by getting a 401 where
       * it expected 503.
       */
      if (resolved.status >= 500) {
        return Response.json({ ok: false, reason: 'rider_directory_unavailable' }, { status: 503 });
      }
      if (!resolved.ok) return unauthorized();
      const answer = (await resolved.json().catch(() => null)) as Record<string, unknown> | null;
      const riderId = answer?.['riderId'];
      // CORROBORATED, NOT COUNTED — `ok:true` is not an identity. A directory
      // that answers without naming a usable rider is a refusal, not a pass.
      if (answer?.['ok'] !== true || typeof riderId !== 'string' || riderId.trim() === '') {
        return unauthorized();
      }
      attestedRider = riderId.trim();
    } else if (produceShopPath || producePath) {
      // The allowlist first, answered as `not_found` — same discipline as the
      // rider door: a producer key must not become a way to enumerate routes.
      const routes = produceShopPath ? PRODUCE_SHOP_ROUTES : PRODUCE_ROUTES;
      const stripped = url.pathname.replace(/^\/produce(-shop)?/, '');
      if (!routes.has(`${request.method} ${stripped}`)) {
        return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
      }
      const key = produceShopPath ? env.SHOP_ARM_SECRET : env.SERA_PRODUCE_SECRET;
      if (!(await authorized(request, key))) return unauthorized();
    } else if (!url.pathname.startsWith('/ops/')) {
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    } else if (!(await authorized(request, env.SERA_CUSTODY_OPS_SECRET))) {
      return unauthorized();
    }

    // The body is read ONCE here (a Request body cannot be read twice) and
    // forwarded verbatim to the object, so the DO parses exactly what arrived.
    const raw = request.method === 'GET' ? null : await request.text();
    let parsed: unknown = null;
    if (raw !== null && raw !== '') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
      }
    }
    const orderId = orderIdOf(url, parsed);
    if (orderId === null) {
      return Response.json({ ok: false, reason: 'order_id_required' }, { status: 400 });
    }
    if (!isUsableOrderId(orderId)) {
      return Response.json({ ok: false, reason: 'order_id_not_usable' }, { status: 400 });
    }

    /**
     * ⚠ THE KIND CHECK IS THE FOUR-SECRETS LAW AT THE DOOR. Each producer key
     * arms exactly ONE kind; anything else — including the other door's kind,
     * and the seal, which no door pre-arms any more — is refused here, before
     * the object is ever reached. Enforced at the router because the object
     * cannot know which door a command came through, and « never substituted »
     * (Build Spec §5.6) must not depend on two remote services behaving.
     */
    if ((produceShopPath || producePath) && url.pathname.endsWith('/secrets/arm')) {
      const kind =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)['kind']
          : undefined;
      const armable = produceShopPath ? 'buyer_drop_code' : 'pickup_verification_code';
      if (kind !== armable) {
        return Response.json({ ok: false, reason: 'kind_not_armable_at_this_door' }, { status: 403 });
      }
    }

    const stub = env.CUSTODY.get(env.CUSTODY.idFromName(orderId));
    const inner = new Request(`https://custody${url.pathname.replace(/^\/(ops|rider|produce-shop|produce)/, '')}${url.search}`, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        // ⚠ VERIFIER MAJOR (round 1) — THE OBJECT IS TOLD ITS OWN NAME. The
        // router resolves the order from the query OR the body, so a mistyped
        // `?orderId=` opened a custody file whose chain said something else:
        // the record lived at an address nobody would ever look up again.
        // The object now refuses to open under a name that is not its chain.
        'X-Custody-Object': orderId,
        // Present ONLY on the rider path, and only ever logistics' answer.
        // Its presence is what tells the object the act is rider-authenticated
        // rather than founder-attested — so attribution is a property of the
        // door the request came through, never of anything a caller wrote.
        ...(attestedRider !== null ? { 'X-Rider-Authenticated': attestedRider } : {}),
      },
      ...(raw !== null && raw !== '' ? { body: raw } : {}),
    });
    /**
     * ⚠ VERIFIER MAJOR (round 3) — BELT AND BRACES ON THE OUTER DOOR. The
     * object's own catch-all cannot cover a rejection inside
     * `blockConcurrencyWhile` (that aborts the object first), and workerd
     * CANCELS a block that runs too long — measured at ~30 s, answering « the
     * Durable Object was reset ». Either way the door must answer in the shape
     * every other route answers in. The object is fixed too; this is the layer
     * that cannot be bypassed by whatever the next slice adds inside it.
     */
    try {
      return await stub.fetch(inner);
    } catch {
      return Response.json({ ok: false, reason: 'custody_object_unavailable' }, { status: 503 });
    }
  },
};
