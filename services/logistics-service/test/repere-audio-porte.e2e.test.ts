import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { mediaAudioStandIn, type MediaAudioStandIn } from './doubles/media-audio';

/**
 * ═══ THE BUYER'S PLACE AND VOICE REACH THE RIDER ONLY ONCE HE ACCEPTS ═══
 *
 * Séra Build Spec §1: « Courier access to customer phone/location MUST be
 * just-in-time, task-scoped, expiring. » SE4 / SE0.3: « access expires ».
 *
 * Driven on the REAL logistics Worker bundle under Miniflare, with the media
 * Worker's audio door played by the stand-in in `doubles/media-audio.ts`
 * (bounds at its top). The rider's acceptance goes through the rider app's OWN
 * port. The outcome is asked of the rider's own read and of the dispatcher's
 * board, never of an answer this test composed.
 *
 * The rule, state by state:
 *   · offered (and the pending offline ack, which is never an acceptance —
 *     the view's check is `=== 'acknowledged'`, positive) → the area and the
 *     window only, no voice ref, the audio door 404;
 *   · accepted → everything, the audio door plays HIS note, never cached;
 *   · declined, expired, taken back, delivered → nothing of her, the door 404.
 * Nothing is deleted: the stored location is still whole on the board.
 */

const OPS = 'test-ops-repere-audio';
const INTAKE = 'test-intake-repere-audio';
const VERIFY = 'test-verify-repere-audio';
const LIVREE = 'test-livree-repere-audio';

const T = '2026-11-27T09:00:00.000Z';
const WIN = { start: T, end: '2026-11-27T16:00:00.000Z' };
const LOC = {
  pin: { lat: 12.3714, lng: -1.5197 },
  zone: 'Gounghin, Ouagadougou',
  landmark: 'Face à la pharmacie du marché',
  directions: 'Deuxième porte bleue après le kiosque',
  maskedRelay: 'relay-cliente-1',
};
const AUDIO = 'media/11111111-2222-4333-8444-555555555555';
const SON = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5, 6, 7]);

type Json = Record<string, unknown>;

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(media: MediaAudioStandIn): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'repere-audio-')),
    serviceBindings: { MEDIA_AUDIO: media.fetch as never },
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY, SERA_COURSE_LIVREE_SECRET: LIVREE },
  });
  live.push(mf);
  return mf;
}

async function post(mf: Miniflare, key: string, path: string, body?: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as Json;
}
const ops = (mf: Miniflare, path: string, body?: unknown) => post(mf, OPS, path, body);

function acts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpShiftActs('http://logistics', createManualConnectivity('online'), fetchFn);
}

async function composer(mf: Miniflare, orderId: string, voix = true): Promise<string> {
  for (const [path, body] of [
    ['/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T }],
    ['/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: `supplier-${orderId}` }],
  ] as const) {
    expect((await post(mf, INTAKE, path, body))['ok'], path).toBe(true);
  }
  const composed = await ops(mf, '/ops/task', {
    command_id: `${orderId}-t`, orderId, location: LOC, window: WIN,
    ...(voix ? { repereAudioRef: AUDIO } : {}),
  });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  return composed['taskId'] as string;
}

async function coursier(mf: Miniflare, riderId: string): Promise<string> {
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: `alias-${riderId}` });
  await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  await acts(mf).ackPrivacy(code);
  if (!(await acts(mf).startShift(code)).ok) throw new Error('start refused');
  return code;
}

async function confier(mf: Miniflare, taskId: string, riderId: string): Promise<string> {
  const granted = await ops(mf, '/ops/assign', { command_id: `assign-${taskId}-${riderId}`, taskId, riderId });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  return (granted['assignment'] as Json)['assignmentId'] as string;
}

async function saCourse(mf: Miniflare, code: string): Promise<Json | null> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { rider: { assignment: Json | null } }).rider.assignment;
}

async function ecouter(mf: Miniflare, code: string, extra: Record<string, string> = {}): Promise<Response> {
  return mf.dispatchFetch('http://logistics/rider/repere-audio', { headers: { Authorization: `Bearer ${code}`, ...extra } });
}

async function introuvable(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
}

