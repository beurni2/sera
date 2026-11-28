import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../../../apps/rider-app/src/offline/connectivity';
import { httpShiftActs } from '../../../apps/rider-app/src/net/shift-acts';
import { httpRiderSession } from '../../../apps/rider-app/src/net/httpRiderSession';

/**
 * ═══ EVERY KEY THIS WORKER CHECKS CAN CHANGE WITH NO GAP ═══
 *
 * A key changed in one step refuses every caller still holding the old value
 * until that caller is redeployed. So while a key `X` changes, the Worker
 * also accepts `X_NEXT`: the founder sets the next value on the Worker that
 * checks, moves the sender onto it, then makes it `X` and deletes `X_NEXT`
 * (Execution Contract §11: « key rotation … overlapping windows … version
 * retirement »). `X_NEXT` opens exactly the doors `X` opens, with the same
 * answer; unset or empty it opens nothing; the shared intake key, which is
 * being retired, has none; and nothing the Worker writes or answers says
 * which of the two values opened the door.
 *
 * All on the real Worker bundle (workerd via Miniflare). The last test runs a
 * whole course across BOTH real Workers in the middle of a change of every
 * key at once — the only proof that the keys Séra's two Workers hand each
 * other survive one.
 */

type Json = Record<string, unknown>;
interface Reponse {
  status: number;
  json: Json;
}

const T = '2026-09-26T12:00:00.000Z';
const AUTRE = 'test-autre-valeur-cles-suivantes';
const REFUS = { error: 'unauthorized' };

const workers: Miniflare[] = [];
afterAll(async () => {
  await Promise.all(workers.splice(0).map((m) => m.dispose()));
});

function boot(bindings: Record<string, string>, journal?: string[]): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    // Per-instance dirs ALWAYS (the FONDS SQLITE_BUSY lesson).
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'cles-suivantes-')),
    bindings,
    ...(journal !== undefined
      ? {
          structuredWorkerdLogs: true,
          handleStructuredLogs: ({ message }: { message: string }) => {
            journal.push(message);
          },
        }
      : {}),
  });
  workers.push(mf);
  return mf;
}

