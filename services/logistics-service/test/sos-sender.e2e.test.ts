import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { httpSosSender } from '../../../apps/rider-app/src/net/sos-wire';
import { append, flush, restore, type OutboxStore } from '../../../apps/rider-app/src/offline/outbox';
import { appendSosRaise } from '../../../apps/rider-app/src/offline/sos';

/**
 * ═══ THE RIDER'S EMERGENCY, THROUGH THE APP'S OWN SENDER ═══
 *
 * ⚠ WHY THIS EXISTS (verifier blocker A3, round four). `httpSosSender` is the
 * ONLY code path that carries a rider's emergency off the handset, and it had
 * no behavioural test at all — repo-wide, the only other mention was a source
 * scan asserting its NAME appears in `App.tsx`.
 *
 * SE-LIVE-4d built both halves of this wire and tested each in isolation:
 * `sos-wire.e2e.test.ts` drives the Worker with raw `dispatchFetch`, never
 * through the app's sender. That is the exact structural gap `rider-path.e2e`
 * was written to close for custody — closed there, left open on the one path
 * where a rider's physical safety is the payload.
 *
 * So this drives the REAL sender against the REAL logistics Worker, through the
 * REAL outbox, and asserts what actually matters: the alert arrives, it arrives
 * under the identity the CODE proves, a retry does not open a second
 * emergency, and anything short of a real 200 keeps it QUEUED rather than
 * dropping it (Law 7 — « queued = pending, never done »).
 */

const OPS = 'test-ops-sos-sender';
const INTAKE = 'test-intake-sos-sender';
const VERIFY = 'test-verify-sos-sender';

let live: Miniflare[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(): Miniflare {
  const persist = mkdtempSync(join(tmpdir(), 'sos-sender-'));
  dirs.push(persist);
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: persist,
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
  live.push(mf);
  return mf;
}

async function ops(mf: Miniflare, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function riderWithCode(mf: Miniflare, riderId: string): Promise<string> {
  await ops(mf, '/ops/riders', { riderId, displayName: riderId, phoneAlias: `alias-${riderId}` });
  const minted = await ops(mf, '/ops/rider-code/mint', { riderId });
  return minted['code'] as string;
}

function memStore(): OutboxStore {
  let held: string | null = null;
  return { async read() { return held; }, async write(s) { held = s; } };
}

/** The app's sender, pointed at the Worker exactly as the app points it. */
function sender(mf: Miniflare, code: string) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpSosSender('http://logistics', code, fetchFn);
}

async function board(mf: Miniflare): Promise<Record<string, unknown>[]> {
  const res = await mf.dispatchFetch('http://logistics/ops/sos', {
    headers: { Authorization: `Bearer ${OPS}` },
  });
  const json = (await res.json()) as Record<string, unknown>;
  return (json['incidents'] ?? json['open'] ?? []) as Record<string, unknown>[];
}

describe('⚠ the alert leaves the phone — the app’s sender, the real Worker', () => {
  it('reaches the dispatcher, under the identity the CODE proves', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-issa');
    const store = memStore();

    await appendSosRaise(store, 'cmd-sos-real-1' as never, {
      // A FICTION in the body on purpose: the server must take the identity
      // from the code and ignore what the handset claims.
      riderId: 'rider-someone-else', hours: 'in_hours', onShift: true,
      activeCourseId: 'ord-1', raisedAt: '2026-08-08T10:00:00.000Z',
    } as never);

    await flush(store, sender(mf, code));
    // Delivered ⇒ the outbox no longer owes it. Law 7's other half.
    expect(await restore(store)).toHaveLength(0);

    const open = await board(mf);
    expect(open.length, `nothing reached the board: ${JSON.stringify(open)}`).toBe(1);
    expect(open[0]?.['riderId']).toBe('rider-issa');
  }, 30_000);

  it('⚠ one press is one emergency, however many times it is retried', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-issa');
    const store = memStore();
    await appendSosRaise(store, 'cmd-sos-retry' as never, {
      riderId: 'rider-issa', hours: 'in_hours', onShift: true,
      activeCourseId: null, raisedAt: '2026-08-08T10:00:00.000Z',
    } as never);

    await flush(store, sender(mf, code));
    // Re-queue the SAME command_id, as a reconnect drain would.
    await appendSosRaise(store, 'cmd-sos-retry' as never, {
      riderId: 'rider-issa', hours: 'in_hours', onShift: true,
      activeCourseId: null, raisedAt: '2026-08-08T10:00:00.000Z',
    } as never);
    await flush(store, sender(mf, code));

    expect(await restore(store)).toHaveLength(0);
    expect((await board(mf)).length, 'a retry must not open a second emergency').toBe(1);
  }, 30_000);

  it('⚠ a rejected alert stays QUEUED — never silently dropped (Law 7)', async () => {
    const mf = spawn();
    await riderWithCode(mf, 'rider-issa');
    const store = memStore();
    await appendSosRaise(store, 'cmd-sos-stranger' as never, {
      riderId: 'rider-issa', hours: 'in_hours', onShift: true,
      activeCourseId: null, raisedAt: '2026-08-08T10:00:00.000Z',
    } as never);

    // A code the server does not know: 401. The alert is NOT delivered, so it
    // must still be owed — dropping it would erase a rider's emergency.
    await flush(store, sender(mf, 'SR-NOPE-NOPE-NOPE'));
    expect(await restore(store)).toHaveLength(1);
    expect((await board(mf)).length).toBe(0);
  }, 30_000);

  it('⚠ speaks only for SOS entries — a foreign kind is kept, not reported sent', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-issa');
    const store = memStore();
    await append(store, {
      commandId: 'cmd-not-sos', kind: 'evidence.bundle', payload: {}, status: 'pending',
    } as never);
    await flush(store, sender(mf, code));
    expect(await restore(store), 'a non-SOS entry must not be dropped').toHaveLength(1);
  }, 30_000);
});
