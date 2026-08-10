import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ VRAI-ROUTE — « the chain opens itself at dispatch », REAL against REAL ═══
 *
 * Founder rulings 3 + 4 (2026-08-10): at assign, logistics mints the
 * MACHINE-CARRIED pickupVerificationCode, opens the custody chain over
 * `/produce/order/open` (with the supplier Boutik+ named on its readiness
 * fact) and arms the code over `/produce/secrets/arm` — at-least-once, no
 * founder hand anywhere.
 *
 * NO STUB CARRIES THE SEAM: the CUSTODY binding below dispatches into a
 * second Miniflare running the custody Worker's OWN shipped bundle
 * (`../custody-service/dist-worker/worker.mjs`), and the proof is asked of
 * CUSTODY'S LEDGER — the armed machine code must actually verify a pickup on
 * the real registry, not merely have been posted somewhere.
 */

const OPS = 'test-ops-vrai-produce';
const INTAKE = 'test-intake-vrai-produce';
const VERIFY = 'test-verify-vrai-produce';
const CUSTODY_OPS = 'test-custody-ops-vrai-produce';
const PRODUCE_KEY = 'test-produce-key-vrai-produce';

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawnCustody(): Miniflare {
  const mf = new Miniflare({
    // The bundle is HANDED OVER as contents, not as a path: workerd refuses a
    // scriptPath that climbs out of the starting directory (`..`), and the
    // custody bundle lives in the sibling package. Same bytes either way —
    // esbuild bundles it self-contained.
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'vrai-produce-custody-')),
    bindings: { SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS, SERA_PRODUCE_SECRET: PRODUCE_KEY },
  });
  live.push(mf);
  return mf;
}

function spawnLogistics(custody: Miniflare, opts: { produceWired?: boolean } = {}): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'vrai-produce-logistics-')),
    serviceBindings: {
      // THE REAL CUSTODY WORKER answers this binding — same bytes wrangler
      // deploys, its own DO storage, its own producer-door auth.
      CUSTODY: (request: Request) => custody.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      SERA_OPS_SECRET: OPS,
      SERA_INTAKE_SECRET: INTAKE,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      ...(opts.produceWired !== false ? { SERA_PRODUCE_SECRET: PRODUCE_KEY } : {}),
    },
  });
  live.push(mf);
  return mf;
}

type Json = Record<string, unknown>;

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as Json;
}

