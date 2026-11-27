import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deserialize, serialize } from 'node:v8';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';
import { httpCustodyActs } from '../../../apps/rider-app/src/net/custody-acts';
import type { CommandId } from '../../../apps/rider-app/src/offline/commandId';
import { freshCourse, logistiqueCourse } from '../../../apps/rider-app/test/doubles/logistique-course';

/**
 * ═══ ONLY THE RIDER WHO ACCEPTED, AFTER THE SUPPLIER CONFIRMED, CAN TAKE THE PARCEL ═══
 *
 * Sera-Build-Spec SE-I05: « Pickup also requires assigned session +
 * `pickupVerificationCode` », and §6.2 puts the seller's handover before the
 * rider's verification. So the codes custody accepts at the stall reach the
 * rider's session only once he accepted the course AND the supplier confirmed
 * the code he said; a course that ends before custody leaves its code dead at
 * custody; a shift does not end on a course still in hand (SE1, SE2.3); and a
 * repeated « Accepter » is answered as the acceptance it repeats.
 *
 * Both Workers are the REAL bundles, wired to each other; the rider acts go
 * through the rider app's OWN ports, and the outcome is asked of custody's
 * ledger and of the board, never of the answer alone. Where a stored value
 * must be read or aged (a code an old phone could have kept, a course that
 * began custody before this rule), the logistics object's SQLite file is
 * read or edited between two runtimes, as `drop-wires-recovery` does.
 */

const OPS = 'test-ops-prise';
const INTAKE = 'test-intake-prise';
const VERIFY = 'test-verify-prise';
const CUSTODY_OPS = 'test-custody-ops-prise';
const PRODUCE_KEY = 'test-produce-key-prise';
const SHOP_ARM_KEY = 'test-shop-arm-key-prise';
const LIVREE_KEY = 'test-course-livree-key-prise';
const SUPPLIER = 'supplier-prise-1';
const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

type Json = Record<string, unknown>;
interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
  logisticsDir: string;
  custodyDir: string;
  /** Custody's closing message on its way to logistics, held back on the wire. */
  retenir?: { livree: number };
}

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose().catch(() => undefined)));
  live = [];
});

function spawnCustody(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: hold.custodyDir,
    serviceBindings: {
      LOGISTICS: (async (request: Request) => {
        if (hold.retenir !== undefined && new URL(request.url).pathname === '/produce/course-livree') {
          hold.retenir.livree += 1;
          return new Response('held on the wire', { status: 503 });
        }
        return hold.logistics!.dispatchFetch(request.url, request as never);
      }) as never,
    },
    bindings: {
      SERA_CUSTODY_OPS_SECRET: CUSTODY_OPS,
      SERA_PRODUCE_SECRET: PRODUCE_KEY,
      SERA_RIDER_VERIFY_SECRET: VERIFY,
      SHOP_ARM_SECRET: SHOP_ARM_KEY,
      SERA_COURSE_LIVREE_SECRET: LIVREE_KEY,
    },
  });
  live.push(mf);
  hold.custody = mf;
  return mf;
}

function spawnLogistics(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: hold.logisticsDir,
    serviceBindings: {
      CUSTODY: (request: Request) => hold.custody!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY, SERA_PRODUCE_SECRET: PRODUCE_KEY, SERA_COURSE_LIVREE_SECRET: LIVREE_KEY },
  });
  live.push(mf);
  hold.logistics = mf;
  return mf;
}

function both(tag: string): Hold {
  const hold: Hold = {
    logisticsDir: mkdtempSync(join(tmpdir(), `prise-${tag}-logistics-`)),
    custodyDir: mkdtempSync(join(tmpdir(), `prise-${tag}-custody-`)),
  };
  spawnLogistics(hold);
  spawnCustody(hold);
  return hold;
}

/** Stop the logistics runtime (its storage stays on disk). */
async function stopLogistics(hold: Hold): Promise<void> {
  const mf = hold.logistics!;
  live = live.filter((m) => m !== mf);
  await mf.dispose();
}

