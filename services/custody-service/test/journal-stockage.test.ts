import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustodyDO } from '../worker/custody-do.js';
import { PackageClaimDO } from '../worker/package-claim-do.js';

/**
 * ═══ JOURNAL-SERVICE — a fault the storage raises is said once, by name,
 *     and changes no answer and no row ═══
 *
 * A storage that refuses an alarm or a write cannot be made to happen under
 * Miniflare, so these run the REAL custody and package-claim objects in Node
 * on a STORAGE DOUBLE — storage is a platform boundary; no app code is
 * stubbed. The namespace in front of the claim object only routes by name to
 * a real `PackageClaimDO`, as the platform does.
 *
 * ═══ THE DOUBLE'S BOUNDS (it may never exceed them) ═══
 * · get / put / delete / list / getAlarm / setAlarm with the platform's
 *   shapes: one key or many, a Map back from a many-key get and from list,
 *   list in key order, values cloned on the way in and out.
 * · A refusal is an `Error` thrown BEFORE anything is written, as a refused
 *   write leaves nothing behind. Its message is a sentinel: no line may
 *   carry it.
 * · It says nothing about time, limits or durability.
 */

const SERVICE = 'custody-service';
const MESSAGE = 'QXMESSAGE-stockage-refuse';
const ALL_PASS = { produit_conforme: true, quantite_complete: true, emballage_intact: true };
const T0 = new Date('2026-11-28T08:00:00.000Z');
const HEAD_KEY = 'custody:ledger-head:v1';
const ALERTE_GARDE_KEY = 'custody:alerte-garde-outbox:v1';

class Stockage {
  readonly map = new Map<string, unknown>();
  alarm: number | null = null;
  refuseAlarm = false;
  refusePut: (keys: string[]) => boolean = () => false;

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
    if (this.refusePut(entries.map(([k]) => k))) throw new Error(MESSAGE);
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
    if (this.refuseAlarm) throw new Error(MESSAGE);
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

interface Monde {
  storage: Stockage;
  objet: CustodyDO;
  claims: DurableObjectNamespace;
}

function monde(): Monde {
  const storage = new Stockage();
  const claims = espaceDesColis();
  return { storage, claims, objet: new CustodyDO(etat(storage), { PACKAGE_CLAIM: claims }) };
}

async function act(m: Monde, O: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await m.objet.fetch(new Request(`https://custody${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Custody-Object': O },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: await res.json() };
}

/** Opened, armed, checked and sealed on the founder's attestation. */
async function scelle(m: Monde, O: string): Promise<void> {
  const pas: [string, unknown][] = [
    ['/order/open', { orderId: O, taskId: 'task-qxtache-1', packageId: `pkg-${O}`, correlationId: `corr-${O}`, supplierId: 'supplier-qxfourn-1' }],
    ['/secrets/arm', { orderId: O, command_id: 'qxcmd-arm-p', kind: 'pickup_verification_code', secret: 'QXPICK-1' }],
    ['/verification', { orderId: O, command_id: 'qxcmd-v', riderId: 'rider-qx-1', presentedPickupCode: 'QXPICK-1', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-qx-1' }],
    ['/custody/begin', { orderId: O, command_id: 'qxcmd-b', riderId: 'rider-qx-1', custodySealId: 'QXSEAL-1', sealPhotoRefs: [] }],
  ];
  for (const [path, body] of pas) {
    const r = await act(m, O, 'POST', path, body);
    expect(r.status, `${path} ${JSON.stringify(r.json)}`).toBe(200);
  }
}

let ecrits: string[] = [];
const lignes = (): Record<string, unknown>[] => ecrits.map((m) => JSON.parse(m) as Record<string, unknown>);

beforeEach(() => {
  ecrits = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    ecrits.push(args.map(String).join(' '));
  });
  vi.useFakeTimers({ toFake: ['Date'], now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('an alarm the storage refuses to set is said once, by name — the answer and the rows unchanged', () => {
  it('the departure’s re-arm refused: one alarm_rearm_failed line; the same answer and the same rows as when it is set', async () => {
    const O = `ord-quote-${randomUUID()}`;
    const run = async (refuse: boolean): Promise<{ m: Monde; answer: { status: number; json: unknown } }> => {
      const m = monde();
      await scelle(m, O);
      m.storage.refuseAlarm = refuse;
      const answer = await act(m, O, 'POST', '/transit/depart', { orderId: O, command_id: 'qxcmd-dep' });
      return { m, answer };
    };
    const sain = await run(false);
    expect(sain.answer.status).toBe(200);
    expect(sain.m.storage.alarm).not.toBeNull();
    expect(lignes().filter((l) => l['msg'] === 'alarm_rearm_failed')).toEqual([]);

    ecrits = [];
    const refuse = await run(true);
    expect(refuse.answer).toEqual(sain.answer);
    expect([...refuse.m.storage.map.entries()]).toEqual([...sain.m.storage.map.entries()]);
    expect(lignes()).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${O}`,
        service: SERVICE,
        msg: 'alarm_rearm_failed',
        orderId: O,
        error: 'Error',
      },
    ]);
    expect(ecrits.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});