async function intake(mf: Miniflare, path: string, body: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

async function custodyOps(mf: Miniflare, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers: { Authorization: `Bearer ${CUSTODY_OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

const T = '2026-08-10T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-08-10T16:00:00.000Z' };
// The wire contract the rider app parses: the SAME XXX-XXX shape as the
// ramassage code, a distinct value.
const FORME_PV = /^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{3}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{3}$/;
/** ROUTE-DIRECTE — the machine-carried SEAL, in its own deliberately distinct
 *  shape. Same read as the pickup code, so the two must never be confusable. */
const FORME_SC = /^SC-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTVWXYZ2-9]{4}$/;
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

async function courseConfiee(
  mf: Miniflare,
  orderId: string,
  riderId: string,
  prefix: string,
  readiness: Json,
) {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, ...readiness });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: prefix });
  await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts, session } = appPorts(mf);
  await acts.ackPrivacy(code);
  if (!(await acts.startShift(code)).ok) throw new Error('start refused');
  const granted = await ops(mf, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed['taskId'], riderId });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  const assignmentId = (granted['assignment'] as Json)['assignmentId'] as string;
  const accepted = await acts.accepterCourse(code, assignmentId);
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  return { session, acts, code, assignmentId, taskId: composed['taskId'] as string };
}

/** The chain is open on the REAL custody worker once its ledger answers. */
async function attendreChaine(custody: Miniflare, orderId: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const led = await custodyOps(custody, 'GET', `/ops/ledger?orderId=${orderId}`);
    if (led.status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('custody chain never opened');
}

describe('dispatch opens the chain and arms the machine code on the REAL custody worker', () => {
  it('assign → chain open with the readiness supplier → machine code verifies a REAL pickup → the supplier handshake stamps ramassageConfirmeAt', async () => {
    const custody = spawnCustody();
    const mf = spawnLogistics(custody);
    const O = 'ord-vrai-produce-1';
    const { session, code } = await courseConfiee(mf, O, 'rider-vrai', 'p1', { supplierRef: 'supplier-vrai-b1' });

    await attendreChaine(custody, O);

    const moi = await session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    const assignment = moi.session.assignment as unknown as Json;
    const pv = assignment['codeVerification'] as string;
    expect(pv, 'the machine pickup code must ride /rider/moi').toMatch(FORME_PV);
    /**
     * ⚠ ROUTE-DIRECTE (founder ruling 2026-08-10) — THE SEAL RIDES THE SAME
     * READ. « terminate that sealing code … the next screen is prendre la
     * route ». The rider never types a seal, so if this value does not arrive
     * the app registers NOTHING and the road never opens — which is exactly
     * the class of dead-end this file exists to make impossible.
     *
     * This is the PARSED session, so it proves the whole chain at once: minted
     * by logistics, carried on the wire, and ACCEPTED by the app's own bounded
     * parser. A shape the parser refuses arrives here as `null`.
     */
    const sc = assignment['codeScelle'] as string;
    expect(sc, 'the machine seal must ride /rider/moi, parsed').toMatch(FORME_SC);
    expect(sc, 'and it must never be confusable with the pickup code').not.toMatch(FORME_PV);
    expect(sc).not.toBe(pv);
    expect(assignment['ramassageConfirmeAt']).toBeNull();

    // The chain custody holds is EXACTLY the one dispatch composed: an
    // identical re-open absorbs (`already_open`); one different id — package,
    // correlation, supplier or mode — would refuse by name.
    const confirme = await custodyOps(custody, 'POST', '/ops/order/open', {
      orderId: O,
      taskId: assignment['taskId'],
      packageId: `pkg-${O}`,
      correlationId: `corr-${O}`,
      supplierId: 'supplier-vrai-b1',
      paymentMode: 'FULL_PREPAY',
    });
    expect(confirme.status, JSON.stringify(confirme.json)).toBe(200);
    expect(confirme.json['status']).toBe('already_open');

    // THE PROOF IS THE LEDGER: the code logistics minted and armed over the
    // producer wire ACCEPTS a real bounded verification on custody's own
    // registry — presented once, spent forever.
    const verified = await custodyOps(custody, 'POST', '/ops/verification', {
      orderId: O, command_id: 'p1-verify', riderId: 'rider-vrai',
      presentedPickupCode: pv, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-p1',
    });
    expect(verified.status, JSON.stringify(verified.json)).toBe(200);
    const led = await custodyOps(custody, 'GET', `/ops/ledger?orderId=${O}`);
    const kinds = (led.json['entries'] as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toContain('pickup_verification');

    // The supplier confirms the rider's ramassage code (the ONE-WAY
    // handshake) — and the rider's next poll carries the instant her
    // « En route » button turns on.
    const ram = moi.session.assignment?.codeRamassage as string;
    const dit = await intake(mf, '/intake/ramassage/verify', { command_id: 'p1-v', orderId: O, code: ram });
    expect(dit).toEqual({ ok: true, verdict: 'confirme' });
    const apres = await session.signIn(code);
    if (!apres.ok) throw new Error('re-read refused');
    const stamped = (apres.session.assignment as unknown as Json)['ramassageConfirmeAt'];
    expect(typeof stamped).toBe('string');
    // ...and a replayed confirmation never moves it.
    await intake(mf, '/intake/ramassage/verify', { command_id: 'p1-v2', orderId: O, code: ram });
    const encore = await session.signIn(code);
    if (!encore.ok) throw new Error('re-read refused');
    expect((encore.session.assignment as unknown as Json)['ramassageConfirmeAt']).toBe(stamped);
  }, 60_000);

  it('a readiness fact that never named its supplier PARKS the row honestly — and the corrected fact puts it back on the road', async () => {
    const custody = spawnCustody();
    const mf = spawnLogistics(custody);
    const O = 'ord-vrai-produce-2';
    await courseConfiee(mf, O, 'rider-awa', 'p2', {});

    // No supplierRef anywhere: custody must NOT have opened.
    await new Promise((r) => setTimeout(r, 1_500));
    expect((await custodyOps(custody, 'GET', `/ops/ledger?orderId=${O}`)).status).toBe(409);

    // Boutik+ re-posts readiness, NEWER and carrying its supplier — the
    // intake hook feeds the parked row and revives the wire.
    await intake(mf, '/intake/readiness', {
      orderId: O, ready: true, asOf: '2026-08-10T09:30:00.000Z', supplierRef: 'supplier-vrai-b2',
    });
    await attendreChaine(custody, O);
    const confirme = await custodyOps(custody, 'POST', '/ops/order/open', {
      orderId: O,
      taskId: ((await ops(mf, '/ops/board'))['board'] as { assignments: Json[] })['assignments']![0]!['taskId'],
      packageId: `pkg-${O}`,
      correlationId: `corr-${O}`,
      supplierId: 'supplier-vrai-b2',
      paymentMode: 'FULL_PREPAY',
    });
    expect(confirme.status, JSON.stringify(confirme.json)).toBe(200);
    expect(confirme.json['status']).toBe('already_open');
  }, 60_000);

  it('the machine code leaks NOWHERE a supplier or the board can read — only /rider/moi carries it', async () => {
    const custody = spawnCustody();
    const mf = spawnLogistics(custody);
    const O = 'ord-vrai-produce-3';
    const { session, code } = await courseConfiee(mf, O, 'rider-boss', 'p3', { supplierRef: 'supplier-vrai-b3' });
    await attendreChaine(custody, O);
    const moi = await session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    const pv = (moi.session.assignment as unknown as Json)['codeVerification'] as string;
    expect(pv).toMatch(FORME_PV);

    const boardRes = await mf.dispatchFetch('http://logistics/ops/board', {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    expect((await boardRes.text()).includes(pv), 'the board must never carry the machine code').toBe(false);
    const ridersRes = await mf.dispatchFetch('http://logistics/ops/riders', {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    expect((await ridersRes.text()).includes(pv)).toBe(false);

    // ROUTE-DIRECTE — the SEAL is held to the same rule. It is not one of the
    // four secrets, but it is the thing the delivery evidence is checked
    // against, and a board that prints it hands a stranger the whole course.
    const sc = (moi.session.assignment as unknown as Json)['codeScelle'] as string;
    expect(sc).toMatch(FORME_SC);
    expect((await (await mf.dispatchFetch('http://logistics/ops/board', {
      headers: { Authorization: `Bearer ${OPS}` },
    })).text()).includes(sc), 'the board must never carry the seal').toBe(false);
  }, 60_000);
});
