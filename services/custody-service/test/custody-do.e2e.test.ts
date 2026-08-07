import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ SE-LIVE-3 (M4) — CUSTODY ON THE REAL RUNTIME ═══
 *
 * The custody core is library-complete and heavily tested in `src`. What was
 * NEVER true until this slice is that any of it SURVIVES — a Worker restarts,
 * an object evicts, and until now every ledger entry and every spent code
 * lived in memory that vanishes. This suite exists for that one word:
 * **durable**.
 *
 * EVERY DURABILITY CLAIM CROSSES A REAL PROCESS DEATH: the Miniflare instance
 * is disposed and re-created on the SAME persist dir, so « it survived » means
 * the runtime died and the state came back — not that a second request found
 * a warm object.
 *
 * IT ALSO PROVES THE ARCHITECTURE. The spine is rebuilt by REPLAYING its
 * command log, so these tests are the evidence that replay is faithful: the
 * hash chain still verifies after a restart (a replayed ledger that differed
 * by one byte would fail `verifyChain`), and a consumed pickup code is still
 * consumed (a replayed registry that forgot would let a spent secret work
 * twice — the exact failure the four-secrets law exists to prevent).
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-custody-ops-secret-0001';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };

const ORDER = 'ord-custody-0001';
const CHAIN = {
  orderId: ORDER,
  taskId: 'task-custody-0001',
  packageId: 'pkg-custody-0001',
  correlationId: 'corr-custody-0001',
  supplierId: 'supplier-custody-0001',
};
const PICKUP_CODE = 'PICKUP-CODE-0001';
const T = '2026-08-07T09:00:00.000Z';

/** The policy's nine checks, all passing — the accepted path. */
const ALL_PASS = {
  order_ref: true, identity: true, variant: true, colour: true, size_label: true,
  qty: true, damage: true, pieces: true, manufacturer_seal: true,
};

const persist = mkdtempSync(join(tmpdir(), 'custody-do-'));
const persistB = mkdtempSync(join(tmpdir(), 'custody-do-b-'));

function boot(dir: string): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    // ⚠ THE FLAG THE CUSTODY CORE CANNOT RUN WITHOUT — the ledger and the
    // secret registry hash with node's synchronous createHash. Without this
    // the module does not even resolve (measured); with it they run unchanged.
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
  });
}

let mf = boot(persist);

afterAll(async () => {
  await mf.dispose();
  rmSync(persist, { recursive: true, force: true });
  rmSync(persistB, { recursive: true, force: true });
});

/** A real process death on the same storage. */
async function restart(): Promise<void> {
  await mf.dispose();
  mf = boot(persist);
}

type Json = Record<string, unknown>;

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

describe('the custody door — fail-closed, and it opens for exactly one key', () => {
  it('GET /health is unauthenticated and carries only the provenance stamp', async () => {
    const res = await call('GET', '/health', {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, service: 'custody-service', release: 'dev', canon: 'dev' });
  });

  it('no bearer and a wrong bearer are the SAME uniform 401 — on a route that would otherwise read a ledger', async () => {
    const naked = await call('GET', `/ops/ledger?orderId=${ORDER}`, {});
    const wrong = await call('GET', `/ops/ledger?orderId=${ORDER}`, { Authorization: 'Bearer wrong' });
    expect([naked.status, wrong.status]).toEqual([401, 401]);
    expect(wrong.json).toEqual(naked.json);
    expect(naked.json).toEqual({ error: 'unauthorized' });
  });

  it('a route outside /ops is 404 and never reaches an object', async () => {
    expect((await call('GET', '/ledger', opsAuth)).status).toBe(404);
    expect((await call('POST', '/anything', opsAuth, {})).status).toBe(404);
  });

  it('every custody route needs the order that names its object', async () => {
    const res = await call('GET', '/ops/ledger', opsAuth);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ reason: 'order_id_required' });
  });

  it('acts before the order is open refuse closed — no custody file, no custody', async () => {
    const res = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: 'ord-never-opened', command_id: 'c1', kind: 'pickup_verification_code', secret: 'X',
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ reason: 'order_not_open' });
  });
});