async function ops(hold: Hold, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await hold.logistics!.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function intake(hold: Hold, path: string, body: unknown): Promise<Json> {
  const res = await hold.logistics!.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

async function riderPost(hold: Hold, path: string, code: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await hold.logistics!.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(hold: Hold) {
  const viaLogistics = ((url: string, init?: RequestInit) => hold.logistics!.dispatchFetch(url, init as never)) as never;
  const viaCustody = ((url: string, init?: RequestInit) => hold.custody!.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return {
    acts: httpShiftActs('http://logistics', net, viaLogistics),
    session: httpRiderSession('http://logistics', net, viaLogistics),
    custody: httpCustodyActs('http://custody', { current: () => 'online' as const }, viaCustody),
  };
}

const id = (s: string) => s as CommandId;
const T = '2026-11-26T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: T, end: '2026-11-26T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const LATER = '2099-01-01T00:00:00.000Z';

/** The rider's parsed course, as the app's own reader sees it. */
async function vue(hold: Hold, code: string): Promise<Json | null> {
  const signed = await appPorts(hold).session.signIn(code);
  if (!signed.ok) throw new Error(`sign-in refused: ${JSON.stringify(signed)}`);
  return (signed.session.assignment as unknown as Json | null) ?? null;
}

async function rider(hold: Hold, riderId: string): Promise<string> {
  await ops(hold, '/ops/riders', { riderId, displayName: riderId, phoneAlias: riderId });
  await ops(hold, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(hold, '/ops/rider-code/mint', { riderId })).json['code'] as string;
  const { acts } = appPorts(hold);
  await acts.ackPrivacy(code);
  expect((await acts.startShift(code)).ok).toBe(true);
  return code;
}

async function commande(hold: Hold, orderId: string, prefix: string, brief: Json = {}): Promise<string> {
  await intake(hold, '/intake/funding', { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  await intake(hold, '/intake/readiness', { orderId, ready: true, asOf: T, supplierRef: SUPPLIER });
  const composed = await ops(hold, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN, ...brief });
  expect(composed.json['ok'], JSON.stringify(composed.json)).toBe(true);
  return composed.json['taskId'] as string;
}

async function confier(hold: Hold, taskId: string, riderId: string, commandId: string): Promise<string> {
  const granted = await ops(hold, '/ops/assign', { command_id: commandId, taskId, riderId });
  expect(granted.json['ok'], JSON.stringify(granted.json)).toBe(true);
  return (granted.json['assignment'] as Json)['assignmentId'] as string;
}

async function attendre<T>(lire: () => Promise<T>, fini: (v: T) => boolean, pourquoi: string): Promise<T> {
  let v = await lire();
  for (let i = 0; i < 80 && !fini(v); i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    v = await lire();
  }
  if (!fini(v)) throw new Error(`${pourquoi} — last: ${JSON.stringify(v)}`);
  return v;
}

async function ledger(hold: Hold, orderId: string): Promise<{ status: number; json: Json }> {
  const res = await hold.custody!.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, { headers: { Authorization: `Bearer ${CUSTODY_OPS}` } });
  return { status: res.status, json: (await res.json()) as Json };
}

const chaineOuverte = (hold: Hold, orderId: string) => attendre(() => ledger(hold, orderId), (l) => l.status === 200, `chain ${orderId}`);

/** The rider says his code, the supplier types it (the Boutik+ console's door). */
async function fournisseurConfirme(hold: Hold, orderId: string, codeRamassage: unknown, commandId: string): Promise<void> {
  expect(typeof codeRamassage, 'the rider must have a ramassage code to say').toBe('string');
  const dit = await intake(hold, '/intake/ramassage/verify', { command_id: commandId, orderId, code: codeRamassage });
  expect(dit).toEqual({ ok: true, verdict: 'confirme' });
}

async function verifier(hold: Hold, code: string, orderId: string, pickup: unknown, tag: string) {
  return appPorts(hold).custody.verifyPickup(
    { commandId: id(`v-${tag}`), orderId, presentedPickupCode: (pickup as string | null) ?? null, evidenceBundleId: `ev-${tag}`, dwellSec: 150, checkResults: ALL_PASS },
    code,
  );
}

// ── the object's storage, read or edited while no logistics runtime is up ──
function sqliteFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.sqlite') && !p.includes('metadata')) found.push(p);
    }
  };
  walk(dir);
  return found;
}

function readKey(dir: string, key: string): Json | undefined {
  for (const file of sqliteFiles(dir)) {
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key, value from _cf_KV').all() as unknown as { key: Uint8Array; value: Uint8Array }[];
      for (const row of rows) if (Buffer.from(row.key).toString('latin1') === key) return deserialize(Buffer.from(row.value)) as Json;
    } finally {
      db.close();
    }
  }
  return undefined;
}

function writeKey(dir: string, key: string, value: unknown): number {
  let n = 0;
  for (const file of sqliteFiles(dir)) {
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key from _cf_KV').all() as unknown as { key: Uint8Array }[];
      for (const row of rows) {
        if (Buffer.from(row.key).toString('latin1') !== key) continue;
        db.prepare('update _cf_KV set value = ? where key = ?').run(serialize(value), row.key);
        n += 1;
      }
    } finally {
      db.close();
    }
  }
  return n;
}

/**
 * The pickup code an ended course's phone could still hold (it was on the
 * offer before this rule), read from the object's own record — and, once the
 * producer has said its last word to custody about this order, the outbox row
 * as it rests. Waits only on the object's own alarm.
 */
async function codeDeLaCourseFinie(hold: Hold, orderId: string, assignmentId: string): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    await stopLogistics(hold);
    const codes = readKey(hold.logisticsDir, 'snap:code-verification:v1') as Record<string, { code: string }> | undefined;
    const row = (readKey(hold.logisticsDir, 'snap:custody-outbox:v1') as Record<string, Json> | undefined)?.[orderId];
    spawnLogistics(hold);
    const old = codes?.[assignmentId]?.code;
    if (old === undefined) throw new Error('the ended course left no code record');
    // At rest: done, and (once this rule exists) no longer carrying the old value.
    if (row !== undefined && row['phase'] === 'done' && (row['code'] !== old || row['armId'] === undefined)) return old;
    await ops(hold, '/ops/board');
  }
  throw new Error('the producer row never came to rest');
}

