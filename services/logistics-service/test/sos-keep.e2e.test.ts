import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { httpSosSender } from '../../../apps/rider-app/src/net/sos-wire';
import { flush, restore, type OutboxEntry, type OutboxStore } from '../../../apps/rider-app/src/offline/outbox';
import { SOS_RAISE_KIND, appendSosRaise, type SosRaiseIntent } from '../../../apps/rider-app/src/offline/sos';
import { drainOnReconnect } from '../../../apps/rider-app/src/offline/backlog';

/**
 * ═══ A RIDER'S SOS IS NEVER LOST ON THE PHONE — asked of the REAL board ═══
 *
 * The app's own outbox and its own `httpSosSender`, against the real logistics
 * Worker under Miniflare. Every outcome is read back from `GET /ops/sos` —
 * the board Séra watches — never from the sender's answer alone.
 *
 *   · an alert the phone could not SAVE is still sent, and recorded once;
 *   · two quick alerts, the first still in the air, are BOTH recorded — the
 *     first one's send can no longer wipe the second from the phone, and the
 *     second is sent at once instead of waiting behind the first.
 */

const OPS = 'test-ops-sos-keep';
const INTAKE = 'test-intake-sos-keep';
const VERIFY = 'test-verify-sos-keep';

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
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'sos-keep-')),
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

async function board(mf: Miniflare): Promise<Record<string, unknown>[]> {
  const res = await mf.dispatchFetch('http://logistics/ops/sos', { headers: { Authorization: `Bearer ${OPS}` } });
  const json = (await res.json()) as Record<string, unknown>;
  return (json['incidents'] ?? []) as Record<string, unknown>[];
}

/** A phone store whose reads and writes take a turn, like the device's — so a
 *  save and a send really can overlap. `refusing` is a full disk. */
function phone(opts: { refusing?: boolean } = {}): OutboxStore & { aside: string[]; refusing: boolean } {
  let held: string | null = null;
  const aside: string[] = [];
  return {
    aside,
    refusing: opts.refusing === true,
    async read() {
      await Promise.resolve();
      return held;
    },
    async write(s) {
      await Promise.resolve();
      if (this.refusing) throw new Error('ENOSPC: no space left on device');
      held = s;
    },
    async keepAside(raw) {
      aside.push(raw);
    },
  };
}

const intent = (riderId: string): SosRaiseIntent => ({
  riderId,
  hours: 'in_hours',
  onShift: true,
  activeCourseId: null,
  raisedAt: '2026-11-27T02:00:00.000Z',
});

/** The Worker, reached the way the app reaches it. */
const direct = (mf: Miniflare) =>
  ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;

describe('⚠ an SOS the phone could not save still reaches Séra’s board', () => {
  it('the save is refused; the alert is sent once with its own command_id and is open on the board, once', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-awa');
    const store = phone({ refusing: true });
    const commandId = 'cmd-sos-unsaved-1';
    await expect(appendSosRaise(store, commandId as never, intent('rider-awa'))).rejects.toThrow(/ENOSPC/);

    // What the app does when the save failed: the same entry, sent as is.
    const entry: OutboxEntry = { commandId: commandId as never, kind: SOS_RAISE_KIND, payload: intent('rider-awa'), status: 'pending' };
    const send = httpSosSender('http://logistics', code, direct(mf));
    expect(await send(entry)).toBe('applied');
    // A later reconnect, the disk has room again: the outbox owes nothing, and
    // a second send of the same entry is the same incident.
    store.refusing = false;
    expect(await drainOnReconnect(store, send)).toBe(0);
    expect(await send(entry)).toBe('idempotentReplay');

    const open = await board(mf);
    expect(open.map((i) => i['commandId'])).toEqual([commandId]);
    expect(open[0]?.['state']).toBe('open');
    expect(open[0]?.['riderId']).toBe('rider-awa');
  }, 60_000);
});

