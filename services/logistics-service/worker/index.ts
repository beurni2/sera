import { LOGISTICS_BOOK_NAME, LogisticsDO } from './logistics-do.js';

export { LogisticsDO };

/**
 * logistics-service Worker entry (SE-LIVE-1) — the three doors in front of
 * THE one durable logistics authority (LogisticsDO, idFromName
 * ('logistique')):
 *
 *   · OPS door  (`SERA_OPS_SECRET`, the founder's alone): /ops/* — riders,
 *     personal-code mint/revoke/inventory, the dispatch board, /ops/assign,
 *     the expire-due sweep — plus the preserved raw authority command route
 *     POST /authority/dispatch (AssignmentLeaseDO's exact contract, now
 *     gated: SE-I01's singular authority was never meant to answer strangers).
 *   · INTAKE door (`SERA_INTAKE_SECRET`): /intake/* — task_ready events, the
 *     funding/readiness facts (SE-LIVE-2 wires the real Shop+/Boutik+
 *     producers to it; until then NOTHING admits — fail-closed projections),
 *     and the ramassage VERDICT door (`/intake/ramassage/verify`, asked by
 *     Boutik+'s offer-service for its supplier — founder, 2026-08-09).
 *   · RIDER door (personal codes): /rider/* — resolved INSIDE the DO where
 *     the code hashes live; one uniform 401 for every rejection.
 *
 * Secrets are wrangler SECRETS, never [vars] (this repo is PUBLIC). The auth
 * primitive mirrors @boutik/service-auth exactly (HMAC-keyed constant-time
 * compare, unconditional, one identical 401) — same rationale as the
 * protection-service Worker: the package is a boutik workspace and cannot be
 * consumed here.
 *
 * CORS: exact-origin allowlist (`SERA_CONSOLE_ORIGIN`, comma-separated var —
 * origins are public), mirroring the standing storefront-service ruling: no
 * wildcard ever; echo the ONE requesting origin iff listed; unset ⇒ no CORS.
 */

// SERVICE-PROVENANCE (the F9 lesson): the deploy workflow stamps the bundle,
// /health answers with it, the post-deploy assertion polls until the live
// Worker IS this build. esbuild --define; 'dev' outside the workflow.
declare const __SERA_RELEASE__: string;
declare const __SERA_CANON__: string;

export interface Env {
  readonly LOGISTICS: DurableObjectNamespace;
  readonly SERA_OPS_SECRET?: string;
  readonly SERA_INTAKE_SECRET?: string;
  /** SE-LIVE-4b-ii — the custody Worker's key to `/verify/`. Its own door. */
  readonly SERA_RIDER_VERIFY_SECRET?: string;
  readonly SERA_CONSOLE_ORIGIN?: string;
  /**
   * VRAI-ROUTE (founder, 2026-08-10) — the custody Worker over a service
   * binding, and the key to ITS `/produce/*` door. Read by LogisticsDO (the
   * DO shares this env): at dispatch it opens the custody chain and arms the
   * machine-carried pickup code, at-least-once. Binding is transport; the
   * secret is `wrangler secret put`, the founder's alone.
   */
  readonly CUSTODY?: { fetch(request: Request): Promise<Response> };
  readonly SERA_PRODUCE_SECRET?: string;
  /**
   * COURSE-LIVRÉE (founder, 2026-08-13) — the CUSTODY Worker's key to THIS
   * Worker's `/produce/` door (the drop-confirmation wire that closes a
   * course as `delivered` and frees the rider). Its own named secret, its own
   * door — the `/verify/` discipline exactly: not the ops key (custody is not
   * the founder), not the intake key (custody is not those producers), and
   * NEVER a rider code (a carrier must never validate their own delivery).
   * Set on BOTH Workers via `wrangler secret put`, the founder's alone;
   * unset ⇒ this door refuses everything with the one uniform 401.
   */
  readonly SERA_COURSE_LIVREE_SECRET?: string;
}