/** The new rider takes the course to the end of the stall: accept, supplier, verify. */
async function nouveauCoursierPrend(hold: Hold, orderId: string, taskId: string, tag: string): Promise<void> {
  const code2 = await rider(hold, `rider-${tag}-2`);
  const as2 = await confier(hold, taskId, `rider-${tag}-2`, `${tag}-a2`);
  expect((await appPorts(hold).acts.accepterCourse(code2, as2)).ok).toBe(true);
  await fournisseurConfirme(hold, orderId, (await vue(hold, code2))?.['codeRamassage'], `${tag}-r2`);
  const a2 = await vue(hold, code2);
  // Each try is its own command: custody replays a command id's first
  // answer, so a refusal could never turn into recorded under one id.
  let essai = 0;
  await attendre(
    async () => (await verifier(hold, code2, orderId, a2?.['codeVerification'], `${tag}-2-${(essai += 1)}`)).kind,
    (k) => k === 'recorded',
    'the re-assigned rider\'s own fresh code must verify',
  );
}

describe('the custody codes reach the rider only on an accepted course the supplier confirmed', () => {
  it('assign → no code · accept → still none · supplier confirms → the codes arrive, verify and seal on the real custody Worker', async () => {
    const hold = both('codes');
    const O = 'ord-prise-codes';
    const taskId = await commande(hold, O, 'pc');
    const code = await rider(hold, 'rider-prise-codes');
    const as = await confier(hold, taskId, 'rider-prise-codes', 'pc-a');
    await chaineOuverte(hold, O);

    const offre = await vue(hold, code);
    expect(offre?.['status']).toBe('active_unacknowledged');
    expect(offre?.['codeVerification'], 'no custody code on an offer').toBeNull();
    expect(offre?.['codeScelle'], 'no seal on an offer').toBeNull();
    expect(offre?.['codeScelleRetour'], 'no return seal on an offer').toBeNull();
    expect(offre?.['codeRamassage'], 'nothing to say to the supplier before accepting').toBeNull();

    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    const acceptee = await vue(hold, code);
    expect(acceptee?.['status']).toBe('acknowledged');
    expect(acceptee?.['codeVerification'], 'accepted but the supplier has not confirmed').toBeNull();
    expect(acceptee?.['codeScelle']).toBeNull();
    expect(acceptee?.['codeScelleRetour']).toBeNull();
    // The app's own act refuses locally on that null: nothing leaves the phone.
    expect(await verifier(hold, code, O, acceptee?.['codeVerification'], 'pc-tot')).toEqual({ kind: 'refused', reason: 'verification_code_missing' });

    await fournisseurConfirme(hold, O, acceptee?.['codeRamassage'], 'pc-r');
    const confirmee = await vue(hold, code);
    expect(typeof confirmee?.['ramassageConfirmeAt']).toBe('string');
    expect(typeof confirmee?.['codeVerification']).toBe('string');
    expect(typeof confirmee?.['codeScelle']).toBe('string');
    expect(typeof confirmee?.['codeScelleRetour']).toBe('string');

    expect((await verifier(hold, code, O, confirmee?.['codeVerification'], 'pc')).kind).toBe('recorded');
    const sceau = await appPorts(hold).custody.beginCustody({ commandId: id('b-pc'), orderId: O, custodySealId: confirmee?.['codeScelle'] as string, sealPhotoRefs: [] }, code);
    expect(sceau.kind, JSON.stringify(sceau)).toBe('recorded');
    expect((await ledger(hold, O)).json['currentCustodian']).toBe('courier:rider-prise-codes');
  }, 60_000);

  it('a course that began custody before this rule keeps its seals on the screen, and still no pickup code', async () => {
    const hold = both('ancien');
    const O = 'ord-prise-ancien';
    const RIDER = 'rider-prise-ancien';
    const taskId = await commande(hold, O, 'pa');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pa-a');
    await chaineOuverte(hold, O);
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    await fournisseurConfirme(hold, O, (await vue(hold, code))?.['codeRamassage'], 'pa-r');
    const a = await vue(hold, code);
    expect((await verifier(hold, code, O, a?.['codeVerification'], 'pa')).kind).toBe('recorded');
    expect((await appPorts(hold).custody.beginCustody({ commandId: id('b-pa'), orderId: O, custodySealId: a?.['codeScelle'] as string, sealPhotoRefs: [] }, code)).kind).toBe('recorded');
    expect((await ledger(hold, O)).json['currentCustodian']).toBe(`courier:${RIDER}`);

    // The old road: custody began with no supplier confirmation on record.
    await stopLogistics(hold);
    const ramassage = readKey(hold.logisticsDir, 'snap:ramassage:v1') as Record<string, Json>;
    expect(ramassage[as]?.['confirmeAt']).toBeDefined();
    const { confirmeAt: _oublie, ...sansConfirmation } = ramassage[as]!;
    expect(writeKey(hold.logisticsDir, 'snap:ramassage:v1', { ...ramassage, [as]: sansConfirmation })).toBe(1);
    spawnLogistics(hold);

    const apres = await vue(hold, code);
    expect(apres?.['ramassageConfirmeAt']).toBeNull();
    expect(apres?.['codeScelle'], 'the seal he carries must still be on his screen for the door').toBe(a?.['codeScelle']);
    expect(apres?.['codeScelleRetour']).toBe(a?.['codeScelleRetour']);
    expect(apres?.['codeVerification'], 'the pickup code stays strictly behind the confirmation').toBeNull();
  }, 60_000);

  it('a supplier who confirms the code before the rider accepts (a code read before this rule) still gives the offered rider nothing', async () => {
    const hold = both('avant');
    const O = 'ord-prise-avant';
    const taskId = await commande(hold, O, 'pv');
    const code = await rider(hold, 'rider-prise-avant');
    const as = await confier(hold, taskId, 'rider-prise-avant', 'pv-a');
    // Before this rule an offered rider's screen carried the ramassage code;
    // the supplier's door still takes it on a course not yet accepted.
    await stopLogistics(hold);
    const dit = (readKey(hold.logisticsDir, 'snap:ramassage:v1') as Record<string, Json>)[as]?.['code'];
    spawnLogistics(hold);
    await fournisseurConfirme(hold, O, dit, 'pv-r');
    const offerte = await vue(hold, code);
    expect(typeof offerte?.['ramassageConfirmeAt']).toBe('string');
    for (const champ of ['codeRamassage', 'codeVerification', 'codeScelle', 'codeScelleRetour']) {
      expect(offerte?.[champ], `${champ} on an offered course`).toBeNull();
    }
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    const acceptee = await vue(hold, code);
    expect(typeof acceptee?.['codeVerification']).toBe('string');
    expect(typeof acceptee?.['codeScelle']).toBe('string');
  }, 60_000);
});

