import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, restore, type FlushOutcome, type OutboxEntry, type OutboxStore } from '../src/offline/outbox';
import { SOS_RAISE_KIND, appendSosRaise, type SosRaiseIntent } from '../src/offline/sos';
import { mintCommandId } from '../src/offline/commandId';
import { acknowledgeSos, createDemoWorld, raiseSos } from '../src/demo/store';

/**
 * SERA-S3 · SOS on the outbox — the drill's software half. The three red-first
 * fixtures the grounding owed: offline-sos-survives-reboot-then-flushes-once ·
 * sos-id-stable-across-retry · queued-sos-still-unacknowledgeable. Persistence is
 * a REAL temp-file store (a fresh instance re-reads committed bytes = "reboot").
 */

const RIDER = 'rider-moussa-demo';
const AT = '2026-07-12T09:00:00.000Z';
const intent: SosRaiseIntent = { riderId: RIDER, hours: 'in_hours', onShift: true, activeCourseId: null, raisedAt: AT };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sera-sos-'));
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

describe('SERA-S3 — SOS on the outbox', () => {
  it('offline-sos-survives-reboot-then-flushes-once: the raise persists, survives reboot, and creates the SOS EXACTLY once', async () => {
    const path = join(dir, 'sos.json');
    const commandId = mintCommandId();
    await appendSosRaise(fileStore(path), commandId, intent);
    // REBOOT: a fresh store re-reads committed bytes — the raise intent survives.
    const afterReboot = await restore(fileStore(path));
    expect(afterReboot).toHaveLength(1);
    expect(afterReboot[0]!.commandId).toBe(commandId);
    expect(afterReboot[0]!.kind).toBe(SOS_RAISE_KIND);
    // AT-LEAST-ONCE with dedup: the authority applies on first sight, replays after.
    const seen = new Set<string>();
    const created: string[] = [];
    const send = async (e: OutboxEntry): Promise<FlushOutcome> => {
      if (seen.has(e.commandId)) return 'idempotentReplay';
      seen.add(e.commandId);
      created.push(e.commandId);
      return 'applied';
    };
    expect(await flush(fileStore(path), send)).toEqual([{ commandId, outcome: 'applied' }]);
    // a lost-ack retry re-queues the SAME id → idempotentReplay, NOT a second SOS.
    writeFileSync(path, JSON.stringify([{ commandId, kind: SOS_RAISE_KIND, payload: intent, status: 'pending' }]));
    expect(await flush(fileStore(path), send)).toEqual([{ commandId, outcome: 'idempotentReplay' }]);
    expect(created).toEqual([commandId]); // created EXACTLY once — never two SOS for one press
  });

  it('sos-id-stable-across-retry: the SOS command_id is minted once and identical across every flush retry', async () => {
    const path = join(dir, 'sos.json');
    const commandId = mintCommandId();
    await appendSosRaise(fileStore(path), commandId, intent);
    const sent: string[] = [];
    const refuse = async (e: OutboxEntry): Promise<FlushOutcome> => {
      sent.push(e.commandId);
      return 'collision-refused'; // keeps it pending → retried
    };
    await flush(fileStore(path), refuse);
    await flush(fileStore(path), refuse);
    await flush(fileStore(path), refuse);
    expect(sent).toEqual([commandId, commandId, commandId]); // never a fresh id per attempt
    expect(new Set(sent).size).toBe(1);
    // the retired per-attempt format `sos-${riderId}-${raisedAt}` is DEAD — this is a canon UUIDv4.
    expect(commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(commandId).not.toMatch(/^sos-/);
  });

  it('queued-sos-still-unacknowledgeable: an offline (queued) SOS carries the command_id id AND still throws on ack (unchanged)', () => {
    const world = createDemoWorld();
    const commandId = mintCommandId();
    const queued = raiseSos(world, commandId, {
      riderId: RIDER,
      onShift: true,
      activeCourseId: null,
      connectivity: 'offline',
      hours: 'in_hours',
    });
    expect(queued.status).toBe('queued');
    expect(queued.id).toBe(commandId); // the identity is the command_id, not a timestamp
    expect(queued.events).toEqual([]); // nothing emitted offline (queued = pending)
    // the ack path is untouched — you cannot acknowledge what has not arrived.
    expect(() => acknowledgeSos(world, 'dispatcher')).toThrow();
    expect(world.incident?.status).toBe('queued'); // still queued — no fake ack
  });
});
