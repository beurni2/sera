import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ═══ EVERY KEY THIS WORKER CHECKS CAN CHANGE WITH NO GAP ═══
 *
 * While a key `X` changes, the custody Worker also accepts `X_NEXT`: the
 * founder sets the next value here, moves the sender onto it, then makes it
 * `X` and deletes `X_NEXT` (Execution Contract §11: « key rotation …
 * overlapping windows … version retirement »). `X_NEXT` opens exactly the
 * doors `X` opens — the same allowlist, the same kind check on what a
 * producer may arm (Build Spec §5.6, « never substituted ») — with the same
 * answer; unset or empty it opens nothing; and nothing written or answered
 * says which of the two values opened the door.
 *
 * All on the real Worker bundle (workerd via Miniflare). The rider door is
 * not in this table: it opens to a rider's own code, resolved by logistics,
 * and is driven across both real Workers in logistics' cles-suivantes seam.
 */

type Json = Record<string, unknown>;
interface Reponse {
  status: number;
  json: Json;
}

const AUTRE = 'test-autre-valeur-cles-suivantes';
const REFUS = { error: 'unauthorized' };
const JAMAIS = 'ord-jamais-ouvert-cles-suivantes';

const workers: Miniflare[] = [];
afterAll(async () => {
  await Promise.all(workers.splice(0).map((m) => m.dispose()));
});