describe('a course that ends before custody leaves its old code dead at custody', () => {
  it('decline: the old code is refused, nobody is custodian, the next rider\'s own code verifies', async () => {
    const hold = both('refus');
    const O = 'ord-prise-refus';
    const RIDER = 'rider-prise-refus';
    const taskId = await commande(hold, O, 'pr');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pr-a');
    await chaineOuverte(hold, O);
    const declined = await riderPost(hold, '/rider/assignment/decline', code, { assignmentId: as });
    expect(declined.status, JSON.stringify(declined.json)).toBe(200);

    const old = await codeDeLaCourseFinie(hold, O, as);
    const tente = await verifier(hold, code, O, old, 'pr-vieux');
    expect(tente.kind, `a declined course's code must not verify: ${JSON.stringify(tente)}`).toBe('refused');
    expect((await ledger(hold, O)).json['currentCustodian'] ?? null).toBeNull();
    await nouveauCoursierPrend(hold, O, taskId, 'pr');
  }, 60_000);

  it('the answer window: the old code is refused, nobody is custodian, the next rider\'s own code verifies', async () => {
    const hold = both('delai');
    const O = 'ord-prise-delai';
    const RIDER = 'rider-prise-delai';
    const taskId = await commande(hold, O, 'pd');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pd-a');
    await chaineOuverte(hold, O);
    const swept = await ops(hold, '/ops/expire-due', { nowIso: LATER });
    expect((swept.json['requeued'] as unknown[]).length).toBe(1);

    const old = await codeDeLaCourseFinie(hold, O, as);
    const tente = await verifier(hold, code, O, old, 'pd-vieux');
    expect(tente.kind, `an expired offer's code must not verify: ${JSON.stringify(tente)}`).toBe('refused');
    expect((await ledger(hold, O)).json['currentCustodian'] ?? null).toBeNull();
    await nouveauCoursierPrend(hold, O, taskId, 'pd');
  }, 60_000);

  it('take-back: the rider who held the codes is refused, and nobody is custodian', async () => {
    const hold = both('reprise');
    const O = 'ord-prise-reprise';
    const RIDER = 'rider-prise-reprise';
    const taskId = await commande(hold, O, 'pk');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pk-a');
    await chaineOuverte(hold, O);
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    await fournisseurConfirme(hold, O, (await vue(hold, code))?.['codeRamassage'], 'pk-r');
    const held = await vue(hold, code);
    expect(typeof held?.['codeVerification'], 'he held the code before the take-back').toBe('string');
    const back = await ops(hold, '/ops/assignment/take-back', { command_id: 'pk-tb', assignmentId: as, custodyNotBegun: true });
    expect(back.status, JSON.stringify(back.json)).toBe(200);

    const old = await codeDeLaCourseFinie(hold, O, as);
    expect(old).toBe(held?.['codeVerification']);
    const tente = await verifier(hold, code, O, old, 'pk-vieux');
    expect(tente.kind, `a taken-back course's code must not verify: ${JSON.stringify(tente)}`).toBe('refused');
    expect((await ledger(hold, O)).json['currentCustodian'] ?? null).toBeNull();
  }, 60_000);

  it('take-back after the code was used at the stall: refused until the seal; after it, the re-arm comes to rest, the old code stays refused, and the next course arms at once', async () => {
    const hold = both('use');
    const O = 'ord-prise-use';
    const RIDER = 'rider-prise-use';
    const taskId = await commande(hold, O, 'pu');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pu-a');
    await chaineOuverte(hold, O);
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    await fournisseurConfirme(hold, O, (await vue(hold, code))?.['codeRamassage'], 'pu-r');
    const held = await vue(hold, code);
    expect((await verifier(hold, code, O, held?.['codeVerification'], 'pu')).kind, 'the code is used at the stall').toBe('recorded');
    // Checked and not sealed, the course cannot be taken back: the parcel would have no road out.
    const tot = await ops(hold, '/ops/assignment/take-back', { command_id: 'pu-tb-tot', assignmentId: as, custodyNotBegun: true });
    expect(tot).toEqual({ status: 409, json: { ok: false, reason: 'pickup_verified_not_sealed', orderIds: [O] } });
    // Once sealed, the founder's own assertion still decides (unchanged), and the ending re-arms over the used code.
    expect((await appPorts(hold).custody.beginCustody({ commandId: id('b-pu'), orderId: O, custodySealId: held?.['codeScelle'] as string, sealPhotoRefs: [] }, code)).kind).toBe('recorded');
    const back = await ops(hold, '/ops/assignment/take-back', { command_id: 'pu-tb', assignmentId: as, custodyNotBegun: true });
    expect(back.status, JSON.stringify(back.json)).toBe(200);

    // Custody refuses re-arming a used code for ever; the row must still come to rest.
    const old = await codeDeLaCourseFinie(hold, O, as);
    expect(old).toBe(held?.['codeVerification']);
    // His own spent code, sent again by him, answers his recorded check and writes nothing; it never verifies anew.
    const avant = ((await ledger(hold, O)).json['entries'] as unknown[]).length;
    const vieux = await verifier(hold, code, O, old, 'pu-vieux');
    expect(vieux.kind === 'recorded' ? { kind: vieux.body['kind'], duplicate: vieux.duplicate } : vieux, 'a used code never verifies again').toEqual({ kind: 'accepted', duplicate: true });
    expect(((await ledger(hold, O)).json['entries'] as unknown[]).length, 'nothing written by the repeat').toBe(avant);
    expect((await ledger(hold, O)).json['currentCustodian'], 'the sealed parcel stays his on the ledger').toBe(`courier:${RIDER}`);

    // Another order's course arms and verifies straight away.
    const O2 = 'ord-prise-use-2';
    const taskId2 = await commande(hold, O2, 'pu2');
    const code2 = await rider(hold, 'rider-prise-use-2');
    const as2 = await confier(hold, taskId2, 'rider-prise-use-2', 'pu2-a');
    await chaineOuverte(hold, O2);
    expect((await appPorts(hold).acts.accepterCourse(code2, as2)).ok).toBe(true);
    await fournisseurConfirme(hold, O2, (await vue(hold, code2))?.['codeRamassage'], 'pu2-r');
    const a2 = await vue(hold, code2);
    let essai = 0;
    await attendre(
      async () => (await verifier(hold, code2, O2, a2?.['codeVerification'], `pu2-${(essai += 1)}`)).kind,
      (k) => k === 'recorded',
      'the next course\'s code must verify',
    );
  }, 60_000);
});