/** The dispatcher's board still holds her whole location: nothing deleted. */
async function rienEfface(mf: Miniflare, orderId: string): Promise<void> {
  const queued = ((await ops(mf, '/ops/board'))['board'] as { queued: Json[] }).queued.find((q) => q['orderId'] === orderId);
  expect(queued?.['location']).toEqual(LOC);
}

const media = () => mediaAudioStandIn({ [AUDIO]: { bytes: SON, contentType: 'audio/mp4' } });

describe('an offered course shows the area only; her place and voice come with « Accepter »', () => {
  it('offered → zone and window only, no voice ref, the audio door 404 and the media door never asked', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-propose');
    const code = await coursier(mf, 'rider-a');
    await confier(mf, taskId, 'rider-a');

    const offert = await saCourse(mf, code);
    expect(offert?.['status']).toBe('active_unacknowledged');
    expect(offert?.['location']).toEqual({ zone: LOC.zone });
    expect(offert?.['window']).toEqual(WIN);
    expect(offert?.['repereAudioRef']).toBeNull();
    await introuvable(await ecouter(mf, code));
    expect(m.recus).toEqual([]);
  }, 60_000);

  it('accepted → the whole location and the voice ref; the door plays HIS note, no-store, and passes only Range', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-acceptee');
    const code = await coursier(mf, 'rider-a');
    const assignmentId = await confier(mf, taskId, 'rider-a');
    expect((await acts(mf).accepterCourse(code, assignmentId)).ok).toBe(true);

    const acceptee = await saCourse(mf, code);
    expect(acceptee?.['status']).toBe('acknowledged');
    expect(acceptee?.['location']).toEqual(LOC);
    expect(acceptee?.['repereAudioRef']).toBe(AUDIO);

    const entiere = await ecouter(mf, code);
    expect(entiere.status).toBe(200);
    expect(entiere.headers.get('Content-Type')).toBe('audio/mp4');
    expect(entiere.headers.get('Cache-Control')).toBe('private, no-store');
    expect(new Uint8Array(await entiere.arrayBuffer())).toEqual(SON);

    const morceau = await ecouter(mf, code, { Range: 'bytes=0-1', Cookie: 'ne-passe-pas=1' });
    expect(morceau.status).toBe(206);
    expect(morceau.headers.get('Content-Range')).toBe(`bytes 0-1/${SON.byteLength}`);
    expect(morceau.headers.get('Accept-Ranges')).toBe('bytes');
    expect(morceau.headers.get('Cache-Control')).toBe('private, no-store');
    expect(new Uint8Array(await morceau.arrayBuffer())).toEqual(SON.slice(0, 2));

    const hors = await ecouter(mf, code, { Range: 'bytes=999-' });
    expect(hors.status).toBe(416);
    expect(hors.headers.get('Content-Range')).toBe(`bytes */${SON.byteLength}`);

    // What logistics handed the media door: HIS course's ref, GET, and the
    // Range alone — never his code, never anything else he sent.
    expect(m.recus.map((r) => [r.method, r.path])).toEqual([
      ['GET', `/${AUDIO}`], ['GET', `/${AUDIO}`], ['GET', `/${AUDIO}`],
    ]);
    // (`host` is the binding's own request URL, set by the runtime.)
    const envoyes = (i: number) => Object.fromEntries(Object.entries(m.recus[i]!.headers).filter(([k]) => k !== 'host'));
    expect(envoyes(0)).toEqual({});
    expect(envoyes(1)).toEqual({ range: 'bytes=0-1' });

    // A ref in the request is ignored: the door answers HIS course's note.
    const autreRef = await mf.dispatchFetch('http://logistics/rider/repere-audio?ref=media/99999999-2222-4333-8444-555555555555', {
      headers: { Authorization: `Bearer ${code}` },
    });
    expect(autreRef.status).toBe(200);
    expect(m.recus.at(-1)!.path).toBe(`/${AUDIO}`);

    // The book's own word: the course is the accepted one.
    const board = (await ops(mf, '/ops/board'))['board'] as { assignments: Json[] };
    expect(board.assignments.find((a) => a['assignmentId'] === assignmentId)?.['status']).toBe('acknowledged');
  }, 60_000);

  it('another rider: his code opens no note of hers, and his view carries nothing of her', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-sienne');
    const code = await coursier(mf, 'rider-a');
    const autre = await coursier(mf, 'rider-b');
    const assignmentId = await confier(mf, taskId, 'rider-a');
    expect((await acts(mf).accepterCourse(code, assignmentId)).ok).toBe(true);

    expect(await saCourse(mf, autre)).toBeNull();
    await introuvable(await ecouter(mf, autre));
    expect(m.recus).toEqual([]);
    // A bad code is the door's uniform 401, as on /rider/moi.
    const faux = await ecouter(mf, 'pas-un-code');
    expect(faux.status).toBe(401);
  }, 60_000);

  it('accepted but no note on the course, or the media door says 404 → the same 404', async () => {
    const vide = mediaAudioStandIn({});
    const mf = spawn(vide);
    const sansVoix = await composer(mf, 'ord-sans-voix', false);
    const avecVoix = await composer(mf, 'ord-voix-perdue');
    const code = await coursier(mf, 'rider-a');
    const autre = await coursier(mf, 'rider-b');
    const a1 = await confier(mf, sansVoix, 'rider-a');
    const a2 = await confier(mf, avecVoix, 'rider-b');
    expect((await acts(mf).accepterCourse(code, a1)).ok).toBe(true);
    expect((await acts(mf).accepterCourse(autre, a2)).ok).toBe(true);

    await introuvable(await ecouter(mf, code));
    expect(vide.recus).toEqual([]);
    await introuvable(await ecouter(mf, autre));
    expect(vide.recus).toHaveLength(1);
    // Only GET opens the door.
    const poste = await mf.dispatchFetch('http://logistics/rider/repere-audio', { method: 'POST', headers: { Authorization: `Bearer ${autre}` } });
    await introuvable(poste);
  }, 60_000);
});

