import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * CLES-PRODUCTEURS-1 (AUDIT-B+2 F-40) — ONE INTAKE KEY PER PRODUCER, on the
 * real logistics Worker (workerd via Miniflare).
 *
 * Before: `SERA_INTAKE_SECRET` opened every intake door alike, so Boutik+'s
 * Worker could assert a FUNDING fact (payment truth, Shop+'s domain) and
 * Shop+'s could assert READINESS or ask for handover verdicts (Boutik+'s) —
 * Build-Spec §5.2 « no app writes another domain's truth ».
 *
 * Now each door belongs to one producer: /intake/funding to Shop+
 * (`SERA_INTAKE_SHOP_SECRET`); readiness, task-ready and both handover
 * verdicts to Boutik+ (`SERA_INTAKE_BOUTIK_SECRET`). The old shared key keeps
 * opening every door until the founder deletes it — the changeover window,
 * so neither producer's facts are refused while he swaps the values.
 *
 * The requests are the ones the producers really send (Bearer + the fact),
 * and the outcome is asked of the LEDGER: a refused fact must leave no trace
 * — the next task for that order still finds the fact missing.
 */

const SHARED = 'test-intake-shared-cles-producteurs';
const SHOP = 'test-intake-shop-cles-producteurs';
const BOUTIK = 'test-intake-boutik-cles-producteurs';
const T = '2026-09-26T12:00:00.000Z';

const workers: Miniflare[] = [];
const boot = (bindings: Record<string, string>) => {
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    bindings,
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'intake-cles-')),
  });
  workers.push(mf);
  return mf;
};
afterAll(async () => {
  await Promise.all(workers.map((m) => m.dispose()));
});

const post = async (m: Miniflare, path: string, key: string | null, body: unknown) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== null) headers['Authorization'] = `Bearer ${key}`;
  const res = await m.dispatchFetch(`http://logistics${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const funding = (orderId: string) => ({ orderId, status: 'funded', paymentMode: 'FULL_PREPAY', asOf: T });
const readiness = (orderId: string) => ({ orderId, ready: true, asOf: T });
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
const verify = (orderId: string) => ({ command_id: `v-${orderId}`, orderId, code: 'ABCD' });

/** Every intake door, the producer that owns it, and a body it accepts. */
const DOORS = [
  { path: '/intake/funding', owner: 'shop', body: funding },
  { path: '/intake/readiness', owner: 'boutik', body: readiness },
  { path: '/intake/task-ready', owner: 'boutik', body: taskReady },
  { path: '/intake/ramassage/verify', owner: 'boutik', body: verify },
  { path: '/intake/retour/verify', owner: 'boutik', body: verify },
] as const;

describe('the changeover window — shared key + both producer keys set', () => {
  const mf = boot({ SERA_INTAKE_SECRET: SHARED, SERA_INTAKE_SHOP_SECRET: SHOP, SERA_INTAKE_BOUTIK_SECRET: BOUTIK });

  it.each(DOORS)('$path — the old shared key still opens it (nothing refused while he swaps)', async ({ path, body }) => {
    expect((await post(mf, path, SHARED, body(`o-shared-${path}`))).status).not.toBe(401);
  });

  it.each(DOORS)("$path — only its owner's key opens it; the other producer's key gets the one 401", async ({ path, owner, body }) => {
    const own = owner === 'shop' ? SHOP : BOUTIK;
    const other = owner === 'shop' ? BOUTIK : SHOP;
    expect((await post(mf, path, own, body(`o-own-${path}`))).status).not.toBe(401);
    const crossed = await post(mf, path, other, body(`o-cross-${path}`));
    expect(crossed.status).toBe(401);
    expect(crossed.json).toEqual({ error: 'unauthorized' });
  });
});

describe('the split — the shared key deleted, each producer on its own key', () => {
  const mf = boot({ SERA_INTAKE_SHOP_SECRET: SHOP, SERA_INTAKE_BOUTIK_SECRET: BOUTIK });

  it.each(DOORS)('$path — the retired shared key opens nothing', async ({ path, body }) => {
    expect((await post(mf, path, SHARED, body(`o-old-${path}`))).status).toBe(401);
  });

  it('the ledger: Shop+ funds, Boutik+ readies, the task is admitted', async () => {
    expect((await post(mf, '/intake/funding', SHOP, funding('order-vrai'))).status).toBe(200);
    expect((await post(mf, '/intake/readiness', BOUTIK, readiness('order-vrai'))).status).toBe(200);
    const task = await post(mf, '/intake/task-ready', BOUTIK, taskReady('order-vrai'));
    expect(task.status).toBe(200);
    expect(task.json).toMatchObject({ ok: true, admitted: true });
  });

  it('the ledger: a funding fact sent with BOUTIK+\'s key is refused and leaves no trace', async () => {
    expect((await post(mf, '/intake/funding', BOUTIK, funding('order-faux-fonds'))).status).toBe(401);
    expect((await post(mf, '/intake/readiness', BOUTIK, readiness('order-faux-fonds'))).status).toBe(200);
    const task = await post(mf, '/intake/task-ready', BOUTIK, taskReady('order-faux-fonds'));
    expect(task.json).toMatchObject({ admitted: false, reason: 'funding_projection_stale' });
  });

  it('the ledger: a readiness fact sent with SHOP+\'s key is refused and leaves no trace', async () => {
    expect((await post(mf, '/intake/funding', SHOP, funding('order-faux-pret'))).status).toBe(200);
    expect((await post(mf, '/intake/readiness', SHOP, readiness('order-faux-pret'))).status).toBe(401);
    const task = await post(mf, '/intake/task-ready', BOUTIK, taskReady('order-faux-pret'));
    expect(task.json).toMatchObject({ admitted: false, reason: 'readiness_projection_stale' });
  });
});

describe('before the founder mints anything — the shared key alone, byte-identical to today', () => {
  const mf = boot({ SERA_INTAKE_SECRET: SHARED });

  it.each(DOORS)('$path — the shared key opens it; a producer key nobody set opens nothing', async ({ path, body }) => {
    expect((await post(mf, path, SHARED, body(`o-today-${path}`))).status).not.toBe(401);
    expect((await post(mf, path, SHOP, body(`o-today-s-${path}`))).status).toBe(401);
    expect((await post(mf, path, BOUTIK, body(`o-today-b-${path}`))).status).toBe(401);
  });
});

describe('fail-closed — no intake key set at all', () => {
  const mf = boot({});

  it.each(DOORS)('$path — no key, an empty key and any key are the one 401', async ({ path, body }) => {
    for (const key of [null, '', SHARED, SHOP, BOUTIK]) {
      const res = await post(mf, path, key, body(`o-none-${path}`));
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ error: 'unauthorized' });
    }
  });
});