function boot(bindings: Record<string, string>, journal?: string[]): Miniflare {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    // The custody core hashes with node's synchronous createHash: without the flag the module does not resolve.
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'custody-cles-suivantes-')),
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
  const res = await m.dispatchFetch(`http://custody${path}`, {
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

interface Porte {
  nom: string;
  envoyer: (m: Miniflare, cle: string | null) => Promise<Reponse>;
}

/** Every door of this Worker a key opens, each asked something that moves nothing. */
const PORTES = {
  opsLedger: { nom: 'GET /ops/ledger', envoyer: (m, cle) => appel(m, 'GET', `/ops/ledger?orderId=${JAMAIS}`, cle) },
  opsCustodian: { nom: 'GET /ops/custodian', envoyer: (m, cle) => appel(m, 'GET', `/ops/custodian?orderId=${JAMAIS}`, cle) },
  produceCustodian: { nom: 'GET /produce/custodian', envoyer: (m, cle) => appel(m, 'GET', `/produce/custodian?orderId=${JAMAIS}`, cle) },
  produceLock: { nom: 'GET /produce/drop-code/lock', envoyer: (m, cle) => appel(m, 'GET', `/produce/drop-code/lock?orderId=${JAMAIS}`, cle) },
  // Shop+'s door may arm the buyer's code only: asked for the carrier's code, it refuses by name — after the key.
  shopArm: {
    nom: 'POST /produce-shop/secrets/arm',
    envoyer: (m, cle) =>
      appel(m, 'POST', '/produce-shop/secrets/arm', cle, { orderId: JAMAIS, command_id: id('arm'), kind: 'pickup_verification_code', secret: 'X' }),
  },
  shopReference: {
    nom: 'POST /produce-shop/door-reference',
    envoyer: (m, cle) => appel(m, 'POST', '/produce-shop/door-reference', cle, { orderId: JAMAIS, command_id: id('ref') }),
  },
} satisfies Record<string, Porte>;
const TOUTES: readonly Porte[] = Object.values(PORTES);

interface Cle {
  env: string;
  ancienne: string;
  nouvelle: string;
  ouvre: readonly Porte[];
}

/** Each key this Worker checks, the doors it opens, and the two values of a change. */
const CLES: readonly Cle[] = [
  {
    env: 'SERA_CUSTODY_OPS_SECRET',
    ancienne: 'test-custody-ops-ancienne-cles-suivantes',
    nouvelle: 'test-custody-ops-nouvelle-cles-suivantes',
    ouvre: [PORTES.opsLedger, PORTES.opsCustodian],
  },
  {
    env: 'SERA_PRODUCE_SECRET',
    ancienne: 'test-produce-ancienne-cles-suivantes',
    nouvelle: 'test-produce-nouvelle-cles-suivantes',
    ouvre: [PORTES.produceCustodian, PORTES.produceLock],
  },
  {
    env: 'SHOP_ARM_SECRET',
    ancienne: 'test-shop-arm-ancienne-cles-suivantes',
    nouvelle: 'test-shop-arm-nouvelle-cles-suivantes',
    ouvre: [PORTES.shopArm, PORTES.shopReference],
  },
];
const cle = (env: string): Cle => CLES.find((c) => c.env === env)!;

/** The value each key holds while it is not the one changing. */
const FIXE: Record<string, string> = {
  SERA_CUSTODY_OPS_SECRET: 'test-custody-ops-fixe-cles-suivantes',
  SERA_PRODUCE_SECRET: 'test-produce-fixe-cles-suivantes',
  SHOP_ARM_SECRET: 'test-shop-arm-fixe-cles-suivantes',
};

/** What still opens a door this key must not open — proof the door is alive, not merely unwired. */
const proprietaire = (porte: Porte): string => FIXE[CLES.find((c) => c.ouvre.includes(porte))!.env]!;

describe.each(CLES)('$env — while it changes, and after', (k) => {
  let fenetre: Miniflare;
  beforeAll(() => {
    fenetre = boot({ ...FIXE, [k.env]: k.ancienne, [`${k.env}_NEXT`]: k.nouvelle });
  });

  it('during the change — the old and the next value open the same doors, with the same answer', async () => {
    for (const porte of k.ouvre) {
      const avant = await porte.envoyer(fenetre, k.ancienne);
      expect(avant.status, porte.nom).not.toBe(401);
      const apres = await porte.envoyer(fenetre, k.nouvelle);
      expect(apres.status, porte.nom).toBe(avant.status);
      expect(apres.json, porte.nom).toEqual(avant.json);
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

  it("the next value opens only its own key's doors — every other door gives it the one 401", async () => {
    for (const porte of TOUTES.filter((p) => !k.ouvre.includes(p))) {
      const res = await porte.envoyer(fenetre, k.nouvelle);
      expect(res.status, porte.nom).toBe(401);
      expect(res.json, porte.nom).toEqual(REFUS);
      expect((await porte.envoyer(fenetre, proprietaire(porte))).status, `${porte.nom} is alive`).not.toBe(401);
    }
  }, 60_000);

  it.each([
    { label: 'next value deleted', suivante: undefined },
    { label: 'next value left empty', suivante: '' },
  ])('after the change ($label) — the old value gets the one 401, the new one opens, empty opens nothing', async ({ suivante }) => {
    const m = boot({ ...FIXE, [k.env]: k.nouvelle, ...(suivante !== undefined ? { [`${k.env}_NEXT`]: suivante } : {}) });
    for (const porte of k.ouvre) {
      const vieux = await porte.envoyer(m, k.ancienne);
      expect(vieux.status, porte.nom).toBe(401);
      expect(vieux.json, porte.nom).toEqual(REFUS);
      expect((await porte.envoyer(m, k.nouvelle)).status, porte.nom).not.toBe(401);
      for (const vide of ['', null]) expect((await porte.envoyer(m, vide)).status, porte.nom).toBe(401);
    }
  }, 60_000);
});

describe('the ledger — acts on next values are recorded, and each door still arms only its own kind', () => {
  const ops = cle('SERA_CUSTODY_OPS_SECRET');
  const produce = cle('SERA_PRODUCE_SECRET');
  const shop = cle('SHOP_ARM_SECRET');
  let m: Miniflare;
  beforeAll(() => {
    m = boot({
      [ops.env]: ops.ancienne,
      [`${ops.env}_NEXT`]: ops.nouvelle,
      [produce.env]: produce.ancienne,
      [`${produce.env}_NEXT`]: produce.nouvelle,
      [shop.env]: shop.ancienne,
      [`${shop.env}_NEXT`]: shop.nouvelle,
    });
  });

  const O = 'ord-custody-cles-suivantes';
  const CHAIN = { orderId: O, taskId: `task-${O}`, packageId: `pkg-${O}`, correlationId: `corr-${O}`, supplierId: 'supplier-cles-suivantes' };

  it('logistics opens the chain and arms the pickup code on its next value, Shop+ arms the drop code on its; the founder reads it on either value', async () => {
    expect((await appel(m, 'POST', '/produce/order/open', produce.nouvelle, CHAIN)).status).toBe(200);
    expect(
      (await appel(m, 'POST', '/produce/secrets/arm', produce.nouvelle, { orderId: O, command_id: `arm-p-${O}`, kind: 'pickup_verification_code', secret: 'PICKUP-CS-1' })).status,
    ).toBe(200);
    expect(
      (await appel(m, 'POST', '/produce-shop/secrets/arm', shop.nouvelle, { orderId: O, command_id: `arm-d-${O}`, kind: 'buyer_drop_code', secret: 'DROP-CS-1' })).status,
    ).toBe(200);

    const parSuivante = await appel(m, 'GET', `/ops/ledger?orderId=${O}`, ops.nouvelle);
    expect(parSuivante.status).toBe(200);
    expect(parSuivante.json).toMatchObject({ ok: true, packageId: CHAIN.packageId });
    expect(await appel(m, 'GET', `/ops/ledger?orderId=${O}`, ops.ancienne)).toEqual(parSuivante);
  }, 60_000);

  it("a next value arms nothing its door may not arm: the carrier's code at Shop+'s door, the buyer's at logistics'", async () => {
    for (const [door, valeur, kind] of [
      ['/produce-shop/secrets/arm', shop.nouvelle, 'pickup_verification_code'],
      ['/produce-shop/secrets/arm', shop.nouvelle, 'custody_seal'],
      ['/produce/secrets/arm', produce.nouvelle, 'buyer_drop_code'],
      ['/produce/secrets/arm', produce.nouvelle, 'custody_seal'],
    ] as const) {
      const refused = await appel(m, 'POST', door, valeur, { orderId: O, command_id: id(`smuggle-${kind}`), kind, secret: 'SMUGGLED' });
      expect(refused.status, `${door} ${kind}`).toBe(403);
      expect(refused.json).toMatchObject({ ok: false, reason: 'kind_not_armable_at_this_door' });
    }
  }, 60_000);
});

describe('the log never says which value opened the door', () => {
  const ops = cle('SERA_CUSTODY_OPS_SECRET');
  const journal: string[] = [];
  let m: Miniflare;
  beforeAll(() => {
    m = boot({ ...FIXE, [ops.env]: ops.ancienne, [`${ops.env}_NEXT`]: ops.nouvelle }, journal);
  });

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
    const a = await appel(m, 'GET', `/ops/custodian?orderId=${JAMAIS}`, ops.ancienne, undefined, 'corr-ccs-ancienne');
    const b = await appel(m, 'GET', `/ops/custodian?orderId=${JAMAIS}`, ops.nouvelle, undefined, 'corr-ccs-suivante');
    const c = await appel(m, 'GET', `/ops/custodian?orderId=${JAMAIS}`, AUTRE, undefined, 'corr-ccs-autre');
    expect([a.status, b.status, c.status]).toEqual([200, 200, 401]);
    const [la, lb, lc] = [await ligneDe('corr-ccs-ancienne'), await ligneDe('corr-ccs-suivante'), await ligneDe('corr-ccs-autre')];
    expect([la.length, lb.length, lc.length]).toEqual([1, 1, 1]);
    expect(la[0]).toMatchObject({ level: 'info', route: '/ops/custodian', method: 'GET', status: 200 });
    expect(sansInstant(lb[0]!)).toEqual(sansInstant(la[0]!));
    expect(lc[0]).toMatchObject({ level: 'warn', route: '/ops/custodian', method: 'GET', status: 401 });
    for (const brut of journal) {
      for (const valeur of [ops.ancienne, ops.nouvelle, AUTRE]) expect(brut.includes(valeur)).toBe(false);
    }
  }, 60_000);
});