async function appel(m: Miniflare, method: 'GET' | 'POST', path: string, cle: string | null, body?: unknown, cid?: string): Promise<Reponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cle !== null) headers['Authorization'] = `Bearer ${cle}`;
  if (cid !== undefined) headers['x-correlation-id'] = cid;
  const res = await m.dispatchFetch(`http://logistics${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

let seq = 0;
const id = (p: string): string => `${p}-${(seq += 1)}`;
/** Two facts for two orders answer alike but for the order they name. */
const sansOrdre = ({ orderId: _o, ...reste }: Json): Json => reste;

const taskReady = (orderId: string) => ({
  name: 'logistics.task_ready.v1',
  envelope: {
    command_id: `cmd-${orderId}`,
    correlation_id: `corr-${orderId}`,
    aggregateVersion: 1,
    actor: 'boutik-plus:offer-service',
    serverTime: T,
    version: '1',
  },
  payload: {
    task: {
      type: 'delivery',
      id: `task-${orderId}`,
      orderId,
      location: {
        pin: { lat: 12.3714, lng: -1.5197 },
        zone: 'Gounghin',
        landmark: 'Face à la pharmacie du marché',
        directions: 'Deuxième porte bleue après le kiosque',
        maskedRelay: 'relay-door',
      },
      window: { start: T, end: '2026-09-26T14:00:00.000Z' },
      status: 'ready',
    },
  },
});

/** A rider code minted on each instance, so the rider-code doors can be asked something real. */
const codes = new Map<Miniflare, string>();

interface Porte {
  nom: string;
  envoyer: (m: Miniflare, cle: string | null) => Promise<Reponse>;
}

/** Every door of this Worker that a key or a code opens, with a request it answers without moving anything that matters. */
const PORTES = {
  opsRiders: { nom: 'GET /ops/riders', envoyer: (m, cle) => appel(m, 'GET', '/ops/riders', cle) },
  authority: { nom: 'POST /authority/dispatch', envoyer: (m, cle) => appel(m, 'POST', '/authority/dispatch', cle, {}) },
  verify: { nom: 'POST /verify/rider-code', envoyer: (m, cle) => appel(m, 'POST', '/verify/rider-code', cle, { code: codes.get(m) }) },
  livree: {
    nom: 'POST /produce/course-livree',
    envoyer: (m, cle) => appel(m, 'POST', '/produce/course-livree', cle, { command_id: id('livree'), orderId: 'ord-jamais-vu', at: T }),
  },
  funding: {
    nom: 'POST /intake/funding',
    envoyer: (m, cle) => appel(m, 'POST', '/intake/funding', cle, { orderId: id('o-f'), status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T }),
  },
  readiness: {
    nom: 'POST /intake/readiness',
    envoyer: (m, cle) => appel(m, 'POST', '/intake/readiness', cle, { orderId: id('o-r'), ready: true, asOf: T }),
  },
  ramassage: {
    nom: 'POST /intake/ramassage/verify',
    envoyer: (m, cle) => appel(m, 'POST', '/intake/ramassage/verify', cle, { command_id: id('ram'), orderId: 'ord-jamais-vu', code: 'ABCD' }),
  },
  retour: {
    nom: 'POST /intake/retour/verify',
    envoyer: (m, cle) => appel(m, 'POST', '/intake/retour/verify', cle, { command_id: id('ret'), orderId: 'ord-jamais-vu', code: 'ABCD' }),
  },
  taskReady: { nom: 'POST /intake/task-ready', envoyer: (m, cle) => appel(m, 'POST', '/intake/task-ready', cle, taskReady(id('o-tr'))) },
  rider: { nom: 'GET /rider/moi', envoyer: (m, cle) => appel(m, 'GET', '/rider/moi', cle) },
} satisfies Record<string, Porte>;
const TOUTES: readonly Porte[] = Object.values(PORTES);
const INTAKE: readonly Porte[] = [PORTES.funding, PORTES.readiness, PORTES.ramassage, PORTES.retour, PORTES.taskReady];

interface Cle {
  env: string;
  ancienne: string;
  nouvelle: string;
  ouvre: readonly Porte[];
}

/** Each key this Worker checks, the doors it opens, and the two values of a change. */
const CLES: readonly Cle[] = [
  { env: 'SERA_OPS_SECRET', ancienne: 'test-ops-ancienne-cles-suivantes', nouvelle: 'test-ops-nouvelle-cles-suivantes', ouvre: [PORTES.opsRiders, PORTES.authority] },
  { env: 'SERA_RIDER_VERIFY_SECRET', ancienne: 'test-verify-ancienne-cles-suivantes', nouvelle: 'test-verify-nouvelle-cles-suivantes', ouvre: [PORTES.verify] },
  { env: 'SERA_COURSE_LIVREE_SECRET', ancienne: 'test-livree-ancienne-cles-suivantes', nouvelle: 'test-livree-nouvelle-cles-suivantes', ouvre: [PORTES.livree] },
  { env: 'SERA_INTAKE_SHOP_SECRET', ancienne: 'test-intake-shop-ancienne-cles-suivantes', nouvelle: 'test-intake-shop-nouvelle-cles-suivantes', ouvre: [PORTES.funding] },
  {
    env: 'SERA_INTAKE_BOUTIK_SECRET',
    ancienne: 'test-intake-boutik-ancienne-cles-suivantes',
    nouvelle: 'test-intake-boutik-nouvelle-cles-suivantes',
    ouvre: [PORTES.readiness, PORTES.ramassage, PORTES.retour],
  },
];
const cle = (env: string): Cle => CLES.find((c) => c.env === env)!;

/** The value each key holds while it is not the one changing. The shared intake key is absent: the swap is done. */
const FIXE: Record<string, string> = {
  SERA_OPS_SECRET: 'test-ops-fixe-cles-suivantes',
  SERA_RIDER_VERIFY_SECRET: 'test-verify-fixe-cles-suivantes',
  SERA_COURSE_LIVREE_SECRET: 'test-livree-fixe-cles-suivantes',
  SERA_INTAKE_SHOP_SECRET: 'test-intake-shop-fixe-cles-suivantes',
  SERA_INTAKE_BOUTIK_SECRET: 'test-intake-boutik-fixe-cles-suivantes',
};

async function demarrer(bindings: Record<string, string>, journal?: string[]): Promise<Miniflare> {
  const m = boot(bindings, journal);
  const ops = bindings['SERA_OPS_SECRET'] ?? '';
  if (ops !== '') {
    const riderId = id('rider-cs');
    expect((await appel(m, 'POST', '/ops/riders', ops, { riderId, displayName: riderId, phoneAlias: `alias-${riderId}`, certified: true })).status).toBe(200);
    const mint = await appel(m, 'POST', '/ops/rider-code/mint', ops, { riderId });
    expect(mint.status).toBe(200);
    codes.set(m, mint.json['code'] as string);
  }
  return m;
}

/** What still opens a door this key must not open — proof the door is alive, not merely unwired. */
function proprietaire(porte: Porte, m: Miniflare): string | null {
  if (porte === PORTES.rider) return codes.get(m) ?? null;
  const k = CLES.find((c) => c.ouvre.includes(porte));
  return k === undefined ? null : FIXE[k.env]!;
}

describe.each(CLES)('$env — while it changes, and after', (k) => {
  let fenetre: Miniflare;
  beforeAll(async () => {
    fenetre = await demarrer({ ...FIXE, [k.env]: k.ancienne, [`${k.env}_NEXT`]: k.nouvelle });
  }, 60_000);

  it('during the change — the old and the next value open the same doors, with the same answer', async () => {
    for (const porte of k.ouvre) {
      const avant = await porte.envoyer(fenetre, k.ancienne);
      expect(avant.status, porte.nom).not.toBe(401);
      const apres = await porte.envoyer(fenetre, k.nouvelle);
      expect(apres.status, porte.nom).toBe(avant.status);
      expect(sansOrdre(apres.json), porte.nom).toEqual(sansOrdre(avant.json));
    }
  }, 60_000);

  it('during the change — another value, an empty value and no header all get the one 401', async () => {
    for (const porte of k.ouvre) {
      for (const autre of [AUTRE, '', null]) {
        const res = await porte.envoyer(fenetre, autre);
        expect(res.status, porte.nom).toBe(401);
        expect(res.json, porte.nom).toEqual(REFUS);
      }
    }
  }, 60_000);

  it("the next value opens only its own key's doors — every other door, the rider's included, gives it the one 401", async () => {
    for (const porte of TOUTES.filter((p) => !k.ouvre.includes(p))) {
      const res = await porte.envoyer(fenetre, k.nouvelle);
      expect(res.status, porte.nom).toBe(401);
      expect(res.json, porte.nom).toEqual(REFUS);
      const proprio = proprietaire(porte, fenetre);
      if (proprio !== null) expect((await porte.envoyer(fenetre, proprio)).status, `${porte.nom} is alive`).not.toBe(401);
    }
  }, 60_000);

  it.each([
    { label: 'next value deleted', suivante: undefined },
    { label: 'next value left empty', suivante: '' },
  ])('after the change ($label) — the old value gets the one 401, the new one opens, empty opens nothing', async ({ suivante }) => {
    const m = await demarrer({ ...FIXE, [k.env]: k.nouvelle, ...(suivante !== undefined ? { [`${k.env}_NEXT`]: suivante } : {}) });
    for (const porte of k.ouvre) {
      const vieux = await porte.envoyer(m, k.ancienne);
      expect(vieux.status, porte.nom).toBe(401);
      expect(vieux.json, porte.nom).toEqual(REFUS);
      expect((await porte.envoyer(m, k.nouvelle)).status, porte.nom).not.toBe(401);
      for (const vide of ['', null]) expect((await porte.envoyer(m, vide)).status, porte.nom).toBe(401);
    }
  }, 60_000);
});

const PARTAGEE = 'test-intake-partagee-cles-suivantes';

describe('the shared intake key is being retired: it has no next value', () => {
  const SUIVANTE = 'test-intake-partagee-suivante-cles-suivantes';
  let m: Miniflare;
  beforeAll(async () => {
    m = await demarrer({ ...FIXE, SERA_INTAKE_SECRET: PARTAGEE, SERA_INTAKE_SECRET_NEXT: SUIVANTE });
  }, 60_000);

  it('a value set as its next opens no intake door; the shared key itself still opens every one', async () => {
    for (const porte of INTAKE) {
      const res = await porte.envoyer(m, SUIVANTE);
      expect(res.status, porte.nom).toBe(401);
      expect(res.json, porte.nom).toEqual(REFUS);
      expect((await porte.envoyer(m, PARTAGEE)).status, porte.nom).not.toBe(401);
    }
  }, 60_000);
});

describe('/intake/task-ready keeps its rule while the producer keys change', () => {
  const shop = cle('SERA_INTAKE_SHOP_SECRET');
  const boutik = cle('SERA_INTAKE_BOUTIK_SECRET');
  let m: Miniflare;
  beforeAll(async () => {
    m = await demarrer({
      ...FIXE,
      SERA_INTAKE_SECRET: PARTAGEE,
      [shop.env]: shop.ancienne,
      [`${shop.env}_NEXT`]: shop.nouvelle,
      [boutik.env]: boutik.ancienne,
      [`${boutik.env}_NEXT`]: boutik.nouvelle,
    });
  }, 60_000);

  it('no producer key, old or next, reaches it; only the shared key while it lives', async () => {
    for (const valeur of [shop.ancienne, shop.nouvelle, boutik.ancienne, boutik.nouvelle]) {
      const res = await PORTES.taskReady.envoyer(m, valeur);
      expect(res.status).toBe(401);
      expect(res.json).toEqual(REFUS);
    }
    expect((await PORTES.taskReady.envoyer(m, PARTAGEE)).status).not.toBe(401);
  }, 60_000);
});

describe('the ledger — a fact sent on a next value is the one that lets the course in', () => {
  const shop = cle('SERA_INTAKE_SHOP_SECRET');
  const boutik = cle('SERA_INTAKE_BOUTIK_SECRET');
  let m: Miniflare;
  beforeAll(async () => {
    m = await demarrer({
      SERA_INTAKE_SECRET: PARTAGEE,
      [shop.env]: shop.ancienne,
      [`${shop.env}_NEXT`]: shop.nouvelle,
      [boutik.env]: boutik.ancienne,
      [`${boutik.env}_NEXT`]: boutik.nouvelle,
    });
  }, 60_000);

  const fonds = (orderId: string) => ({ orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
  const pret = (orderId: string) => ({ orderId, ready: true, asOf: T });

  it('Shop+ funds and Boutik+ readies on their next values → the task is admitted', async () => {
    const f = await appel(m, 'POST', '/intake/funding', shop.nouvelle, fonds('ord-cs-vrai'));
    expect(f.status).toBe(200);
    expect(f.json).toMatchObject({ ok: true, applied: true });
    const r = await appel(m, 'POST', '/intake/readiness', boutik.nouvelle, pret('ord-cs-vrai'));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, applied: true });
    const task = await appel(m, 'POST', '/intake/task-ready', PARTAGEE, taskReady('ord-cs-vrai'));
    expect(task.status).toBe(200);
    expect(task.json).toMatchObject({ ok: true, admitted: true });
  }, 60_000);

  it("a funding fact sent on Boutik+'s next value is refused and leaves no trace", async () => {
    expect((await appel(m, 'POST', '/intake/funding', boutik.nouvelle, fonds('ord-cs-faux-fonds'))).status).toBe(401);
    expect((await appel(m, 'POST', '/intake/readiness', boutik.nouvelle, pret('ord-cs-faux-fonds'))).status).toBe(200);
    const task = await appel(m, 'POST', '/intake/task-ready', PARTAGEE, taskReady('ord-cs-faux-fonds'));
    expect(task.json).toMatchObject({ admitted: false, reason: 'funding_projection_stale' });
  }, 60_000);

  it("a readiness fact sent on Shop+'s next value is refused and leaves no trace", async () => {
    expect((await appel(m, 'POST', '/intake/funding', shop.nouvelle, fonds('ord-cs-faux-pret'))).status).toBe(200);
    expect((await appel(m, 'POST', '/intake/readiness', shop.nouvelle, pret('ord-cs-faux-pret'))).status).toBe(401);
    const task = await appel(m, 'POST', '/intake/task-ready', PARTAGEE, taskReady('ord-cs-faux-pret'));
    expect(task.json).toMatchObject({ admitted: false, reason: 'readiness_projection_stale' });
  }, 60_000);
});

describe('the log never says which value opened the door', () => {
  const ops = cle('SERA_OPS_SECRET');
  const journal: string[] = [];
  let m: Miniflare;
  beforeAll(async () => {
    m = await demarrer({ ...FIXE, [ops.env]: ops.ancienne, [`${ops.env}_NEXT`]: ops.nouvelle }, journal);
  }, 60_000);

  const lignes = (): Json[] =>
    journal
      .map((t) => {
        try {
          return JSON.parse(t) as Json;
        } catch {
          return {};
        }
      })
      .filter((l) => l['msg'] === 'request');
  async function ligneDe(cid: string): Promise<Json[]> {
    const fin = Date.now() + 8_000;
    while (!lignes().some((l) => l['correlation_id'] === cid) && Date.now() < fin) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 250));
    return lignes().filter((l) => l['correlation_id'] === cid);
  }
  const sansInstant = ({ ts: _t, correlation_id: _c, durationMs: _d, ...reste }: Json): Json => reste;

  it('the old and the next value each write one line, the same line; a refusal names no value either', async () => {
    const a = await appel(m, 'GET', '/ops/riders', ops.ancienne, undefined, 'corr-cs-ancienne');
    const b = await appel(m, 'GET', '/ops/riders', ops.nouvelle, undefined, 'corr-cs-suivante');
    const c = await appel(m, 'GET', '/ops/riders', AUTRE, undefined, 'corr-cs-autre');
    expect([a.status, b.status, c.status]).toEqual([200, 200, 401]);
    const [la, lb, lc] = [await ligneDe('corr-cs-ancienne'), await ligneDe('corr-cs-suivante'), await ligneDe('corr-cs-autre')];
    expect([la.length, lb.length, lc.length]).toEqual([1, 1, 1]);
    expect(la[0]).toMatchObject({ level: 'info', route: '/ops/riders', method: 'GET', status: 200 });
    expect(sansInstant(lb[0]!)).toEqual(sansInstant(la[0]!));
    expect(lc[0]).toMatchObject({ level: 'warn', route: '/ops/riders', method: 'GET', status: 401 });
    for (const brut of journal) {
      for (const valeur of [ops.ancienne, ops.nouvelle, AUTRE]) expect(brut.includes(valeur)).toBe(false);
    }
  }, 60_000);
});

/* ═══ THE SEAM — a whole course across BOTH real Workers, in the middle of a change of every key ═══
 *
 * Every Worker that CHECKS a key holds its old value and the next one; every
 * Worker or producer that SENDS it is already on the next one. The course is
 * the COURSE-LIVRÉE road (copied, with each key's next value presented):
 *
 *   producers ──/intake/* (Shop+ and Boutik+ next values)──▶ logistics
 *   logistics ──/produce/order/open + /secrets/arm──────────▶ custody
 *   custody  ──/verify/rider-code (the rider's code)────────▶ logistics
 *   Shop+    ──/produce-shop/secrets/arm────────────────────▶ custody
 *   custody  ──/produce/course-livree───────────────────────▶ logistics
 *
 * The outcome is asked of both ledgers, never of a response.
 */

const CUSTODY_SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

const MI = {
  opsAncienne: 'test-ops-ancienne-couture',
  opsSuivante: 'test-ops-suivante-couture',
  shopAncienne: 'test-intake-shop-ancienne-couture',
  shopSuivante: 'test-intake-shop-suivante-couture',
  boutikAncienne: 'test-intake-boutik-ancienne-couture',
  boutikSuivante: 'test-intake-boutik-suivante-couture',
  verifyAncienne: 'test-verify-ancienne-couture',
  verifySuivante: 'test-verify-suivante-couture',
  livreeAncienne: 'test-livree-ancienne-couture',
  livreeSuivante: 'test-livree-suivante-couture',
  produceAncienne: 'test-produce-ancienne-couture',
  produceSuivante: 'test-produce-suivante-couture',
  custodyOpsAncienne: 'test-custody-ops-ancienne-couture',
  custodyOpsSuivante: 'test-custody-ops-suivante-couture',
  armAncienne: 'test-shop-arm-ancienne-couture',
  armSuivante: 'test-shop-arm-suivante-couture',
};

interface Hold {
  custody?: Miniflare;
  logistics?: Miniflare;
}

function spawnCustody(hold: Hold): Miniflare {
  const mf = new Miniflare({
    // Handed over as contents, not a path: workerd refuses a scriptPath that
    // climbs out of the starting directory (the vrai-produce precedent).
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(CUSTODY_SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'cles-suivantes-custody-')),
    serviceBindings: {
      LOGISTICS: (request: Request) => hold.logistics!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      // Checked here: old value + next value.
      SERA_CUSTODY_OPS_SECRET: MI.custodyOpsAncienne,
      SERA_CUSTODY_OPS_SECRET_NEXT: MI.custodyOpsSuivante,
      SERA_PRODUCE_SECRET: MI.produceAncienne,
      SERA_PRODUCE_SECRET_NEXT: MI.produceSuivante,
      SHOP_ARM_SECRET: MI.armAncienne,
      SHOP_ARM_SECRET_NEXT: MI.armSuivante,
      // Sent from here: already the next value.
      SERA_RIDER_VERIFY_SECRET: MI.verifySuivante,
      SERA_COURSE_LIVREE_SECRET: MI.livreeSuivante,
    },
  });
  workers.push(mf);
  hold.custody = mf;
  return mf;
}

function spawnLogistics(hold: Hold): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'cles-suivantes-logistics-')),
    serviceBindings: {
      CUSTODY: (request: Request) => hold.custody!.dispatchFetch(request.url, request as never) as never,
    },
    bindings: {
      // Checked here: old value + next value. The shared intake key is gone.
      SERA_OPS_SECRET: MI.opsAncienne,
      SERA_OPS_SECRET_NEXT: MI.opsSuivante,
      SERA_INTAKE_SHOP_SECRET: MI.shopAncienne,
      SERA_INTAKE_SHOP_SECRET_NEXT: MI.shopSuivante,
      SERA_INTAKE_BOUTIK_SECRET: MI.boutikAncienne,
      SERA_INTAKE_BOUTIK_SECRET_NEXT: MI.boutikSuivante,
      SERA_RIDER_VERIFY_SECRET: MI.verifyAncienne,
      SERA_RIDER_VERIFY_SECRET_NEXT: MI.verifySuivante,
      SERA_COURSE_LIVREE_SECRET: MI.livreeAncienne,
      SERA_COURSE_LIVREE_SECRET_NEXT: MI.livreeSuivante,
      // Sent from here: already the next value.
      SERA_PRODUCE_SECRET: MI.produceSuivante,
    },
  });
  workers.push(mf);
  hold.logistics = mf;
  return mf;
}

async function ops(mf: Miniflare, path: string, body?: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${MI.opsSuivante}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await res.json()) as Json;
}

async function intake(mf: Miniflare, path: string, key: string, body: unknown): Promise<Json> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

/** The rider's own hand at the CUSTODY Worker — resolved against the REAL
 *  logistics directory over the binding, never a stubbed identity. */
async function riderCustody(mf: Miniflare, path: string, code: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function livreeDoor(mf: Miniflare, key: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch('http://logistics/produce/course-livree', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function appPorts(mf: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  const net = createManualConnectivity('online');
  return { acts: httpShiftActs('http://logistics', net, fetchFn), session: httpRiderSession('http://logistics', net, fetchFn) };
}

const TC = '2026-08-13T09:00:00.000Z';
const LOC = { zone: 'Zogona, Ouagadougou', landmark: "À l'échangeur", directions: '', maskedRelay: '' };
const WIN = { start: TC, end: '2026-08-13T16:00:00.000Z' };
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };

async function courseConfiee(mf: Miniflare, orderId: string, riderId: string, prefix: string) {
  await intake(mf, '/intake/funding', MI.shopSuivante, { orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: TC });
  await intake(mf, '/intake/readiness', MI.boutikSuivante, { orderId, ready: true, asOf: TC, supplierRef: 'supplier-cles-suivantes-1' });
  const composed = await ops(mf, '/ops/task', { command_id: `${prefix}-t`, orderId, location: LOC, window: WIN });
  expect(composed['ok'], JSON.stringify(composed)).toBe(true);
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: prefix });
  await ops(mf, '/ops/riders/certify', { riderId, certified: true });
  const code = (await ops(mf, '/ops/rider-code/mint', { riderId }))['code'] as string;
  const { acts } = appPorts(mf);
  await acts.ackPrivacy(code);
  const shift = await acts.startShift(code);
  if (!shift.ok && shift.reason !== 'already_on_shift') throw new Error(`start refused: ${JSON.stringify(shift)}`);
  const granted = await ops(mf, '/ops/assign', { command_id: `${prefix}-a`, taskId: composed['taskId'], riderId });
  expect(granted['ok'], JSON.stringify(granted)).toBe(true);
  const assignmentId = (granted['assignment'] as Json)['assignmentId'] as string;
  const accepted = await acts.accepterCourse(code, assignmentId);
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  // The supplier confirms the code the rider says: what the custody codes wait on.
  const lu = await appPorts(mf).session.signIn(code);
  if (!lu.ok) throw new Error('sign-in refused');
  expect(
    await intake(mf, '/intake/ramassage/verify', MI.boutikSuivante, { command_id: `${prefix}-ram`, orderId, code: lu.session.assignment?.codeRamassage }),
  ).toEqual({ ok: true, verdict: 'confirme' });
  return { code, assignmentId };
}

/** The chain is open on the REAL custody worker once its ledger answers. */
async function attendreChaine(custody: Miniflare, orderId: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${orderId}`, {
      headers: { Authorization: `Bearer ${MI.custodyOpsSuivante}` },
    });
    await res.text();
    if (res.status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('custody chain never opened');
}

