import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogisticsDO } from '../worker/logistics-do.js';

/**
 * ═══ JOURNAL-SERVICE — a fault the storage raises is said once, by name,
 *     and changes no answer and no row ═══
 *
 * A storage that refuses an alarm or a write cannot be made to happen under
 * Miniflare, so these run the REAL logistics object in Node on a STORAGE
 * DOUBLE — storage is a platform boundary; no app code is stubbed. For the
 * two runs to be compared row for row, the platform's clock and random
 * source are made repeatable (`Date`, `crypto.randomUUID`,
 * `crypto.getRandomValues`); every rule the object applies is its own.
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

const SERVICE = 'logistics-service';
const MESSAGE = 'QXMESSAGE-stockage-refuse';
const T0 = new Date('2026-11-28T08:00:00.000Z');
const T = T0.toISOString();
const WIN = { start: T, end: '2026-11-28T16:00:00.000Z' };
const LOC = { zone: 'Qxzone Gounghin', landmark: 'Qxrepere pharmacie', directions: '', maskedRelay: '' };
const RIDERCODE_PREFIX = 'ridercode:';

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

/** The platform's random source, made repeatable: the same sequence on every run. */
function hasardRejouable(): void {
  let n = 0;
  let graine = 0x2545f491;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
  });
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<A extends ArrayBufferView | null>(tableau: A): A => {
    const octets = new Uint8Array((tableau as unknown as ArrayBufferView).buffer, (tableau as unknown as ArrayBufferView).byteOffset, (tableau as unknown as ArrayBufferView).byteLength);
    for (let i = 0; i < octets.length; i += 1) {
      graine = (graine * 1_103_515_245 + 12_345) >>> 0;
      octets[i] = graine >>> 24;
    }
    return tableau;
  });
}

async function act(objet: LogisticsDO, method: string, path: string, body?: unknown, auth?: string): Promise<{ status: number; json: unknown }> {
  const res = await objet.fetch(new Request(`https://logistics${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth === undefined ? {} : { Authorization: `Bearer ${auth}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: await res.json() };
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
  it('the assignment’s arm refused: one alarm_rearm_failed line; the same answer and the same rows as when it is set', async () => {
    const O = `ord-quote-${randomUUID()}`;
    const run = async (refuse: boolean): Promise<{ storage: Stockage; answer: { status: number; json: unknown } }> => {
      hasardRejouable();
      const storage = new Stockage();
      const objet = new LogisticsDO(etat(storage));
      const ok = async (path: string, body: unknown, auth?: string): Promise<unknown> => {
        const r = await act(objet, 'POST', path, body, auth);
        expect(r.status, `${path} ${JSON.stringify(r.json)}`).toBe(200);
        return r.json;
      };
      await ok('/intake/funding', { orderId: O, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
      await ok('/intake/readiness', { orderId: O, ready: true, asOf: T, supplierRef: 'supplier-qxfourn-1' });
      const taskId = ((await ok('/ops/task', { command_id: 'qxcmd-t', orderId: O, location: LOC, window: WIN })) as { taskId: string }).taskId;
      await ok('/ops/riders', { riderId: 'rider-qx-1', displayName: 'Qxnomcoursier', phoneAlias: 'qxalias-1' });
      await ok('/ops/riders/certify', { riderId: 'rider-qx-1', certified: true });
      const code = ((await ok('/ops/rider-code/mint', { riderId: 'rider-qx-1' })) as { code: string }).code;
      await ok('/rider/ack-privacy', {}, code);
      await ok('/rider/shift/start', {}, code);
      storage.refuseAlarm = refuse;
      const answer = await act(objet, 'POST', '/ops/assign', { command_id: 'qxcmd-a', taskId, riderId: 'rider-qx-1' });
      vi.restoreAllMocks();
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        ecrits.push(args.map(String).join(' '));
      });
      return { storage, answer };
    };
    const sain = await run(false);
    expect(sain.answer.status).toBe(200);
    expect(sain.storage.alarm).not.toBeNull();
    expect(lignes().filter((l) => l['msg'] === 'alarm_rearm_failed')).toEqual([]);

    ecrits = [];
    const refuse = await run(true);
    expect(refuse.answer).toEqual(sain.answer);
    expect([...refuse.storage.map.entries()]).toEqual([...sain.storage.map.entries()]);
    expect(lignes()).toEqual([
      {
        ts: expect.any(String),
        level: 'error',
        correlation_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        service: SERVICE,
        msg: 'alarm_rearm_failed',
        error: 'Error',
      },
    ]);
    expect(ecrits.some((m) => m.includes(MESSAGE))).toBe(false);
  });
});

