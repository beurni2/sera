import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  enqueue,
  flush,
  restore,
  type FlushOutcome,
  type OutboxEntry,
  type OutboxStore,
} from '../src/offline/outbox';
import { CommandIdSchema, mintCommandId } from '../src/offline/commandId';

/**
 * SERA-S1 · the persistent outbox primitive — the three red-first fixtures the
 * grounding owed: offline-write-survives-reboot · duplicate-flush-refused-surfaced
 * · command_id-minted-once-not-per-retry. Persistence is exercised through a REAL
 * temp-file store (node:fs), so "survives reboot" means survives a fresh store
 * instance reading committed bytes — not an in-memory illusion.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sera-outbox-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A durable store backed by a real file — the test stand-in for the document-dir
 * adapter. A NEW instance over the same path models an app relaunch (in-memory gone). */
function fileStore(path: string): OutboxStore {
  return {
    read: async () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: async (s) => writeFileSync(path, s),
  };
}

describe('SERA-S1 — the persistent outbox', () => {
  it('offline-write-survives-reboot: an enqueued entry persists across a simulated kill+reboot', async () => {
    const path = join(dir, 'outbox.json');
    const entry = await enqueue(fileStore(path), 'demo.write', { forWhom: 'awa' });
    // SIMULATE REBOOT: the in-memory world is gone; only the store on the document
    // dir persists. A FRESH store handle over the same file, restored from bytes:
    const afterReboot = await restore(fileStore(path));
    expect(afterReboot).toHaveLength(1);
    expect(afterReboot[0]!.commandId).toBe(entry.commandId);
    expect(afterReboot[0]!.status).toBe('pending'); // queued = pending, never done (SE-I06)
    expect(afterReboot[0]!.payload).toEqual({ forWhom: 'awa' });
  });

  it('duplicate-flush-refused-surfaced: the same command_id flushed twice → idempotentReplay surfaced, applied EXACTLY once', async () => {
    const path = join(dir, 'outbox.json');
    const entry = await enqueue(fileStore(path), 'demo.write', { n: 1 });
    // a stateful authority: the FIRST sight of a command_id applies; any re-sight is
    // an idempotent replay (the lease's rule — only successes settle, replays no-op).
    const seen = new Set<string>();
    const applied: string[] = [];
    const send = async (e: OutboxEntry): Promise<FlushOutcome> => {
      if (seen.has(e.commandId)) return 'idempotentReplay';
      seen.add(e.commandId);
      applied.push(e.commandId);
      return 'applied';
    };
    const first = await flush(fileStore(path), send);
    expect(first).toEqual([{ commandId: entry.commandId, outcome: 'applied' }]);
    // SIMULATE A LOST ACK: the client never learned it applied, so the entry is still
    // queued (re-persist it pending). The retry carries the SAME persisted id.
    writeFileSync(path, JSON.stringify([entry]));
    const second = await flush(fileStore(path), send);
    expect(second).toEqual([{ commandId: entry.commandId, outcome: 'idempotentReplay' }]);
    expect(applied).toEqual([entry.commandId]); // applied ONCE — the duplicate never doubled
    expect(await restore(fileStore(path))).toHaveLength(0); // replay settles, drops
  });

  it('a collision-refused outcome is SURFACED and KEPT pending (never a silent drop)', async () => {
    const path = join(dir, 'outbox.json');
    const entry = await enqueue(fileStore(path), 'demo.write', { n: 1 });
    const res = await flush(fileStore(path), async () => 'collision-refused');
    expect(res).toEqual([{ commandId: entry.commandId, outcome: 'collision-refused' }]);
    const kept = await restore(fileStore(path));
    expect(kept).toHaveLength(1); // surfaced, kept for the caller to resolve
    expect(kept[0]!.commandId).toBe(entry.commandId);
  });

  it('command_id-minted-once-not-per-retry: every retry reuses the PERSISTED id — mint is never re-run', async () => {
    const path = join(dir, 'outbox.json');
    const entry = await enqueue(fileStore(path), 'demo.write', { n: 1 });
    const sent: string[] = [];
    const refuse = async (e: OutboxEntry): Promise<FlushOutcome> => {
      sent.push(e.commandId);
      return 'collision-refused'; // keeps the entry pending, so it is retried
    };
    await flush(fileStore(path), refuse); // attempt 1
    await flush(fileStore(path), refuse); // attempt 2 (retry)
    await flush(fileStore(path), refuse); // attempt 3 (retry)
    // every attempt carried the IDENTICAL persisted command_id — never a fresh mint
    // (the anti-pattern being killed: sos-${riderId}-${raisedAt}, re-minted per attempt).
    expect(sent).toEqual([entry.commandId, entry.commandId, entry.commandId]);
    expect(new Set(sent).size).toBe(1);
  });

  it('the seam ADOPTS the canon mint helper: a valid branded UUIDv4 CommandId, drawn from the CSPRNG', () => {
    const id = mintCommandId();
    expect(CommandIdSchema.safeParse(id).success).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(mintCommandId()).not.toBe(mintCommandId()); // CSPRNG, not a fixed/attempt-derived value
  });

  it('RN-SAFE: the seam imports the canon command-id SUBPATH, never the @platform/contracts barrel', () => {
    const seam = readFileSync(join(import.meta.dirname, '..', 'src', 'offline', 'commandId.ts'), 'utf8');
    const code = seam.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/from '@platform\/contracts\/dist\/command-id\.js'/); // pure-zod subpath
    expect(code).not.toMatch(/from '@platform\/contracts'/); // never the node-only barrel
  });
});