const BEARER_PREFIX = 'Bearer ';

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
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
  // The compare runs unconditionally so timing does not reveal whether a
  // secret exists; the length guard keeps it fail-closed.
  const match = await timingSafeEqual(provided, configured);
  return configured.length > 0 && match;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = (env.SERA_CONSOLE_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (allowed.length === 0) return {};
  const requesting = request.headers.get('Origin') ?? '';
  // Echo the ONE requesting origin iff allowlisted — never a wildcard, never
  // a different origin than the one asking, never a list on the wire.
  if (!allowed.includes(requesting)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': requesting,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = corsHeaders(request, env);
  if (Object.keys(headers).length === 0) return response;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const stub = () => env.LOGISTICS.get(env.LOGISTICS.idFromName(LOGISTICS_BOOK_NAME));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      // Unauthenticated liveness for the post-deploy provenance probe — no
      // queue data, no rider data, nothing enumerable.
      return withCors(
        Response.json({
          ok: true,
          service: 'logistics-service',
          release: __SERA_RELEASE__,
          canon: __SERA_CANON__,
        }),
        request,
        env,
      );
    }

    if (url.pathname === '/authority/dispatch' || url.pathname.startsWith('/ops/')) {
      if (!(await authorized(request, env.SERA_OPS_SECRET))) {
        return withCors(unauthorized(), request, env);
      }
      // Preserved authority-route discipline: non-POST never reaches the object.
      if (url.pathname === '/authority/dispatch' && request.method !== 'POST') {
        return withCors(Response.json({ ok: false, reason: 'not_found' }, { status: 404 }), request, env);
      }
      return withCors(await stub().fetch(request), request, env);
    }

    /**
     * SE-LIVE-4b-ii — the custody Worker's door into this book, and ITS OWN
     * KEY. Not the ops secret (that is the founder's, and custody is not the
     * founder), not the intake secret (that is the producers'). Each caller
     * holds exactly the door it needs — the discipline `/intake/` already set.
     *
     * Reached over a Cloudflare SERVICE BINDING, but the binding is transport,
     * not authentication: this Worker is publicly addressable, so the route is
     * gated like every other. Fail-closed — deployed before the secret is set,
     * it refuses everything with the one uniform 401.
     */
    if (url.pathname.startsWith('/verify/')) {
      if (!(await authorized(request, env.SERA_RIDER_VERIFY_SECRET))) {
        return withCors(unauthorized(), request, env);
      }
      return withCors(await stub().fetch(request), request, env);
    }

    /**
     * COURSE-LIVRÉE — custody's SECOND door into this book, mirroring
     * `/verify/` above byte for byte: its own key, gated here, transport by
     * service binding but authenticated like any public route. This is the
     * at-least-once wire the custody file drives from its provider-truth drop
     * commit; the DO route behind it answers every settled condition 200 by
     * name so the sender can stop. Fail-closed: unset secret ⇒ the one 401.
     */
    if (url.pathname.startsWith('/produce/')) {
      if (!(await authorized(request, env.SERA_COURSE_LIVREE_SECRET))) {
        return withCors(unauthorized(), request, env);
      }
      return withCors(await stub().fetch(request), request, env);
    }

    if (url.pathname.startsWith('/intake/')) {
      // The intake door is ITS OWN key — the ops secret does not open it and
      // it does not open ops: producers hold exactly the door they need.
      if (!(await authorized(request, env.SERA_INTAKE_SECRET))) {
        return withCors(unauthorized(), request, env);
      }
      return withCors(await stub().fetch(request), request, env);
    }

    if (url.pathname.startsWith('/rider/')) {
      // Personal codes are resolved inside the DO (the hashes live there);
      // its refusal is the same uniform 401 this router speaks.
      return withCors(await stub().fetch(request), request, env);
    }

    return withCors(Response.json({ ok: false, reason: 'not_found' }, { status: 404 }), request, env);
  },
};