describe('once the course has ended, nothing of her stays on his phone — and nothing is deleted', () => {
  it('declined → no course, the door 404, the board still holds her whole location', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-refusee');
    const code = await coursier(mf, 'rider-a');
    const assignmentId = await confier(mf, taskId, 'rider-a');
    expect((await post(mf, code, '/rider/assignment/decline', { assignmentId }))['ok']).toBe(true);
    expect(await saCourse(mf, code)).toBeNull();
    await introuvable(await ecouter(mf, code));
    await rienEfface(mf, 'ord-refusee');
  }, 60_000);

  it('expired unanswered → no course, the door 404', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-expiree');
    const code = await coursier(mf, 'rider-a');
    await confier(mf, taskId, 'rider-a');
    expect((await ops(mf, '/ops/expire-due', { nowIso: '2099-01-01T00:00:00.000Z' }))['ok']).toBe(true);
    expect(await saCourse(mf, code)).toBeNull();
    await introuvable(await ecouter(mf, code));
    await rienEfface(mf, 'ord-expiree');
  }, 60_000);

  it('accepted then taken back by the desk → no course, the door 404', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-reprise');
    const code = await coursier(mf, 'rider-a');
    const assignmentId = await confier(mf, taskId, 'rider-a');
    expect((await acts(mf).accepterCourse(code, assignmentId)).ok).toBe(true);
    expect((await ecouter(mf, code)).status).toBe(200);
    const repris = await ops(mf, '/ops/assignment/take-back', { command_id: 'reprise-1', assignmentId, custodyNotBegun: true });
    expect(repris['ok'], JSON.stringify(repris)).toBe(true);
    expect(await saCourse(mf, code)).toBeNull();
    await introuvable(await ecouter(mf, code));
  }, 60_000);

  it('accepted then delivered → no course, the door 404', async () => {
    const m = media();
    const mf = spawn(m);
    const taskId = await composer(mf, 'ord-livree');
    const code = await coursier(mf, 'rider-a');
    const assignmentId = await confier(mf, taskId, 'rider-a');
    expect((await acts(mf).accepterCourse(code, assignmentId)).ok).toBe(true);
    expect((await ecouter(mf, code)).status).toBe(200);
    const livree = await post(mf, LIVREE, '/produce/course-livree', { command_id: 'livree-1', orderId: 'ord-livree', at: T });
    expect(livree['status'], JSON.stringify(livree)).toBe('livree');
    expect(await saCourse(mf, code)).toBeNull();
    await introuvable(await ecouter(mf, code));
  }, 60_000);
});