/** `/rider/moi`, raw off the wire — the read the app's reset turns on. */
async function moiAssignment(mf: Miniflare, code: string): Promise<unknown> {
  const res = await mf.dispatchFetch('http://logistics/rider/moi', {
    headers: { Authorization: `Bearer ${code}` },
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as Json;
  return (json['rider'] as Json)['assignment'];
}

/** Drive the rider's real road on custody up to and INCLUDING the drop. */
async function routeJusquAuDrop(custody: Miniflare, logistics: Miniflare, orderId: string, code: string, prefix: string, dropCode: string): Promise<void> {
  await attendreChaine(custody, orderId);
  const { session } = appPorts(logistics);
  const moi = await session.signIn(code);
  if (!moi.ok) throw new Error('sign-in refused');
  const assignment = moi.session.assignment as unknown as Json;
  const pv = assignment['codeVerification'] as string;
  const sc = assignment['codeScelle'] as string;
  expect(typeof pv).toBe('string');
  expect(typeof sc).toBe('string');

  const verified = await riderCustody(custody, '/rider/verification', code, {
    orderId, command_id: `${prefix}-v`, presentedPickupCode: pv,
    checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: `ev-${prefix}`,
  });
  expect(verified.status, JSON.stringify(verified.json)).toBe(200);

  const began = await riderCustody(custody, '/rider/custody/begin', code, {
    orderId, command_id: `${prefix}-b`, custodySealId: sc, sealPhotoRefs: [],
  });
  expect(began.status, JSON.stringify(began.json)).toBe(200);
  const chain = began.json['chain'] as Json;

  // Shop+ arms the buyer's code through ITS producer door, on its next value.
  const armed = await custody.dispatchFetch('http://custody/produce-shop/secrets/arm', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MI.armSuivante}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, command_id: `${prefix}-arm-drop`, kind: 'buyer_drop_code', secret: dropCode }),
  });
  expect(armed.status).toBe(200);
  await armed.text();

  const evidence = await riderCustody(custody, '/rider/delivery/evidence', code, {
    orderId, command_id: `${prefix}-e`,
    bundle: {
      taskId: chain['task_id'], packageId: chain['package_id'], custodySealId: sc,
      artifacts: [], capturedAt: '2026-08-13T10:00:00.000Z',
    },
  });
  expect(evidence.status, JSON.stringify(evidence.json)).toBe(200);

  const drop = await riderCustody(custody, '/rider/delivery/drop', code, {
    orderId, command_id: `${prefix}-d`, dropCode,
  });
  expect(drop.status, JSON.stringify(drop.json)).toBe(200);
  expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });
}

