import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustodyDO } from '../worker/custody-do.js';
import { PackageClaimDO } from '../worker/package-claim-do.js';

/**
 * ═══ THE ALARM NEVER SETS A LATER WAKE OVER ONE ALREADY SET, AND A DAMAGED
 *     FILE'S ALERT IS NEVER LEFT WITH NO WAKE ═══
 *
 * The REAL custody and package-claim objects, in Node, on a STORAGE DOUBLE:
 * an act landing while the alarm waits on a send, and an alarm the storage
 * refuses to set, are moments Miniflare cannot be made to stage on demand.
 * Storage is a platform boundary; no app code is stubbed. The far sides
 * (Shop+, logistics) are stood in by what they answer: here, an outage.
 *
 * ═══ THE DOUBLE'S BOUNDS (it may never exceed them) ═══
 * · get / put / delete / list / getAlarm / setAlarm with the platform's
 *   shapes: one key or many, a Map back from a many-key get and from list,
 *   list in key order, values cloned on the way in and out.
 * · The slot holds what was last set. A pass of `alarm()` starts with the slot
 *   as the test leaves it — the platform empties it when the alarm fires.
 * · `refuseAlarms` makes that many next `setAlarm` calls throw an `Error`
 *   before anything is set, as a refused write leaves nothing behind.
 * · An act landing mid-pass is stood in by its one storage effect, the wake
 *   it sets for its wire (`setAlarm(now)`); the whole act on the real runtime
 *   is driven in `detecteurs.e2e.test.ts`.
 * · It says nothing about time (the clock is frozen by the test), limits or
 *   durability.
 */

const T0 = new Date('2026-11-28T08:00:00.000Z').getTime();
const FIRST_BACKOFF_MS = 60_000;
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const HEAD_KEY = 'custody:ledger-head:v1';
const ELIGIBILITY_OUTBOX_KEY = 'custody:eligibility-outbox:v1';
const ALERTE_GARDE_KEY = 'custody:alerte-garde-outbox:v1';
const ALERTE_PREUVE_KEY = 'custody:alerte-preuve-outbox:v1';
const REVEIL_DETECTEUR_KEY = 'custody:reveil-detecteur:v1';

class Stockage {
  readonly map = new Map<string, unknown>();
  alarm: number | null = null;
  refuseAlarms = 0;

  async get(key: string | string[]): Promise<unknown> {
    if (Array.isArray(key)) {
      const out = new Map<string, unknown>();
      for (const k of key) if (this.map.has(k)) out.set(k, structuredClone(this.map.get(k)));
      return out;
    }
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined;
  }

  async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
    const entries = typeof key === 'string' ? [[key, value] as const] : Object.entries(key);
    for (const [k, v] of entries) this.map.set(k, structuredClone(v));
  }

  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) return key.filter((k) => this.map.delete(k)).length;
    return this.map.delete(key);
  }

  async list(options: { prefix?: string } = {}): Promise<Map<string, unknown>> {
    const prefix = options.prefix ?? '';
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    return new Map(keys.map((k) => [k, structuredClone(this.map.get(k))]));
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(at: number | Date): Promise<void> {
    if (this.refuseAlarms > 0) {
      this.refuseAlarms -= 1;
      throw new Error('alarm refused');
    }
    this.alarm = typeof at === 'number' ? at : at.getTime();
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

const etat = (storage: Stockage): DurableObjectState =>
  ({ storage, blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn() }) as unknown as DurableObjectState;

/** The platform's namespace, routing by name to one real claim object per package. */
function espaceDesColis(): DurableObjectNamespace {
  const objets = new Map<string, PackageClaimDO>();
  return {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: (request: Request) => {
        if (!objets.has(id.name)) objets.set(id.name, new PackageClaimDO(etat(new Stockage())));
        return objets.get(id.name)!.fetch(request);
      },
    }),
  } as unknown as DurableObjectNamespace;
}

/** A far side that is down; `pendant` runs while the send is in flight — the act landing mid-pass. */
const enPanne = (pendant: () => Promise<void> = async () => {}) => ({
  fetch: async (): Promise<Response> => {
    await pendant();
    return new Response('unavailable', { status: 503 });
  },
});

