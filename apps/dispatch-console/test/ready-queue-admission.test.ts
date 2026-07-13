import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockBoutikReadiness, MockShopPlusFunding, ReadyQueue } from '@sera/logistics-service';

/**
 * WO-6.9-b · D1 — an UNFUNDED order is UNRENDERABLE in the dispatch console,
 * NOT hidden by a filter.
 *
 * Spec (SE-I02; ECOSYSTEM-MASTER-REFERENCE PART 8 §1): a task appears only when
 * funded-per-mode + supplier-ready + non-cancelled — "An unfunded or unprepared
 * order is not 'at the bottom of the list' — **it is not in the room.**"
 *
 * The console renders whatever `queue.queuedTasks()` returns and nothing else
 * (main.ts). The proof of "unrenderable, not filtered" is two-sided:
 *  (a) BEHAVIOURAL — the queue the console reads REFUSES an unfunded order at
 *      intake, so it never enters `queuedTasks()`; and
 *  (b) STRUCTURAL — the console source carries NO funding/funded/admitted/filter
 *      logic at all, so it *cannot* hide an admitted task; the funded-gate lives
 *      entirely upstream in ReadyQueue. There is nothing for a render filter to do.
 */

const T = '2026-07-09T12:00:00.000Z';
const SHA = 'a3f5c9d21e8b47061234567890abcdef1234567890abcdef1234567890abcdef';

const taskFor = (id: string, orderId: string) => ({
  type: 'delivery' as const,
  id,
  orderId,
  location: {
    pin: { lat: 12.3714, lng: -1.5197 },
    zone: 'Gounghin',
    landmark: 'Face à la pharmacie du marché',
    directions: 'Deuxième porte bleue après le kiosque',
    maskedRelay: `relay-${orderId}`,
  },
  window: { start: T, end: '2026-07-09T14:00:00.000Z' },
  status: 'ready' as const,
});

const readyEvent = (command_id: string, correlation_id: string, orderId: string, taskId: string) => ({
  name: 'logistics.task_ready.v1',
  envelope: { command_id, correlation_id, aggregateVersion: 1, actor: 'logistics-service:d1-test', serverTime: T, version: '1' },
  payload: { task: taskFor(taskId, orderId) },
});

const readiness = (orderId: string) => ({
  orderId,
  photoRef: { ref: `media/${orderId}.jpg`, sha256: SHA, mimeType: 'image/jpeg' },
  readinessChallenge: `challenge-${orderId}`,
  qty: 1,
  variant: 'taille unique',
  availableConfirmed: true,
  at: T,
});

describe('WO-6.9-b D1 — unfunded is UNRENDERABLE, not filtered (SE-I02, PART 8 §1)', () => {
  it('the console queue REFUSES an unfunded order at intake — it never enters queuedTasks()', () => {
    const funding = new MockShopPlusFunding({});
    const rd = new MockBoutikReadiness({});
    // FUNDED order A: checkout + confirm + readiness → admissible.
    funding.initiateCheckout('order-A', 'FULL_PREPAY', 'corr-A');
    funding.confirmFunding('order-A', 'collect-A', T);
    rd.recordOrderKnown('order-A', 'corr-A');
    rd.confirmReadiness(readiness('order-A'), T);
    // UNFUNDED order B: checkout + readiness but NO confirmFunding → not in the room.
    funding.initiateCheckout('order-B', 'FULL_PREPAY', 'corr-B');
    rd.recordOrderKnown('order-B', 'corr-B');
    rd.confirmReadiness(readiness('order-B'), T);

    const q = new ReadyQueue({ funding, readiness: rd });

    expect(q.onTaskReady(readyEvent('cmd-A', 'corr-A', 'order-A', 'task-A'), T)).toMatchObject({ admitted: true });
    // the unfunded order is REFUSED at intake — structurally absent, not queued-then-hidden
    expect(q.onTaskReady(readyEvent('cmd-B', 'corr-B', 'order-B', 'task-B'), T)).toEqual({
      admitted: false,
      reason: 'not_funded_for_mode',
    });

    const ids = q.queuedTasks().map((t) => t.task.id);
    expect(ids).toEqual(['task-A']); // ONLY the funded task is in the room
    expect(ids).not.toContain('task-B'); // the unfunded order is UNRENDERABLE — never queued
  });

  it('the console CANNOT filter on funding — main.ts carries no funding/funded/admitted/filter logic', () => {
    const main = readFileSync(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // the render's ONLY queue source is queue.queuedTasks()
    expect(main).toMatch(/queue\.queuedTasks\(\)/);
    // and there is NO funding awareness or queue filter in the console — so an
    // admitted task can never be hidden; the funded-gate is upstream (ReadyQueue).
    expect(main).not.toMatch(/\bfunded\b|\bfunding\b|\badmitted\b|\bunfunded\b/);
    expect(main).not.toMatch(/queuedTasks\(\)\s*\.\s*filter\(/);
  });
});