describe('the seam — a whole course while every key the two Workers check is changing', () => {
  it('every sender already on the next value, every checker holding old + next: the course runs to the drop and the rider walks free, on both ledgers', async () => {
    const hold: Hold = {};
    spawnLogistics(hold);
    spawnCustody(hold);
    const logistics = hold.logistics!;
    const custody = hold.custody!;

    const O = 'ord-cles-suivantes-couture';
    const RIDER = 'rider-cles-suivantes-couture';
    const { code, assignmentId } = await courseConfiee(logistics, O, RIDER, 'cs');
    expect(await moiAssignment(logistics, code)).not.toBeNull();

    await routeJusquAuDrop(custody, logistics, O, code, 'cs', 'DROP-CLES-SUIVANTES');

    // Custody's wire posts the confirmation on its next value; the LOGISTICS
    // ledger — not the response — must say the course ended.
    let assignment: unknown = 'unread';
    for (let i = 0; i < 80; i += 1) {
      assignment = await moiAssignment(logistics, code);
      if (assignment === null) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(assignment, 'the rider must return to the waiting state').toBeNull();

    const board = (await ops(logistics, '/ops/board'))['board'] as { assignments: Json[] };
    expect(board.assignments.some((a) => a['assignmentId'] === assignmentId)).toBe(false);

    const probe = await livreeDoor(logistics, MI.livreeSuivante, { orderId: O, command_id: 'probe-cs', at: TC });
    expect(probe.status).toBe(200);
    expect(probe.json).toMatchObject({ ok: true, status: 'deja_livree' });
    expect(probe.json['assignment']).toMatchObject({ assignmentId, orderId: O, riderId: RIDER, status: 'delivered' });

    // Custody's ledger reads the same through the founder's old value and his next one.
    const lire = async (key: string) => {
      const res = await custody.dispatchFetch(`http://custody/ops/ledger?orderId=${O}`, { headers: { Authorization: `Bearer ${key}` } });
      return { status: res.status, text: await res.text() };
    };
    const parAncienne = await lire(MI.custodyOpsAncienne);
    const parSuivante = await lire(MI.custodyOpsSuivante);
    expect(parAncienne.status).toBe(200);
    expect(parSuivante).toEqual(parAncienne);
  }, 120_000);
});
