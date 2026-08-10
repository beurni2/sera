import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';
import { httpCourses } from '../../../apps/dispatch-console/src/courses-port';

/**
 * ═══ PURGE-ESSAI — the founder clears his test courses, REAL against REAL ═══
 *
 * FOUNDER RULING (2026-08-10): « remove all of them … cause i want to use new
 * products again », and for Séra: « BOARD YES, CUSTODY NO ».
 *
 * REQUIRED BY THE NO-LOOP LAW: « a slice that crosses a seam is not done
 * until ONE test crosses that seam end to end. » So this drives the DISPATCH
 * CONSOLE'S OWN PORT against the REAL logistics Worker bundle
 * (`dist-worker/worker.mjs` in miniflare) and the RIDER APP'S OWN PORTS for
 * the rider half — and it asks the BOARD AND THE READS for the outcome, never
 * the retire response. A response that says « retiré » over a course still on
 * the board is exactly the class of lie this file exists to catch.
 *
 * The whole loop: real funding + readiness facts → the founder composes →
 * assigns → the rider ACCEPTS (the lease anchors, the state nothing else can
 * end) → the console retires the order → the board is clear, the rider is free
 * AND CAN BE GIVEN A NEW COURSE (the stranded-lease assertion, SE-I01), the
 * order does NOT resurrect on « à préparer », and a second retire converges on
 * `inconnu`.
 */

const OPS = 'test-ops-retirer';
const INTAKE = 'test-intake-retirer';
const VERIFY = 'test-verify-retirer';

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'retirer-')),
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
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

async function intake(mf: Miniflare, path: string, body: unknown): Promise<void> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return {
    acts: httpShiftActs('http://logistics', net, fetchFn),
    session: httpRiderSession('http://logistics', net, fetchFn),
  };
}

/** THE DISPATCH CONSOLE'S OWN PORT, pointed at the Worker exactly as the
 *  browser will point it. No hand-rolled fetch stands in for the screen. */
function desk(mf: Miniflare, key: string = OPS) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpCourses('http://logistics', key, fetchFn);
}

const T = '2026-08-10T09:00:00.000Z';
const LOC = { zone: 'Zogona', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-08-10T16:00:00.000Z' };
const AUDIO = 'media/11111111-2222-4333-8444-555555555555';
const PHOTO = 'media/9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

/** Both producers vouch for the order, then the founder composes it — the
 *  SAME admission gate a real Shop+/Boutik+ pair would go through. */
async function composer(mf: Miniflare, orderId: string, prefix: string, brief = false): Promise<string> {
  await intake(mf, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(mf, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: `supplier-${prefix}` });
  const composed = await ops(mf, '/ops/task', {
    command_id: `${prefix}-t`,
    orderId,
    location: LOC,
    window: WIN,
    ...(brief ? { repereAudioRef: AUDIO, preuvePhotoRefs: [PHOTO] } : {}),
  });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  return composed['taskId'] as string;
}

async function coursier(mf: Miniflare, riderId: string): Promise<string> {
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: `alias-${riderId}` });
  await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts } = appPorts(mf);
  await acts.ackPrivacy(code);
  if (!(await acts.startShift(code)).ok) throw new Error('start refused');
  return code;
}

function board(body: Json): { queued: Json[]; riders: Json[]; assignments: Json[] } {
  return body['board'] as { queued: Json[]; riders: Json[]; assignments: Json[] };
}