describe('the custody file — opened once, and its chain ids are not rewritable', () => {
  it('opens with its chain ids', async () => {
    const res = await call('POST', '/ops/order/open', opsAuth, CHAIN);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, status: 'open' });
  });

  it('an IDENTICAL re-open is absorbed; a DIFFERENT one refuses — re-basing a custody file is not a thing', async () => {
    const same = await call('POST', '/ops/order/open', opsAuth, CHAIN);
    expect(same.status).toBe(200);
    expect(same.json).toMatchObject({ status: 'already_open' });

    const other = await call('POST', '/ops/order/open', opsAuth, { ...CHAIN, packageId: 'pkg-SOMEONE-ELSE' });
    expect(other.status).toBe(409);
    expect(other.json).toMatchObject({ reason: 'chain_already_open_with_other_ids' });
  });
});

describe('pickup verification — the code is consumed, the ledger records, the chain holds', () => {
  it('arms the rider pickup code (and the plaintext is never returned)', async () => {
    const res = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: ORDER, command_id: 'cmd-arm-pickup', kind: 'pickup_verification_code', secret: PICKUP_CODE,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, status: 'armed', kind: 'pickup_verification_code' });
    expect(JSON.stringify(res.json)).not.toContain(PICKUP_CODE);
  });

  it('A WRONG CODE IS REFUSED and records NOTHING — the ledger stays empty', async () => {
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'cmd-verify-wrong', riderId: 'rider-1',
      presentedPickupCode: 'NOT-THE-CODE', checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: T,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused' });
    const ledger = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    expect(ledger.json['entries']).toEqual([]);
  });

  /**
   * ⚠ AND IT BURNS THE CODE — pre-existing core behaviour, documented here
   * because a test written on the assumption it did NOT is how a wrong belief
   * gets frozen. `CustodySpine.verifyPickup` consumes the single-use pickup
   * code BEFORE running the policy, so an out-of-policy check list spends the
   * presentation. This runs on its OWN order so it cannot poison the accepted
   * path below, and asserts the burn explicitly.
   *
   * The operational consequence is REAL and is flagged in JOURNAL.md rather
   * than patched here: `openNewVerificationCycle` re-arms only after a
   * `refused` verification, and this outcome is `invalid`, so a rider whose
   * app sends a malformed check list burns the code with no re-arm path.
   * Changing that is a custody-core change and belongs to its own slice with
   * the founder's ruling — not to a test fixing itself.
   */
  it('A CHECK OUTSIDE POLICY v1 is refused — riders verify objective conformity only (SE-I12) — and the code is spent by the attempt', async () => {
    const order = 'ord-custody-outside';
    const code = 'PICKUP-OUTSIDE-0003';
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-o', packageId: 'pkg-o', correlationId: 'corr-o', supplierId: 'sup-o',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'cmd-arm-o', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);

    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-outside', riderId: 'rider-1',
      presentedPickupCode: code,
      checkResults: { ...ALL_PASS, authenticity: true }, // not a check a rider can run
      dwellSec: 150, evidenceBundleId: 'ev-o', at: T,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ kind: 'invalid', reason: 'check_not_in_policy', detail: 'authenticity' });
    // Nothing was RECORDED…
    expect((await call('GET', `/ops/ledger?orderId=${order}`, opsAuth)).json['entries']).toEqual([]);
    // …but the code was SPENT by the presentation: a well-formed retry with
    // the same code is now refused. This is the trap named above.
    const retry = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-outside-retry', riderId: 'rider-1',
      presentedPickupCode: code, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-o', at: T,
    });
    expect(retry.status).toBe(409);
    expect(retry.json).toMatchObject({ reason: 'pickup_code_refused', detail: 'secret_already_used' });
  });

  it('THE ACCEPTED VERIFICATION: recorded on the hash chain, and the chain verifies', async () => {
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'cmd-verify-ok', riderId: 'rider-1',
      presentedPickupCode: PICKUP_CODE, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: T,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, kind: 'accepted', chainValid: true });

    const ledger = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    const entries = ledger.json['entries'] as Json[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'pickup_verification', packageId: CHAIN.packageId, seq: 0 });
    expect((entries[0]?.['payload'] as Json)['result']).toBe('accepted');
    // The genesis link and a real hash — not a placeholder.
    expect(entries[0]?.['prevHash']).toBe('0'.repeat(64));
    expect(String(entries[0]?.['hash'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('THE CODE IS SPENT: presenting it a second time is refused (four-secrets, single-use)', async () => {
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'cmd-verify-replay-different-command', riderId: 'rider-1',
      presentedPickupCode: PICKUP_CODE, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: T,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused', detail: 'secret_already_used' });
  });

  it('and a spent code CANNOT BE RE-ARMED — a used secret stays used', async () => {
    const res = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: ORDER, command_id: 'cmd-rearm', kind: 'pickup_verification_code', secret: PICKUP_CODE,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ reason: 'secret_already_used' });
  });

  it('the SAME command replays as a duplicate — one act, one ledger entry', async () => {
    const again = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'cmd-verify-ok', riderId: 'rider-1',
      presentedPickupCode: PICKUP_CODE, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: T,
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ status: 'duplicate' });
    const ledger = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    expect(ledger.json['entries']).toHaveLength(1);
  });
});