describe('a shift does not end on a course still in hand', () => {
  const coursesDuTableau = async (hold: Hold) => ((await ops(hold, '/ops/board')).json['board'] as Json)['assignments'] as Json[];

  it('an offered course: 409 course_en_cours, the board keeps it; after the decline the shift ends', async () => {
    const hold = both('fin-offre');
    const RIDER = 'rider-prise-fin-offre';
    const taskId = await commande(hold, 'ord-prise-fin-offre', 'pfo');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pfo-a');
    const fin = await riderPost(hold, '/rider/shift/end', code);
    expect(fin.status, JSON.stringify(fin.json)).toBe(409);
    expect(fin.json['reason']).toBe('course_en_cours');
    expect((await appPorts(hold).acts.endShift(code))).toEqual({ ok: false, reason: 'refused', refus: 'course_en_cours' });
    expect((await coursesDuTableau(hold)).find((a) => a['assignmentId'] === as)?.['status']).toBe('active_unacknowledged');
    expect((await riderPost(hold, '/rider/assignment/decline', code, { assignmentId: as })).status).toBe(200);
    expect((await appPorts(hold).acts.endShift(code)).ok).toBe(true);
  }, 60_000);

  it('an accepted course: 409 course_en_cours, the board keeps it; after the take-back the shift ends', async () => {
    const hold = both('fin-acceptee');
    const RIDER = 'rider-prise-fin-acceptee';
    const taskId = await commande(hold, 'ord-prise-fin-acceptee', 'pfa');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pfa-a');
    await chaineOuverte(hold, 'ord-prise-fin-acceptee');
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    const fin = await riderPost(hold, '/rider/shift/end', code);
    expect(fin.status, JSON.stringify(fin.json)).toBe(409);
    expect(fin.json['reason']).toBe('course_en_cours');
    expect((await coursesDuTableau(hold)).find((a) => a['assignmentId'] === as)?.['status']).toBe('acknowledged');
    expect((await ops(hold, '/ops/assignment/take-back', { command_id: 'pfa-tb', assignmentId: as, custodyNotBegun: true })).status).toBe(200);
    expect((await appPorts(hold).acts.endShift(code)).ok).toBe(true);
  }, 60_000);

  /** Accept, supplier confirms, verify and seal: the package is his at custody. */
  const prisEnCharge = async (hold: Hold, O: string, code: string, as: string, tag: string): Promise<Json | null> => {
    await chaineOuverte(hold, O);
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    await fournisseurConfirme(hold, O, (await vue(hold, code))?.['codeRamassage'], `${tag}-r`);
    const a = await vue(hold, code);
    expect((await verifier(hold, code, O, a?.['codeVerification'], tag)).kind).toBe('recorded');
    expect((await appPorts(hold).custody.beginCustody({ commandId: id(`b-${tag}`), orderId: O, custodySealId: a?.['codeScelle'] as string, sealPhotoRefs: [] }, code)).kind).toBe('recorded');
    return a;
  };

  it('delivered at custody, custody\'s closing message still on its way: the shift ends', async () => {
    const hold = both('fin-livree');
    hold.retenir = { livree: 0 };
    const O = 'ord-prise-fin-livree';
    const RIDER = 'rider-prise-fin-livree';
    const taskId = await commande(hold, O, 'pfl');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pfl-a');
    const a = await prisEnCharge(hold, O, code, as, 'pfl');

    const drop = 'DROP-PFL';
    const armed = await hold.custody!.dispatchFetch('http://custody/produce-shop/secrets/arm', {
      method: 'POST', headers: { Authorization: `Bearer ${SHOP_ARM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: O, command_id: 'pfl-arm-drop', kind: 'buyer_drop_code', secret: drop }),
    });
    expect(armed.status, await armed.text()).toBe(200);
    const evidence = await hold.custody!.dispatchFetch('http://custody/rider/delivery/evidence', {
      method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: O, command_id: 'pfl-e', bundle: { taskId: (a?.['chaine'] as Json)['taskId'], packageId: `pkg-${O}`, custodySealId: a?.['codeScelle'], artifacts: [], capturedAt: T } }),
    });
    expect(evidence.status, await evidence.text()).toBe(200);
    const dropped = await hold.custody!.dispatchFetch('http://custody/rider/delivery/drop', {
      method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: O, command_id: 'pfl-drop', dropCode: drop }),
    });
    expect(dropped.status, await dropped.text()).toBe(200);
    expect((await ledger(hold, O)).json['currentCustodian']).toBe('customer');
    // Custody tried to tell logistics, and the wire held it back: the book still has the course.
    await attendre(async () => hold.retenir!.livree, (n) => n > 0, 'custody never sent its closing message');
    expect((await coursesDuTableau(hold)).find((r) => r['assignmentId'] === as)?.['status']).toBe('acknowledged');

    expect((await appPorts(hold).acts.endShift(code)).ok, 'the parcel is with the customer: nothing is in his hand').toBe(true);
  }, 60_000);

  it('a refused begin leaves the seller as holder at custody, and the shift is still refused', async () => {
    const hold = both('fin-vendeur');
    const O = 'ord-prise-fin-vendeur';
    const RIDER = 'rider-prise-fin-vendeur';
    const taskId = await commande(hold, O, 'pfv');
    const code = await rider(hold, RIDER);
    const as = await confier(hold, taskId, RIDER, 'pfv-a');
    await chaineOuverte(hold, O);
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    await fournisseurConfirme(hold, O, (await vue(hold, code))?.['codeRamassage'], 'pfv-r');
    const a = await vue(hold, code);
    // The seal before any verification: custody refuses, and writes the seller as holder.
    const tot = await appPorts(hold).custody.beginCustody({ commandId: id('b-pfv'), orderId: O, custodySealId: a?.['codeScelle'] as string, sealPhotoRefs: [] }, code);
    expect(tot.kind, JSON.stringify(tot)).not.toBe('recorded');
    expect((await ledger(hold, O)).json['currentCustodian']).toBe(`seller:${SUPPLIER}`);

    expect(await appPorts(hold).acts.endShift(code)).toEqual({ ok: false, reason: 'refused', refus: 'course_en_cours' });
  }, 60_000);
});

describe('a repeated « Accepter » is answered as accepted', () => {
  it('ack, ack again by the same rider: both 200, the second says duplicate, the lease stays anchored; another rider is refused as before', async () => {
    const hold = both('ack');
    const RIDER = 'rider-prise-ack';
    const taskId = await commande(hold, 'ord-prise-ack', 'pak');
    const code = await rider(hold, RIDER);
    const autre = await rider(hold, 'rider-prise-ack-autre');
    const as = await confier(hold, taskId, RIDER, 'pak-a');

    const premier = await riderPost(hold, '/rider/assignment/ack', code, { assignmentId: as });
    expect(premier.status, JSON.stringify(premier.json)).toBe(200);
    expect(premier.json).toMatchObject({ ok: true, status: 'acknowledged', anchored: true });
    const second = await riderPost(hold, '/rider/assignment/ack', code, { assignmentId: as });
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    expect(second.json).toMatchObject({ ok: true, status: 'acknowledged', anchored: true, duplicate: true });
    // The app's own port hears it as an acceptance.
    expect((await appPorts(hold).acts.accepterCourse(code, as)).ok).toBe(true);
    // Still his, and still anchored: a sweep far past the deadline gives nothing back.
    const swept = await ops(hold, '/ops/expire-due', { nowIso: LATER });
    expect(swept.json['requeued']).toEqual([]);
    expect((await vue(hold, code))?.['status']).toBe('acknowledged');

    const etranger = await riderPost(hold, '/rider/assignment/ack', autre, { assignmentId: as });
    expect(etranger.status).toBe(404);
    expect(etranger.json['reason']).toBe('unknown_assignment');
  }, 60_000);
});

describe('the rider app\'s logistics stand-in serves what the real Worker serves', () => {
  it('assign, accept, supplier confirms: at each step the same fields are null or present on both', async () => {
    const hold = both('certif');
    const O = 'ord-prise-certif';
    const taskId = await commande(hold, O, 'pce', { repereAudioRef: 'media/11111111-2222-4333-8444-555555555555' });
    const code = await rider(hold, 'rider-prise-certif');
    const as = await confier(hold, taskId, 'rider-prise-certif', 'pce-a');
    await chaineOuverte(hold, O);

    const state = freshCourse();
    const standIn = logistiqueCourse(state, O);
    const champs = ['codeRamassage', 'ramassageConfirmeAt', 'codeVerification', 'codeScelle'] as const;
    const forme = (a: Json | null | undefined) => ({
      ...Object.fromEntries(champs.map((c) => [c, a?.[c] === null || a?.[c] === undefined ? 'absent' : 'present'])),
      repereAudioRef: a?.['repereAudioRef'] === null || a?.['repereAudioRef'] === undefined ? 'absent' : 'present',
      // Her place: the area alone, or the whole location.
      location: Object.keys((a?.['location'] as Json | null | undefined) ?? {}).join(',') === 'zone' ? 'zone_seule' : 'entiere',
    });
    const reel = async () => {
      const res = await hold.logistics!.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } });
      return forme(((await res.json()) as { rider: Json }).rider['assignment'] as Json);
    };
    const double = () => forme((standIn('/rider/moi', null)!.json['rider'] as Json)['assignment'] as Json);

    // 1. Offered.
    expect(double(), 'offered').toEqual(await reel());
    // 2. Accepted, through each side's own ack door.
    const ack = await riderPost(hold, '/rider/assignment/ack', code, { assignmentId: as });
    expect(ack.status).toBe(200);
    const ackDouble = standIn('/rider/assignment/ack', { assignmentId: 'as-1' })!;
    expect(ackDouble.status).toBe(200);
    expect(Object.keys(ackDouble.json).sort(), 'the ack answer has the Worker\'s fields').toEqual(Object.keys(ack.json).sort());
    expect(double(), 'accepted').toEqual(await reel());
    // 3. The supplier confirms (the walks set the codes the Worker would hold).
    const ram = (((await (await hold.logistics!.dispatchFetch('http://logistics/rider/moi', { headers: { Authorization: `Bearer ${code}` } })).json()) as { rider: Json }).rider['assignment'] as Json)['codeRamassage'];
    await fournisseurConfirme(hold, O, ram, 'pce-r');
    state.ramassageConfirmeAt = '2026-11-26T10:00:00.000Z';
    state.codeVerification = 'K7M-9PQ';
    state.codeScelle = 'SC-4K7M-9PQR';
    expect(double(), 'confirmed').toEqual(await reel());
    // A repeated accept: the same answer fields on both.
    const encore = await riderPost(hold, '/rider/assignment/ack', code, { assignmentId: as });
    const encoreDouble = standIn('/rider/assignment/ack', { assignmentId: 'as-1' })!;
    expect(encoreDouble.status).toBe(encore.status);
    expect(Object.keys(encoreDouble.json).sort()).toEqual(Object.keys(encore.json).sort());
  }, 60_000);
});

/**
 * ═══ THE ENDING LANDS WHILE CUSTODY IS STILL ANSWERING THE FIRST ARM ═══
 *
 * The producer flush awaits custody, and an outbound fetch does not hold the
 * object's input gate, so a course can end (here: its answer window swept)
 * between the first arm and the flush writing its answer back. Writing that
 * answer back would put the old code's row over the re-armed one, and the
 * fresh code would never reach custody. A custody stand-in (bounded to the
 * produce door's two answers, as `retour-vivant`'s race walk) sweeps the
 * REAL logistics Worker at exactly that instant, and records every arm it is
 * sent: the fresh code must still arrive, under its own command id.
 */
describe('the ending\'s re-arm survives a flush that was mid-answer', () => {
  it('the course is swept while custody answers the first arm → the fresh code is still armed, under its own command id', async () => {
    const hold: Hold = { logisticsDir: mkdtempSync(join(tmpdir(), 'prise-course-logistics-')), custodyDir: '' };
    const standIn = new Miniflare({
      modules: true,
      script: `const arms = [];
      export default { async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (path === '/seen') return Response.json(arms);
        if (path === '/produce/order/open') return Response.json({ ok: true, status: 'opened' });
        if (path === '/produce/secrets/arm') {
          const body = await request.json();
          arms.push({ command_id: body.command_id, secret: body.secret });
          if (arms.length === 1) {
            // The answer window passes at exactly this instant.
            const res = await env.LOGISTICS.fetch(new Request('https://logistics/ops/expire-due', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPS },
              body: JSON.stringify({ nowIso: '${LATER}' }),
            }));
            await res.text();
          }
          return Response.json({ ok: true, status: 'armed', kind: body.kind });
        }
        return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
      } }`,
      serviceBindings: {
        LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
      },
      bindings: { OPS },
    });
    live.push(standIn);
    hold.custody = standIn;
    spawnLogistics(hold);
    const O = 'ord-prise-course';
    const taskId = await commande(hold, O, 'pco');
    await rider(hold, 'rider-prise-course');
    const as = await confier(hold, taskId, 'rider-prise-course', 'pco-a');
    const seen = async () => (await (await standIn.dispatchFetch('http://custody/seen')).json()) as { command_id: string; secret: string }[];
    const arms = await attendre(seen, (a) => a.length >= 2, 'the fresh code never reached custody after the mid-answer ending');
    expect(arms[0]!.command_id).toBe(`arm-pickup-${as}`);
    expect(arms[1]!.command_id).toBe(`arm-pickup-fin-${as}`);
    expect(arms[1]!.secret).not.toBe(arms[0]!.secret);
  }, 60_000);

  it('a course ends while the alarm waits on another order\'s refused arm → its fresh code is armed at once, not after the backoff', async () => {
    const hold: Hold = { logisticsDir: mkdtempSync(join(tmpdir(), 'prise-attente-logistics-')), custodyDir: '' };
    const standIn = new Miniflare({
      modules: true,
      script: `const arms = []; let trigger = null;
      export default { async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (path === '/seen') return Response.json(arms);
        if (path === '/trigger') { trigger = await request.json(); return Response.json({ ok: true }); }
        if (path === '/produce/order/open') return Response.json({ ok: true, status: 'opened' });
        if (path === '/produce/secrets/arm') {
          const body = await request.json();
          arms.push({ orderId: body.orderId, command_id: body.command_id });
          if (trigger !== null && body.orderId === trigger.whenOrder) {
            const t = trigger; trigger = null;
            // The other course ends at exactly this instant, and this arm is refused.
            const res = await env.LOGISTICS.fetch(new Request('https://logistics/rider/assignment/decline', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t.code },
              body: JSON.stringify({ assignmentId: t.assignmentId }),
            }));
            await res.text();
            return Response.json({ ok: false, reason: 'busy' }, { status: 503 });
          }
          return Response.json({ ok: true, status: 'armed', kind: body.kind });
        }
        return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
      } }`,
      serviceBindings: {
        LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
      },
    });
    live.push(standIn);
    hold.custody = standIn;
    spawnLogistics(hold);
    const seen = async () => (await (await standIn.dispatchFetch('http://custody/seen')).json()) as { orderId: string; command_id: string }[];

    const OB = 'ord-prise-attente-b';
    const codeB = await rider(hold, 'rider-prise-attente-b');
    const asB = await confier(hold, await commande(hold, OB, 'pab'), 'rider-prise-attente-b', 'pab-a');
    await attendre(seen, (a) => a.some((x) => x.command_id === `arm-pickup-${asB}`), 'the first arm never reached custody');

    const OA = 'ord-prise-attente-a';
    await standIn.dispatchFetch('http://custody/trigger', { method: 'POST', body: JSON.stringify({ code: codeB, assignmentId: asB, whenOrder: OA }) });
    await rider(hold, 'rider-prise-attente-a');
    await confier(hold, await commande(hold, OA, 'paa'), 'rider-prise-attente-a', 'paa-a');

    await attendre(seen, (a) => a.some((x) => x.command_id === `arm-pickup-fin-${asB}`), 'the declined course\'s fresh code waited for the backoff');
  }, 60_000);
});