const pending = (attempts: number, extra: Record<string, unknown>) => ({ status: 'pending', attempts, ...extra });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'], now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('an act that arms its wire while the alarm waits on an alert send keeps its wake', () => {
  /** One pass with an alert row (and, if asked, an eligibility row) whose sends both fail. */
  async function passe(opts: { acte: boolean; eligibilite: boolean }): Promise<Stockage> {
    const storage = new Stockage();
    // The pass runs on the proof's wake, set for a moment before now; the record remembers it as the detector's.
    storage.map.set(REVEIL_DETECTEUR_KEY, T0 - 1_000);
    storage.map.set(ALERTE_PREUVE_KEY, pending(0, { body: { name: 'reconciliation.alert.v1' } }));
    if (opts.eligibilite) storage.map.set(ELIGIBILITY_OUTBOX_KEY, pending(0, { event: { name: 'fulfillment.progress.v1' } }));
    const acte = async (): Promise<void> => {
      if (opts.acte) await storage.setAlarm(Date.now());
    };
    const objet = new CustodyDO(etat(storage), {
      PACKAGE_CLAIM: espaceDesColis(),
      LOGISTICS: enPanne(acte),
      SERA_COURSE_LIVREE_SECRET: 'cle-livree',
      ...(opts.eligibilite ? { SHOP_PROGRESS: enPanne(), SHOP_PROGRESS_SECRET: 'cle-shop' } : {}),
    } as never);
    await objet.alarm();
    return storage;
  }

  it('no wire waiting: the alert’s retry is the next wake — unless an act set an earlier one meanwhile, which stands', async () => {
    const seul = await passe({ acte: false, eligibilite: false });
    expect(seul.alarm).toBe(T0 + FIRST_BACKOFF_MS);
    expect(seul.map.get(REVEIL_DETECTEUR_KEY), 'the slot is the detector’s wake, and the record says so').toBe(T0 + FIRST_BACKOFF_MS);

    const avecActe = await passe({ acte: true, eligibilite: false });
    expect(avecActe.alarm, 'the act’s wake is not pushed back').toBe(T0);
    expect(avecActe.map.get(REVEIL_DETECTEUR_KEY), 'the slot holds a wire’s wake now, and the record no longer calls it the detector’s').toBeUndefined();
    expect(avecActe.map.get(ALERTE_PREUVE_KEY)).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('a wire retrying too: its backoff is the next wake — unless an act set an earlier one meanwhile, which stands', async () => {
    const seul = await passe({ acte: false, eligibilite: true });
    expect(seul.alarm).toBe(T0 + FIRST_BACKOFF_MS);
    expect(seul.map.get(ELIGIBILITY_OUTBOX_KEY)).toMatchObject({ status: 'pending', attempts: 1 });

    const avecActe = await passe({ acte: true, eligibilite: true });
    expect(avecActe.alarm, 'the act’s wake is not pushed back').toBe(T0);
    expect(avecActe.map.get(REVEIL_DETECTEUR_KEY), 'the slot holds a wire’s wake now, and the record no longer calls it the detector’s').toBeUndefined();
    expect(avecActe.map.get(ELIGIBILITY_OUTBOX_KEY)).toMatchObject({ status: 'pending', attempts: 1 });
  });
});

