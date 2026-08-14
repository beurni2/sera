import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * PORTE-CUSTODY part C — `paymentMode` rides `/rider/moi` (riderView).
 *
 * The rider's road turns on the course's payment mode: a
 * DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR course inserts the §6.3 door-inspection
 * stage before the buyer's code, a FULL_PREPAY course does not. The mode is
 * the FUNDING FACT's word (SE-I02 — the producer owns the per-mode funding
 * truth; Séra only carries it), projected additively onto the assignment the
 * rider already reads. This suite pins the wire: the mode the intake fact
 * named is the mode `/rider/moi` answers, verbatim, for BOTH admitted modes —
 * and it leaks onto no other read (the board never needs it).
 */

const OPS = 'test-ops-secret-paymode-e2e';
const INTAKE = 'test-intake-secret-paymode-e2e';
const VERIFY = 'test-rider-verify-secret-paymode-e2e';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const intakeAuth = { Authorization: `Bearer ${INTAKE}`, 'Content-Type': 'application/json' };
const codeAuth = (code: string) => ({ Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' });

const T = '2026-08-14T09:00:00.000Z';

let mf: Miniflare;
beforeAll(() => {
  mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'logistics-paymode-')),
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
});
afterAll(() => mf.dispose());

type Json = Record<string, unknown>;

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://logistics${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

const readyEvent = (commandId: string, taskId: string, orderId: string) => ({
  name: 'logistics.task_ready.v1',
  envelope: {
    command_id: commandId,
    correlation_id: `corr-${orderId}`,
    aggregateVersion: 1,
    actor: 'shop-plus:commerce-core',
    serverTime: T,
    version: '1',
  },
  payload: {
    task: {
      type: 'delivery' as const,
      id: taskId,
      orderId,
      location: {
        pin: { lat: 12.3714, lng: -1.5197 },
        zone: 'Gounghin',
        landmark: 'Face à la pharmacie du marché',
        directions: 'Deuxième porte bleue après le kiosque',
        maskedRelay: 'relay-paymode',
      },
      window: { start: T, end: '2026-08-14T16:00:00.000Z' },
      status: 'ready',
    },
  },
});

/** Full rider prep through the REAL doors (the logistics-door pattern). */
async function prepRider(riderId: string): Promise<string> {
  expect(
    (await call('POST', '/ops/riders', opsAuth, {
      riderId,
      displayName: `Rider ${riderId}`,
      phoneAlias: `alias-${riderId}`,
      certified: true,
    })).status,
  ).toBe(200);
  const mint = await call('POST', '/ops/rider-code/mint', opsAuth, { riderId });
  expect(mint.status).toBe(200);
  const code = mint.json['code'] as string;
  expect((await call('POST', '/rider/ack-privacy', codeAuth(code))).status).toBe(200);
  expect((await call('POST', '/rider/shift/start', codeAuth(code))).status).toBe(200);
  return code;
}

/** Fund (in the given mode) → ready → task → assign, through the real doors. */
async function courseInMode(orderId: string, taskId: string, riderId: string, paymentMode: string): Promise<string> {
  expect(
    (await call('POST', '/intake/funding', intakeAuth, { orderId, status: 'funded', paymentMode, asOf: T })).status,
  ).toBe(200);
  expect(
    (await call('POST', '/intake/readiness', intakeAuth, { orderId, ready: true, asOf: T })).status,
  ).toBe(200);
  expect(
    (await call('POST', '/intake/task-ready', intakeAuth, readyEvent(`cmd-ready-${taskId}`, taskId, orderId))).status,
  ).toBe(200);
  const code = await prepRider(riderId);
  const granted = await call('POST', '/ops/assign', opsAuth, {
    command_id: `cmd-assign-${taskId}`,
    taskId,
    riderId,
  });
  expect(granted.status, JSON.stringify(granted.json)).toBe(200);
  return code;
}

describe('riderView carries the funding fact’s paymentMode, additively', () => {
  it('a pay-at-door course rides /rider/moi with DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR, verbatim', async () => {
    const code = await courseInMode('ord-paymode-door', 't-paymode-door', 'r-paymode-door', 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR');
    const moi = await call('GET', '/rider/moi', codeAuth(code));
    expect(moi.status).toBe(200);
    const assignment = (moi.json['rider'] as Json)['assignment'] as Json;
    expect(assignment).toMatchObject({
      orderId: 'ord-paymode-door',
      paymentMode: 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR',
    });
  });

  it('a FULL_PREPAY course says FULL_PREPAY — the mode is the fact’s word, never a constant', async () => {
    const code = await courseInMode('ord-paymode-prepay', 't-paymode-prepay', 'r-paymode-prepay', 'FULL_PREPAY');
    const moi = await call('GET', '/rider/moi', codeAuth(code));
    expect(moi.status).toBe(200);
    const assignment = (moi.json['rider'] as Json)['assignment'] as Json;
    expect(assignment).toMatchObject({ orderId: 'ord-paymode-prepay', paymentMode: 'FULL_PREPAY' });
    // Additive: everything the app already parses is still on the read.
    for (const field of ['assignmentId', 'taskId', 'status', 'codeRamassage', 'codeScelle', 'codeVerification']) {
      expect(Object.hasOwn(assignment, field), `${field} must still ride /rider/moi`).toBe(true);
    }
  });

  it('the mode stays off the reads that never needed it — the board projects no paymentMode', async () => {
    const board = await call('GET', '/ops/board', opsAuth);
    expect(board.status).toBe(200);
    const assignments = (board.json['board'] as Json)['assignments'] as Json[];
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) {
      expect(Object.hasOwn(a, 'paymentMode'), 'the board must not grow paymentMode as a side effect').toBe(false);
    }
  });
});