describe('a write the storage refuses is said once, by name — the answer unchanged', () => {
  it('the book’s save refused after the act: one request_failed line; the answer is still the named persist_failed 500', async () => {
    const storage = new Stockage();
    const objet = new LogisticsDO(etat(storage));
    expect((await act(objet, 'GET', '/ops/board')).status).toBe(200);
    ecrits = [];
    storage.refusePut = () => true;
    const r = await act(objet, 'POST', '/ops/riders', { riderId: 'rider-qx-2', displayName: 'Qxnomcoursier', phoneAlias: 'qxalias-2' });
    expect(r).toEqual({ status: 500, json: { ok: false, reason: 'persist_failed' } });
    expect(lignes()).toEqual([
      { ts: expect.any(String), level: 'error', correlation_id: expect.any(String), service: SERVICE, msg: 'request_failed', error: 'Error' },
    ]);
    expect(ecrits.some((x) => x.includes(MESSAGE) || x.includes('qx'))).toBe(false);
  });

  it('a write refused inside the act: one request_failed line; the answer is still the named internal_error 500', async () => {
    const storage = new Stockage();
    const objet = new LogisticsDO(etat(storage));
    expect((await act(objet, 'POST', '/ops/riders', { riderId: 'rider-qx-3', displayName: 'Qxnomcoursier', phoneAlias: 'qxalias-3' })).status).toBe(200);
    ecrits = [];
    storage.refusePut = (keys) => keys.some((k) => k.startsWith(RIDERCODE_PREFIX));
    const r = await act(objet, 'POST', '/ops/rider-code/mint', { riderId: 'rider-qx-3' });
    expect(r).toEqual({ status: 500, json: { ok: false, reason: 'internal_error' } });
    expect(lignes()).toEqual([
      { ts: expect.any(String), level: 'error', correlation_id: expect.any(String), service: SERVICE, msg: 'request_failed', error: 'Error' },
    ]);
    expect(ecrits.some((x) => x.includes(MESSAGE) || x.includes('qx'))).toBe(false);
  });
});

/**
 * Every other re-arm site, every wire's ways of not landing and every
 * best-effort read of custody are pinned at their CALL SITES: a fault is
 * never dropped without its line.
 */
describe('no fault in the logistics object is swallowed without its line (call sites)', () => {
  const src = readFileSync('worker/logistics-do.ts', 'utf8');
  const appelArme = String.raw`setAlarm\((?:[^()]|\([^()]*\))*\)`;
  const methode = (nom: string): string => {
    const debut = src.indexOf(`  private async ${nom}(`);
    expect(debut, nom).toBeGreaterThanOrEqual(0);
    return src.slice(debut, src.indexOf('\n  }\n', debut));
  };
  const entre = (de: string, a: string): string => {
    const debut = src.indexOf(de);
    expect(debut, de).toBeGreaterThanOrEqual(0);
    const fin = src.indexOf(a, debut);
    expect(fin, a).toBeGreaterThan(debut);
    return src.slice(debut, fin);
  };

  it('no alarm re-arm is dropped silently: all eight say why', () => {
    expect(src.match(new RegExp(`${appelArme}\\.catch\\(\\(\\) => undefined\\)`, 'g')) ?? []).toEqual([]);
    expect((src.match(new RegExp(`${appelArme}\\.catch\\(\\(e\\) => this\\.rearmeEchoue\\(e\\)\\)`, 'g')) ?? []).length).toBe(8);
  });

  it('each wire into custody writes its line where it comes to rest and where a send does not land', () => {
    expect((methode('flushCustodyProduce').match(/this\.nonLivre\(/g) ?? []).length).toBe(3);
    expect((methode('flushRetourArm').match(/this\.nonLivre\(/g) ?? []).length).toBe(2);
  });

  it('every best-effort call to custody or the media door says, by name, that it went unanswered', () => {
    const sites: [string, string, 'warn' | 'error'][] = [
      [methode('readCustodian'), 'custody_read_failed', 'warn'],
      [methode('codesBloques'), 'custody_read_failed', 'warn'],
      [methode('reviveCustodyWires'), 'custody_revive_failed', 'warn'],
      [entre('const dejaDeclare = async', "status: 'deja_declare'"), 'custody_relay_failed', 'error'],
      [entre("pathname === '/rider/repere-audio'", 'return new Response(answer.body'), 'media_read_failed', 'warn'],
    ];
    for (const [corps, msg, niveau] of sites) {
      expect(corps.split('} catch {').length - 1, msg).toBe(0);
      expect(corps, msg).toMatch(new RegExp(String.raw`\} catch \(e\) \{[^}]*\.${niveau}\('${msg}'`));
    }
  });
});