describe('a damaged file’s alert is never left with no wake', () => {
  /** A sealed file whose ledger head is gone, met by a fresh object; its slot is as the test sets it. */
  async function endommage(env: Record<string, unknown> = {}): Promise<{ storage: Stockage; objet: CustodyDO; O: string; verifier: () => Promise<{ status: number; json: unknown }> }> {
    const O = `ord-quote-${randomUUID()}`;
    const storage = new Stockage();
    const claims = espaceDesColis();
    const premier = new CustodyDO(etat(storage), { PACKAGE_CLAIM: claims } as never);
    const act = async (objet: CustodyDO, method: string, path: string, body?: unknown) => {
      const res = await objet.fetch(new Request(`https://custody${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Custody-Object': O },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      return { status: res.status, json: (await res.json()) as unknown };
    };
    for (const [path, body] of [
      ['/order/open', { orderId: O, taskId: 'task-1', packageId: `pkg-${O}`, correlationId: `corr-${O}`, supplierId: 'supplier-1' }],
      ['/secrets/arm', { orderId: O, command_id: 'arm-p', kind: 'pickup_verification_code', secret: 'PICK-1' }],
      ['/verification', { orderId: O, command_id: 'v', riderId: 'rider-1', presentedPickupCode: 'PICK-1', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-1' }],
      ['/custody/begin', { orderId: O, command_id: 'b', riderId: 'rider-1', custodySealId: 'SEAL-1', sealPhotoRefs: [] }],
    ] as const) {
      expect((await act(premier, 'POST', path, body)).status, path).toBe(200);
    }
    storage.map.delete(HEAD_KEY);
    storage.alarm = null;
    const objet = new CustodyDO(etat(storage), { PACKAGE_CLAIM: claims, ...env } as never);
    return { storage, objet, O, verifier: () => act(objet, 'GET', `/ledger/verify?orderId=${O}`) };
  }

  it('the alert written but its wake refused: the next request to the file sets it, and the verdict never changes', async () => {
    const f = await endommage();
    f.storage.refuseAlarms = 1;
    const premier = await f.verifier();
    expect(f.storage.map.get(ALERTE_GARDE_KEY)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(f.storage.alarm, 'the wake was refused').toBeNull();

    const second = await f.verifier();
    expect(second).toEqual(premier);
    expect(f.storage.alarm, 'the next request takes the empty slot at once').toBe(T0);
  });

  it('an alert never sent, the slot holding only the proof’s far wake: taken at once', async () => {
    const f = await endommage();
    await f.verifier();
    f.storage.alarm = T0 + 20 * 60_000;
    f.storage.map.set(REVEIL_DETECTEUR_KEY, T0 + 20 * 60_000);
    await f.verifier();
    expect(f.storage.alarm).toBe(T0);
  });

  it('an alert already sent and waiting its own retry, or a wire’s wake standing: the request leaves the wake alone', async () => {
    const f = await endommage();
    await f.verifier();
    const row = f.storage.map.get(ALERTE_GARDE_KEY) as Record<string, unknown>;
    // A pass sent it once and set its own retry, a detector's wake.
    f.storage.map.set(ALERTE_GARDE_KEY, { ...row, attempts: 1 });
    f.storage.alarm = T0 + FIRST_BACKOFF_MS;
    f.storage.map.set(REVEIL_DETECTEUR_KEY, T0 + FIRST_BACKOFF_MS);
    await f.verifier();
    expect(f.storage.alarm, 'its retry keeps its backoff').toBe(T0 + FIRST_BACKOFF_MS);

    // A wire's wake: not the detector's, so never taken.
    f.storage.map.delete(REVEIL_DETECTEUR_KEY);
    f.storage.map.set(ALERTE_GARDE_KEY, { ...row, attempts: 0 });
    f.storage.alarm = T0 + 30_000;
    await f.verifier();
    expect(f.storage.alarm).toBe(T0 + 30_000);
  });

  it('a request to the file while a pass is sending its alert leaves the retry to the pass', async () => {
    let pendant: () => Promise<void> = async () => {};
    const f = await endommage({ LOGISTICS: enPanne(() => pendant()), SERA_COURSE_LIVREE_SECRET: 'cle-livree' });
    const premier = await f.verifier();
    expect(f.storage.alarm).toBe(T0);
    // The wake fires: the platform empties the slot, and the pass sends the alert.
    f.storage.alarm = null;
    let pendantLaPasse: unknown;
    pendant = async () => {
      pendantLaPasse = await f.verifier();
    };
    await f.objet.alarm();
    expect(pendantLaPasse, 'the request was answered during the send').toEqual(premier);
    expect(f.storage.map.get(ALERTE_GARDE_KEY)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(f.storage.alarm, 'its retry keeps its backoff').toBe(T0 + FIRST_BACKOFF_MS);
  });

  it('a delivered alert asks for nothing', async () => {
    const f = await endommage();
    await f.verifier();
    const row = f.storage.map.get(ALERTE_GARDE_KEY) as Record<string, unknown>;
    f.storage.map.set(ALERTE_GARDE_KEY, { ...row, status: 'delivered', attempts: 1 });
    f.storage.alarm = null;
    await f.verifier();
    expect(f.storage.alarm).toBeNull();
  });
});