describe('the founder retires a test course from the board — console port, real Worker', () => {
  it('accepted course → retire → board clear, rider free AND re-assignable, no resurrection, second retire inconnu', async () => {
    const mf = spawn();
    const A = 'ord-essai-a';
    const B = 'ord-vrai-b';
    await composer(mf, A, 'a', true);
    const taskB = await composer(mf, B, 'b');
    const code = await coursier(mf, 'rider-boss');
    const { session } = appPorts(mf);

    const taskA = board(await ops(mf, '/ops/board')).queued.find((q) => q['orderId'] === A)!['taskId'];
    const granted = await ops(mf, '/ops/assign', { command_id: 'a-assign', taskId: taskA, riderId: 'rider-boss' });
    expect(granted['ok'], JSON.stringify(granted)).toBe(true);
    const assignmentId = (granted['assignment'] as Json)['assignmentId'] as string;
    // The rider ACCEPTS through the app's own port: acknowledged, lease
    // ANCHORED — the state exempt from every sweep, with no exit before this.
    const { acts } = appPorts(mf);
    expect((await acts.accepterCourse(code, assignmentId)).ok).toBe(true);

    // ── what the console SEES before the act ────────────────────────────────
    const avant = await desk(mf).board();
    expect(avant.kind, JSON.stringify(avant)).toBe('ok');
    expect(avant.kind === 'ok' ? avant.value : []).toEqual([
      { orderId: A, etat: 'confiee', riderName: 'rider-boss' },
      { orderId: B, etat: 'attente' },
    ]);

    // ═══ THE ACT ═══
    const retire = await desk(mf).retirer(A);
    expect(retire, JSON.stringify(retire)).toEqual({ kind: 'ok', value: 'retire' });

    // ── THE LEDGER-EQUIVALENT: the board and the reads, never the response ──
    const apres = board(await ops(mf, '/ops/board'));
    expect(apres.assignments, 'no assignment may survive the retire').toEqual([]);
    expect(apres.queued.map((q) => q['orderId']), 'only the untouched order stays queued').toEqual([B]);
    expect(
      apres.riders.find((r) => r['riderId'] === 'rider-boss'),
      'the rider must be assignable again',
    ).toMatchObject({ assignable: true });

    // The rider's own screen clears — asked of the app's port, not of the DO.
    const moi = await session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    expect(moi.session.assignment, 'the retired course must leave the rider’s screen').toBeNull();

    // NO RESURRECTION. With the funding/readiness facts still stored, the
    // order walks straight back onto the founder's own « à préparer » list as
    // composable, and the purge means nothing.
    const aPreparer = await ops(mf, '/ops/a-preparer');
    expect(JSON.stringify(aPreparer), 'a retired order must not resurface as composable').not.toContain(A);

    // THE STRANDED-LEASE ASSERTION (SE-I01). A purge that dropped the
    // dispatch row but left the lease active would leave this rider reading
    // `assignable: true` on the board and being refused at the door for ever.
    const regranted = await ops(mf, '/ops/assign', { command_id: 'b-assign', taskId: taskB, riderId: 'rider-boss' });
    expect(regranted['ok'], JSON.stringify(regranted)).toBe(true);

    // The console's own read agrees, and a second retire CONVERGES.
    const encore = await desk(mf).retirer(A);
    expect(encore).toEqual({ kind: 'ok', value: 'inconnu' });
    const fin = await desk(mf).board();
    expect(fin.kind === 'ok' ? fin.value.map((c) => c.orderId) : []).toEqual([B]);
  }, 60_000);

  it('the retire touches NOTHING else: the other order, the rider’s registry row, their code, and the SOS all survive', async () => {
    const mf = spawn();
    const A = 'ord-essai-a';
    const B = 'ord-vrai-b';
    await composer(mf, A, 'a');
    const taskB = await composer(mf, B, 'b');
    const code = await coursier(mf, 'rider-boss');
    const taskA = board(await ops(mf, '/ops/board')).queued.find((q) => q['orderId'] === A)!['taskId'];
    await ops(mf, '/ops/assign', { command_id: 'a-assign', taskId: taskA, riderId: 'rider-boss' });

    // The rider raises an SOS before the purge — a safety record must never be
    // collateral damage of a board cleanup.
    const sosRes = await mf.dispatchFetch('http://logistics/rider/sos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_id: 'sos-1', kind: 'accident', at: T }),
    });
    expect(sosRes.status, await sosRes.text()).toBe(200);

    expect(await desk(mf).retirer(A)).toEqual({ kind: 'ok', value: 'retire' });

    // The registry row stands…
    const riders = (await ops(mf, '/ops/riders'))['riders'] as Json[];
    expect(riders.map((r) => r['riderId'])).toEqual(['rider-boss']);
    // …the personal code still opens the rider door…
    const moi = await appPorts(mf).session.signIn(code);
    expect(moi.ok, 'the rider code must survive a board purge').toBe(true);
    // …the code inventory still names it…
    expect(((await ops(mf, '/ops/rider-codes'))['codes'] as Json[]).map((c) => c['riderId'])).toEqual(['rider-boss']);
    // …the SOS is still on the board, unacknowledged…
    const incidents = (await ops(mf, '/ops/sos'))['incidents'] as Json[];
    expect(incidents.length, 'an SOS is never collateral damage').toBe(1);
    // …and the OTHER order is untouched and still assignable.
    const apres = board(await ops(mf, '/ops/board'));
    expect(apres.queued.map((q) => q['orderId'])).toEqual([B]);
    const other = await ops(mf, '/ops/assign', { command_id: 'b-assign', taskId: taskB, riderId: 'rider-boss' });
    expect(other['ok'], JSON.stringify(other)).toBe(true);
  }, 60_000);

  it('the door: an order nobody knew is `inconnu`, a malformed body is 400 by name, and no key is the one uniform 401', async () => {
    const mf = spawn();
    const A = 'ord-essai-a';
    await composer(mf, A, 'a');

    // Never an error: a re-run of the console's sweep must converge.
    const jamais = await desk(mf).retirer('ord-jamais-vue');
    expect(jamais).toEqual({ kind: 'ok', value: 'inconnu' });

    const malformed = await mf.dispatchFetch('http://logistics/ops/order/retirer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command_id: 'x' }),
    });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Json)['reason']).toBe('malformed');

    // No key and a wrong key are the SAME uniform 401 — and the console's port
    // says `bad_key`, which escalates the whole desk to the one key door.
    for (const headers of [
      { 'Content-Type': 'application/json' },
      { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
    ]) {
      const res = await mf.dispatchFetch('http://logistics/ops/order/retirer', {
        method: 'POST',
        headers,
        body: JSON.stringify({ command_id: 'k', orderId: A }),
      });
      expect(res.status).toBe(401);
    }
    expect(await desk(mf, 'mauvaise-cle').retirer(A)).toEqual({ kind: 'bad_key' });

    // Every refusal above left the course exactly where it was.
    expect(board(await ops(mf, '/ops/board')).queued.map((q) => q['orderId'])).toEqual([A]);
  }, 60_000);

  it('a course that was never assigned retires just as cleanly — the queued row leaves the board', async () => {
    const mf = spawn();
    const A = 'ord-essai-seule';
    await composer(mf, A, 'a', true);
    expect(board(await ops(mf, '/ops/board')).queued.map((q) => q['orderId'])).toEqual([A]);

    expect(await desk(mf).retirer(A)).toEqual({ kind: 'ok', value: 'retire' });

    expect(board(await ops(mf, '/ops/board')).queued).toEqual([]);
    expect(JSON.stringify(await ops(mf, '/ops/a-preparer'))).not.toContain(A);
    // …and the console shows the honest empty board rather than a stale row.
    const fin = await desk(mf).board();
    expect(fin).toEqual({ kind: 'ok', value: [] });
  }, 60_000);

  it('the door accounts for EVERY store it emptied — brief, ramassage, machine code, outbox, both facts', async () => {
    /**
     * The board and the reads prove the tasks, the assignments, the lease and
     * the projections. The three per-assignment side stores (the course brief,
     * the ramassage code, the machine pickup code) have NO read left once the
     * assignment is gone, so the door's own accounting is their evidence — and
     * it is asserted exactly, never « at least ».
     */
    const mf = spawn();
    const A = 'ord-essai-complet';
    await composer(mf, A, 'a', true);
    const code = await coursier(mf, 'rider-boss');
    const taskA = board(await ops(mf, '/ops/board')).queued.find((q) => q['orderId'] === A)!['taskId'];
    const granted = await ops(mf, '/ops/assign', { command_id: 'a-assign', taskId: taskA, riderId: 'rider-boss' });
    const assignmentId = (granted['assignment'] as Json)['assignmentId'] as string;
    expect((await appPorts(mf).acts.accepterCourse(code, assignmentId)).ok).toBe(true);
    // The rider really is carrying all of it before the purge.
    const moi = await appPorts(mf).session.signIn(code);
    if (!moi.ok) throw new Error('sign-in refused');
    const carried = moi.session.assignment as unknown as Json;
    expect(carried['repereAudioRef']).toBe(AUDIO);
    expect(carried['preuvePhotoRefs']).toEqual([PHOTO]);
    expect(typeof carried['codeRamassage']).toBe('string');
    expect(typeof carried['codeVerification']).toBe('string');

    const answer = await ops(mf, '/ops/order/retirer', { command_id: 'retirer-1', orderId: A });
    expect(answer).toEqual({
      ok: true,
      status: 'retire',
      removed: {
        tasks: 1,
        assignments: 1,
        leases: 1,
        briefs: 1,
        ramassage: 1,
        codesVerification: 1,
        custodyOutbox: 1,
        funding: 1,
        readiness: 1,
      },
    });
  }, 60_000);
});
