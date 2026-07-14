import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, restore, type FlushOutcome, type OutboxEntry, type OutboxStore } from '../src/offline/outbox';
import { EVIDENCE_KIND, appendEvidence, type EvidenceCaptureIntent } from '../src/offline/evidence';
import { mintCommandId } from '../src/offline/commandId';

/**
 * SERA-S2 · custody evidence on the outbox — the durable half. Fixtures the WO owed:
 * offline-confirm-survives-reboot · evidence-flush-emits-exactly-one · id-stable-across-retry.
 * Persistence is a REAL temp-file store (a fresh instance re-reads committed bytes =
 * "reboot"), so durability means committed bytes survive, not an in-memory illusion.
 */

const intent: EvidenceCaptureIntent = { courseId: 'course-awa', capturedAt: '2026-07-14T09:00:00.000Z' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sera-evidence-'));
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

describe('SERA-S2 — evidence on the outbox', () => {
  it('offline-confirm-survives-reboot: the capture persists pending and survives a kill+reboot', async () => {
    const path = join(dir, 'outbox.json');
    const commandId = mintCommandId();
    await appendEvidence(fileStore(path), commandId, intent);
    // REBOOT: a fresh store re-reads committed bytes — the capture intent survives.
    const afterReboot = await restore(fileStore(path));
    expect(afterReboot).toHaveLength(1);
    expect(afterReboot[0]!.commandId).toBe(commandId);
    expect(afterReboot[0]!.kind).toBe(EVIDENCE_KIND);
    expect(afterReboot[0]!.status).toBe('pending'); // queued = pending, never done (SE-I06)
    expect(afterReboot[0]!.payload).toEqual(intent);
  });

  it('evidence-flush-emits-exactly-one: the same capture flushed twice → applied once, replay after (never two)', async () => {
    const path = join(dir, 'outbox.json');
    const commandId = mintCommandId();
    await appendEvidence(fileStore(path), commandId, intent);
    // the authority applies on first sight of a command_id; any re-sight is an
    // idempotent replay (the lease's rule — only successes settle, replays no-op).
    const seen = new Set<string>();
    const applied: string[] = [];
    const send = async (e: OutboxEntry): Promise<FlushOutcome> => {
      if (seen.has(e.commandId)) return 'idempotentReplay';
      seen.add(e.commandId);
      applied.push(e.commandId);
      return 'applied';
    };
    expect(await flush(fileStore(path), send)).toEqual([{ commandId, outcome: 'applied' }]);
    // a lost-ack retry re-queues the SAME id → idempotentReplay, NOT a second evidence.
    writeFileSync(path, JSON.stringify([{ commandId, kind: EVIDENCE_KIND, payload: intent, status: 'pending' }]));
    expect(await flush(fileStore(path), send)).toEqual([{ commandId, outcome: 'idempotentReplay' }]);
    expect(applied).toEqual([commandId]); // applied EXACTLY once — never two captures for one photo
    expect(await restore(fileStore(path))).toHaveLength(0); // replay settles, drops
  });

  it('id-stable-across-retry: the capture command_id is minted once and identical across every flush retry', async () => {
    const path = join(dir, 'outbox.json');
    const commandId = mintCommandId();
    await appendEvidence(fileStore(path), commandId, intent);
    const sent: string[] = [];
    const refuse = async (e: OutboxEntry): Promise<FlushOutcome> => {
      sent.push(e.commandId);
      return 'collision-refused'; // keeps it pending → retried, never a silent drop
    };
    await flush(fileStore(path), refuse);
    await flush(fileStore(path), refuse);
    await flush(fileStore(path), refuse);
    expect(sent).toEqual([commandId, commandId, commandId]); // never a fresh id per attempt
    expect(new Set(sent).size).toBe(1);
    expect(commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