describe('⚠ two quick SOS are both recorded', () => {
  it('the first send is still waiting for its 200 when the rider presses again: both reach the board', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-awa');
    const store = phone();
    await appendSosRaise(store, 'cmd-sos-quick-1' as never, intent('rider-awa'));

    // A slow connection: the first request is held until the second alert is saved.
    const gate: { open?: () => void } = {};
    let first = true;
    const slow = (async (url: string, init?: RequestInit) => {
      if (first) {
        first = false;
        await new Promise<void>((r) => {
          gate.open = r;
        });
      }
      return mf.dispatchFetch(url, init as never);
    }) as never;
    const draining = flush(store, httpSosSender('http://logistics', code, slow));
    for (let i = 0; i < 100 && gate.open === undefined; i += 1) await Promise.resolve();
    expect(gate.open, 'the first alert is on the wire').toBeDefined();

    await appendSosRaise(store, 'cmd-sos-quick-2' as never, intent('rider-awa'));
    gate.open!();
    await draining;
    expect((await restore(store)).map((e) => e.commandId), 'the first one’s 200 wiped the second').toEqual(['cmd-sos-quick-2']);

    await drainOnReconnect(store, httpSosSender('http://logistics', code, direct(mf)));
    expect(await restore(store)).toEqual([]);
    const ids = (await board(mf)).map((i) => i['commandId']).sort();
    expect(ids).toEqual(['cmd-sos-quick-1', 'cmd-sos-quick-2']);
  }, 60_000);

  it('the first send still hangs when the rider presses again: the second is on the board before the first one lands', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-awa');
    const store = phone();
    await appendSosRaise(store, 'cmd-sos-held-1' as never, intent('rider-awa'));

    const gate: { open?: () => void } = {};
    let first = true;
    const slow = (async (url: string, init?: RequestInit) => {
      if (first) {
        first = false;
        await new Promise<void>((r) => {
          gate.open = r;
        });
      }
      return mf.dispatchFetch(url, init as never);
    }) as never;
    const send = httpSosSender('http://logistics', code, slow);
    const firstDrain = flush(store, send);
    for (let i = 0; i < 100 && gate.open === undefined; i += 1) await Promise.resolve();
    expect(gate.open, 'the first alert is on the wire').toBeDefined();

    // The app saves the second alert and drains at once, as `fireSos` does.
    await appendSosRaise(store, 'cmd-sos-held-2' as never, intent('rider-awa'));
    expect(await flush(store, send)).toEqual([{ commandId: 'cmd-sos-held-2', outcome: 'applied' }]);
    expect((await board(mf)).map((i) => i['commandId']), 'the second alert waited behind the first').toEqual(['cmd-sos-held-2']);

    gate.open!();
    expect(await firstDrain).toEqual([{ commandId: 'cmd-sos-held-1', outcome: 'applied' }]);
    expect(await restore(store)).toEqual([]);
    expect((await board(mf)).map((i) => i['commandId']).sort()).toEqual(['cmd-sos-held-1', 'cmd-sos-held-2']);
  }, 60_000);

  it('the first send dies on the sender’s own deadline while the rider presses again: both reach the board', async () => {
    const mf = spawn();
    const code = await riderWithCode(mf, 'rider-awa');
    const store = phone();
    await appendSosRaise(store, 'cmd-sos-dead-1' as never, intent('rider-awa'));

    // A dead zone: the first request never answers; only the sender's own
    // deadline ends it (shortened here, the same abort as the 15 s one).
    let first = true;
    let onWire = false;
    const dead = (async (url: string, init?: RequestInit) => {
      if (first) {
        first = false;
        onWire = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return mf.dispatchFetch(url, init as never);
    }) as never;
    const draining = flush(store, httpSosSender('http://logistics', code, dead, 300));
    for (let i = 0; i < 100 && !onWire; i += 1) await Promise.resolve();
    expect(onWire, 'the first alert is on the wire').toBe(true);

    await appendSosRaise(store, 'cmd-sos-dead-2' as never, intent('rider-awa'));
    expect(await draining).toEqual([{ commandId: 'cmd-sos-dead-1', outcome: 'collision-refused' }]);
    expect((await restore(store)).map((e) => e.commandId).sort(), 'the timeout wiped the second').toEqual(['cmd-sos-dead-1', 'cmd-sos-dead-2']);

    await drainOnReconnect(store, httpSosSender('http://logistics', code, direct(mf)));
    const ids = (await board(mf)).map((i) => i['commandId']).sort();
    expect(ids).toEqual(['cmd-sos-dead-1', 'cmd-sos-dead-2']);
  }, 60_000);
});
