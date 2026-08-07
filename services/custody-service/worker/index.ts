import { CustodyDO } from './custody-do.js';
import { PackageClaimDO } from './package-claim-do.js';

export { CustodyDO, PackageClaimDO };

/**
 * custody-service Worker entry (SE-LIVE-3, M4).
 *
 * ONE DOOR TODAY: every route except GET /health requires the founder's
 * `SERA_CUSTODY_OPS_SECRET` — a wrangler SECRET, never a `[vars]` entry (this
 * repo is PUBLIC). FAIL CLOSED: a Worker deployed before the secret is set
 * refuses everything, loudly, with one identical 401.
 *
 * ⚠ WHY ONLY ONE DOOR — FOUNDER RULING (2026-08-06, option 2). Pickup
 * verification and the custody seal are the RIDER's acts, but rider identity
 * lives in the logistics Worker (that is where the personal codes are). Rather
 * than build a second rider door here and replace it next slice, SE-LIVE-3
 * makes the LEDGER live, durable and tamper-evident behind the founder's key,
 * and SE-LIVE-4 brings the rider's own authenticated hand with the rider app.
 * Until then a recorded `riderId` is the founder's ATTESTATION of who
 * verified, not the rider's own credential — the JOURNAL says so too, so this
 * ledger is never read as more than it is.
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
}

const BEARER_PREFIX = 'Bearer ';

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

    if (!url.pathname.startsWith('/ops/')) {
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    }
    if (!(await authorized(request, env.SERA_CUSTODY_OPS_SECRET))) {
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

    const stub = env.CUSTODY.get(env.CUSTODY.idFromName(orderId));
    const inner = new Request(`https://custody${url.pathname.replace(/^\/ops/, '')}${url.search}`, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        // ⚠ VERIFIER MAJOR (round 1) — THE OBJECT IS TOLD ITS OWN NAME. The
        // router resolves the order from the query OR the body, so a mistyped
        // `?orderId=` opened a custody file whose chain said something else:
        // the record lived at an address nobody would ever look up again.
        // The object now refuses to open under a name that is not its chain.
        'X-Custody-Object': orderId,
      },
      ...(raw !== null && raw !== '' ? { body: raw } : {}),
    });
    return stub.fetch(inner);
  },
};
