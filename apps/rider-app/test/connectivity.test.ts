import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../src/offline/connectivity';
import { drainOnReconnect, pendingCount } from '../src/offline/backlog';
import { enqueue, type FlushOutcome, type OutboxStore } from '../src/offline/outbox';

/**
 * SERA-S4 · connectivity is real + the backlog is truthful (GP-SERA · closes the
 * durability arc). The port reflects real changes; the banner's N is the REAL count
 * of pending durable writes; reconnect drains the outbox and the backlog clears to
 * what actually remains (a refused write stays counted — surfaced, never dropped).
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sera-conn-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fileStore(path: string): OutboxStore {
  return {
    read: async () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: async (s) => writeFileSync(path, s),
  };
}

describe('SERA-S4 — the connectivity port', () => {
  it('reflects the last-known state and notifies subscribers ONLY on a real change', () => {
    const net = createManualConnectivity('online');
    expect(net.current()).toBe('online');
    const seen: string[] = [];
    const unsubscribe = net.subscribe((c) => seen.push(c));

    net.set('offline');
    expect(net.current()).toBe('offline');
    net.set('offline'); // no change → no phantom notification (no spurious reconnect flush)
    net.set('online');
    expect(seen).toEqual(['offline', 'online']); // exactly the two real transitions

    unsubscribe();
    net.set('offline'); // after unsubscribe → not delivered
    expect(seen).toEqual(['offline', 'online']);
    expect(net.current()).toBe('offline'); // state still tracked
  });
});

describe('SERA-S4 — the truthful backlog + reconnect drain', () => {
  it('pendingCount is the REAL number of queued durable writes — never a guess', async () => {
    const path = join(dir, 'outbox.json');
    expect(await pendingCount(fileStore(path))).toBe(0); // absent store → 0
    await enqueue(fileStore(path), 'sos.raise', { n: 1 });
    await enqueue(fileStore(path), 'delivery.evidence', { n: 2 });
    expect(await pendingCount(fileStore(path))).toBe(2); // exactly what is queued
  });

  it('reconnect drains the outbox and the backlog clears to zero (server accepts each)', async () => {
    const path = join(dir, 'outbox.json');
    await enqueue(fileStore(path), 'sos.raise', { n: 1 });
    await enqueue(fileStore(path), 'delivery.evidence', { n: 2 });
    const applied = async (): Promise<FlushOutcome> => 'applied';
    const remaining = await drainOnReconnect(fileStore(path), applied);
    expect(remaining).toBe(0); // banner clears WITH the backlog
    expect(await pendingCount(fileStore(path))).toBe(0);
  });

  it('a collision-refused write STAYS counted after a drain — surfaced, never silently dropped', async () => {
    const path = join(dir, 'outbox.json');
    await enqueue(fileStore(path), 'sos.raise', { n: 1 });
    const refuse = async (): Promise<FlushOutcome> => 'collision-refused';
    const remaining = await drainOnReconnect(fileStore(path), refuse);
    expect(remaining).toBe(1); // still counted — the banner keeps telling the truth
  });
});