describe('DURABILITY — the whole point of this slice, across a real process death', () => {
  it('the ledger, its hash chain, the emitted events AND the spent code all survive a restart', async () => {
    const beforeLedger = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    const beforeEvents = await call('GET', `/ops/events?orderId=${ORDER}`, opsAuth);

    await restart(); // the runtime dies here

    const after = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    // BYTE-FOR-BYTE the same ledger — a replay that differed anywhere would
    // change a hash, and the chain check below would fail.
    expect(after.json['entries']).toEqual(beforeLedger.json['entries']);

    const verify = await call('GET', `/ops/ledger/verify?orderId=${ORDER}`, opsAuth);
    expect(verify.json).toMatchObject({ ok: true, valid: true });

    // The spine's emitted events came back too (they are replayed, not stored).
    const afterEvents = await call('GET', `/ops/events?orderId=${ORDER}`, opsAuth);
    expect(afterEvents.json['events']).toEqual(beforeEvents.json['events']);
    expect((afterEvents.json['events'] as Json[]).length).toBeGreaterThan(0);

    // AND THE SPENT CODE IS STILL SPENT. This is the assertion that matters
    // most: if replay rebuilt the registry without its consumption, a used
    // pickup code would work again after any restart.
    const reuse = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'cmd-verify-after-restart', riderId: 'rider-1',
      presentedPickupCode: PICKUP_CODE, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: T,
    });
    expect(reuse.status).toBe(409);
    expect(reuse.json).toMatchObject({ reason: 'pickup_code_refused', detail: 'secret_already_used' });
  });

  it('a REFUSED verification is recorded as a custody fact and survives too — the refusal path is first-class', async () => {
    const order = 'ord-custody-refused';
    const code = 'PICKUP-REFUSED-0002';
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-r', packageId: 'pkg-r', correlationId: 'corr-r', supplierId: 'sup-r',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'cmd-arm-r', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);

    const refused = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-r', riderId: 'rider-2',
      presentedPickupCode: code,
      checkResults: { ...ALL_PASS, damage: false }, // the package arrived damaged
      dwellSec: 200, evidenceBundleId: 'ev-r', at: T,
    });
    expect(refused.status).toBe(200);
    expect(refused.json).toMatchObject({ ok: true, kind: 'refused' });

    await restart();

    const ledger = await call('GET', `/ops/ledger?orderId=${order}`, opsAuth);
    const entries = ledger.json['entries'] as Json[];
    expect(entries).toHaveLength(1);
    expect((entries[0]?.['payload'] as Json)['result']).toBe('refused');
    // Custody NEVER began: no custodian was established by a refused pickup.
    expect(ledger.json['currentCustodian']).toBeNull();
    expect((await call('GET', `/ops/ledger/verify?orderId=${order}`, opsAuth)).json).toMatchObject({ valid: true });
  });

  it('two orders are two separate custody files — one object per order, no bleed', async () => {
    const a = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    const b = await call('GET', `/ops/ledger?orderId=ord-custody-refused`, opsAuth);
    expect(a.json['packageId']).toBe(CHAIN.packageId);
    expect(b.json['packageId']).toBe('pkg-r');
    expect(a.json['entries']).not.toEqual(b.json['entries']);
  });
});