describe('a write the storage refuses mid-request is said once, by name — the answer unchanged', () => {
  it('the seal refused: one request_failed line with the error’s class and the order; the answer is still the named 500', async () => {
    const O = `ord-quote-${randomUUID()}`;
    const m = monde();
    const pas: [string, unknown][] = [
      ['/order/open', { orderId: O, taskId: 'task-qxtache-2', packageId: `pkg-${O}`, correlationId: `corr-${O}`, supplierId: 'supplier-qxfourn-2' }],
      ['/secrets/arm', { orderId: O, command_id: 'qxcmd-arm-p', kind: 'pickup_verification_code', secret: 'QXPICK-2' }],
      ['/verification', { orderId: O, command_id: 'qxcmd-v', riderId: 'rider-qx-2', presentedPickupCode: 'QXPICK-2', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-qx-2' }],
    ];
    for (const [path, body] of pas) expect((await act(m, O, 'POST', path, body)).status, path).toBe(200);
    ecrits = [];
    m.storage.refusePut = () => true;
    const r = await act(m, O, 'POST', '/custody/begin', { orderId: O, command_id: 'qxcmd-b', riderId: 'rider-qx-2', custodySealId: 'QXSEAL-2', sealPhotoRefs: [] });
    expect(r).toEqual({ status: 500, json: { ok: false, reason: 'internal_error' } });
    expect(lignes()).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${O}`,
        service: SERVICE,
        msg: 'request_failed',
        orderId: O,
        error: 'Error',
      },
    ]);
    expect(ecrits.some((x) => x.includes(MESSAGE) || x.includes('QXSEAL') || x.includes('rider-qx'))).toBe(false);
  });
});

describe('an alert the file cannot write is said once, by name — the verdict unchanged', () => {
  it('a file that lost its ledger head, with the alert write refused: one alerte_raise_failed line; the same verdict as when it is written', async () => {
    const O = `ord-quote-${randomUUID()}`;
    const run = async (refuse: boolean): Promise<{ m: Monde; answer: { status: number; json: unknown } }> => {
      const premier = monde();
      await scelle(premier, O);
      premier.storage.map.delete(HEAD_KEY);
      // A fresh object on the same storage: the next wake rebuilds and finds the damage.
      const m: Monde = { ...premier, objet: new CustodyDO(etat(premier.storage), { PACKAGE_CLAIM: premier.claims }) };
      m.storage.refusePut = (keys) => refuse && keys.includes(ALERTE_GARDE_KEY);
      ecrits = [];
      return { m, answer: await act(m, O, 'GET', `/ledger/verify?orderId=${O}`) };
    };
    const sain = await run(false);
    expect(sain.m.storage.map.has(ALERTE_GARDE_KEY)).toBe(true);
    expect(lignes().filter((l) => l['msg'] === 'alerte_raise_failed')).toEqual([]);

    const refuse = await run(true);
    expect(refuse.answer).toEqual(sain.answer);
    expect(refuse.m.storage.map.has(ALERTE_GARDE_KEY)).toBe(false);
    expect(lignes()).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: `corr-${O}`,
        service: SERVICE,
        msg: 'alerte_raise_failed',
        orderId: O,
        error: 'Error',
      },
    ]);
    expect(ecrits.some((x) => x.includes(MESSAGE))).toBe(false);
  });
});

/**
 * Every other re-arm site, and every wire's two ways of not landing, are
 * pinned at their CALL SITES: a fault is never dropped without its line.
 */
describe('no fault in the custody object is swallowed without its line (call sites)', () => {
  const src = readFileSync('worker/custody-do.ts', 'utf8');
  // One level of nested parentheses inside the call: `setAlarm(Date.now())`.
  const appelArme = String.raw`setAlarm\((?:[^()]|\([^()]*\))*\)`;

  it('no alarm re-arm is dropped silently: all twelve say why', () => {
    expect(src.match(new RegExp(`${appelArme}\\.catch\\(\\(\\) => undefined\\)`, 'g')) ?? []).toEqual([]);
    expect((src.match(new RegExp(`${appelArme}\\.catch\\(\\(e\\) => this\\.rearmeEchoue\\(e\\)\\)`, 'g')) ?? []).length).toBe(12);
  });

  it('no promise in the object is caught into silence', () => {
    expect(src.match(/\.catch\(\(\) => undefined\)/g) ?? []).toEqual([]);
  });

  it('each wire writes its line both where it comes to rest and where a send does not land', () => {
    const corps = (nom: string): string => {
      const debut = src.indexOf(`  private async ${nom}(`);
      expect(debut, nom).toBeGreaterThanOrEqual(0);
      return src.slice(debut, src.indexOf('\n  }\n', debut));
    };
    for (const nom of ['flushEligibility', 'flushRefus', 'flushLost', 'flushTransit', 'flushLogisticsWire', 'flushCourseLivree']) {
      expect((corps(nom).match(/this\.nonLivre\(/g) ?? []).length, nom).toBe(2);
    }
  });
});
