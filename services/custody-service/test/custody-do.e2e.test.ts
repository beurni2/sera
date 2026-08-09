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
  // pickup-verification-policy.v2 (founder ruling 2026-08-09): three
  // photo-referenced questions replace v1's nine fields.
  produit_conforme: true, quantite_complete: true, emballage_intact: true,
};

const persist = mkdtempSync(join(tmpdir(), 'custody-do-'));
const persistB = mkdtempSync(join(tmpdir(), 'custody-do-b-'));

function boot(
  dir: string,
  extra: Record<string, string> = {},
  services?: Record<string, (request: Request) => Promise<Response>>,
): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    // ⚠ THE FLAG THE CUSTODY CORE CANNOT RUN WITHOUT — the ledger and the
    // secret registry hash with node's synchronous createHash. Without this
    // the module does not even resolve (measured); with it they run unchanged.
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS, ...extra },
    ...(services !== undefined ? { serviceBindings: services } : {}),
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

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 5 (MINOR) — the OUTER door bounds the order id
 * too. It is placed into a request header on the way to the object, and header
 * grammar rejects CR/LF/NUL — so `new Request(...)` threw before any of the
 * object's own bounds could run, and the door answered a raw uncaught
 * TypeError 500 instead of the structured refusal it gives everywhere else.
 */
describe('the outer door refuses an order id it cannot carry', () => {
  for (const [label, bad] of [
    ['newline', 'ORD-a\nb'],
    ['carriage return', 'ORD-a\rb'],
    ['null byte', 'ORD-a\u0000b'],
  ] as const) {
    it(`a ${label} in the order id is a structured 400, never a crash`, async () => {
      const res = await call('POST', '/ops/secrets/arm', opsAuth, {
        orderId: bad, command_id: 'c-bad', kind: 'custody_seal', secret: 'X',
      });
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ ok: false, reason: 'order_id_not_usable' });
    });
  }

  it('an over-long order id is refused by the outer door as well', async () => {
    const res = await call('GET', `/ops/ledger?orderId=${'z'.repeat(300)}`, opsAuth);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ reason: 'order_id_not_usable' });
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
   *
   * ⚠ AND THE BURN MUST OUTLIVE THE PROCESS — this is the SE-LIVE-3 verifier's
   * own reproduction, kept as the pin for its BLOCKER. The first cut did not
   * log a command whose outcome was `invalid`, reasoning that nothing had been
   * recorded. But the consumption above happened BEFORE that outcome, so the
   * restart below rebuilt a registry that had forgotten it: a code the whole
   * system had written off as burned worked again, and anyone still holding
   * the string could put an `accepted` pickup verification on the chain.
   * Remove the `commit` before the `invalid` return in custody-do.ts and the
   * retry after this restart answers 200 instead of 409.
   */
  it('A CHECK OUTSIDE POLICY v1 is refused — riders verify objective conformity only (SE-I12) — and the code is spent by the attempt, ACROSS A RESTART', async () => {
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

    await restart(); // the runtime dies; the registry can only come back by replay

    // …but the code was SPENT by the presentation, and it STAYS spent: a
    // well-formed retry with the same code is refused on a freshly replayed
    // spine. This is the trap named above, and the pin for the blocker.
    const retry = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-outside-retry', riderId: 'rider-1',
      presentedPickupCode: code, checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-o', at: T,
    });
    expect(retry.status).toBe(409);
    expect(retry.json).toMatchObject({ reason: 'pickup_code_refused', detail: 'secret_already_used' });
    // And the refused retry recorded nothing either — a burned code cannot
    // write a custody fact by being presented again.
    expect((await call('GET', `/ops/ledger?orderId=${order}`, opsAuth)).json['entries']).toEqual([]);
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
    // The redelivery is the ORIGINAL answer verbatim, plus the duplicate mark —
    // same kind, same ledgerSeq, same chainValid, so one reader handles both.
    expect(again.json).toMatchObject({ ok: true, kind: 'accepted', ledgerSeq: 0, chainValid: true, duplicate: true });
    const ledger = await call('GET', `/ops/ledger?orderId=${ORDER}`, opsAuth);
    expect(ledger.json['entries']).toHaveLength(1);
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 1 (MAJOR) — AN ID IS NOT A COMMAND.
 * Idempotency first matched on `command_id` alone, so ANY command reusing an
 * id was answered « duplicate ». Two lies came out of that: arming a second
 * secret under a used id replied 200 while the first secret stayed armed
 * (the caller believes their new code works; it does not), and a
 * VERIFICATION reusing an arm's id replied « already on record » with an
 * EMPTY ledger (the caller believes custody was verified; nothing happened).
 * Custody is where a false belief costs someone their goods.
 */
describe('a reused command id is a CONFLICT, never a silent duplicate', () => {
  const order = 'ord-custody-idem';
  const code = 'PICKUP-IDEM-0004';

  it('opens and arms', async () => {
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-i', packageId: 'pkg-i', correlationId: 'corr-i', supplierId: 'sup-i',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'cmd-arm-i', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);
  });

  it('the SAME arm replayed is a duplicate — content matches', async () => {
    const again = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'cmd-arm-i', kind: 'pickup_verification_code', secret: code,
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, status: 'armed', duplicate: true });
  });

  it('a DIFFERENT secret under that id REFUSES — the caller is never told a code is armed when it is not', async () => {
    const collide = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'cmd-arm-i', kind: 'pickup_verification_code', secret: 'A-DIFFERENT-CODE',
    });
    expect(collide.status).toBe(409);
    expect(collide.json).toMatchObject({ reason: 'command_id_reused_with_other_content' });
  });

  it('a VERIFICATION under an ARM\'s id REFUSES — it can never answer « already on record » for an act that never happened', async () => {
    const crossKind = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-arm-i', riderId: 'rider-i',
      presentedPickupCode: code, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-i', at: T,
    });
    expect(crossKind.status).toBe(409);
    expect(crossKind.json).toMatchObject({ reason: 'command_id_reused_with_other_content' });
    // …and the refusal is honest: no ledger entry was created by it.
    expect((await call('GET', `/ops/ledger?orderId=${order}`, opsAuth)).json['entries']).toEqual([]);
  });

  it('the ORIGINAL arm survived both collisions — the first code, and only the first code, verifies', async () => {
    const wrong = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-i-wrong', riderId: 'rider-i',
      presentedPickupCode: 'A-DIFFERENT-CODE', checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-i', at: T,
    });
    expect(wrong.status).toBe(409);
    expect(wrong.json).toMatchObject({ reason: 'pickup_code_refused' });

    const ok = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-i', riderId: 'rider-i',
      presentedPickupCode: code, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-i', at: T,
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ kind: 'accepted' });
  });

  it('and the duplicate rule holds ACROSS A RESTART — replayed from the log, not from a warm map — even when the retry carries a LATER instant', async () => {
    const before = await call('GET', `/ops/ledger?orderId=${order}`, opsAuth);
    await restart();
    const again = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'cmd-verify-i', riderId: 'rider-i',
      presentedPickupCode: code, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-i',
      // A redelivery arrives LATER than the act it repeats. The instant is
      // not part of what the caller asked for, so this is still one act.
      at: '2026-08-07T11:30:00.000Z',
    });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, kind: 'accepted', duplicate: true });
    // One act, one entry, and the recorded instant is the FIRST one — a
    // redelivery does not re-date a custody fact.
    const after = await call('GET', `/ops/ledger?orderId=${order}`, opsAuth);
    expect(after.json['entries']).toHaveLength(1);
    expect(after.json['entries']).toEqual(before.json['entries']);
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 1 (MAJOR) — THE OBJECT IS TOLD ITS OWN NAME.
 * The router picks the order from the query OR the body, so a request whose
 * query said one order and whose body said another opened a custody file
 * under the QUERY's name carrying the BODY's chain: a real ledger, correctly
 * hash-chained, filed at an address nobody would ever look up again.
 */
describe('a custody file cannot be opened under a name that is not its chain', () => {
  it('refuses when the routed name and the chain disagree — and creates nothing', async () => {
    const res = await call('POST', '/ops/order/open?orderId=ord-routed-here', opsAuth, {
      orderId: 'ord-chain-says-there', taskId: 'task-x', packageId: 'pkg-x',
      correlationId: 'corr-x', supplierId: 'sup-x',
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ reason: 'order_id_does_not_name_this_object' });

    // Neither name holds a custody file: the routed object never opened…
    const routed = await call('GET', '/ops/ledger?orderId=ord-routed-here', opsAuth);
    expect(routed.status).toBe(409);
    expect(routed.json).toMatchObject({ reason: 'order_not_open' });
    // …and the chain's own object was never touched either.
    const named = await call('GET', '/ops/ledger?orderId=ord-chain-says-there', opsAuth);
    expect(named.status).toBe(409);
    expect(named.json).toMatchObject({ reason: 'order_not_open' });
  });

  it('the same open through the name it claims is accepted', async () => {
    const res = await call('POST', '/ops/order/open?orderId=ord-chain-says-there', opsAuth, {
      orderId: 'ord-chain-says-there', taskId: 'task-x', packageId: 'pkg-x',
      correlationId: 'corr-x', supplierId: 'sup-x',
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, status: 'open' });
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 2 (MAJOR) — A REDELIVERY MUST REPEAT THE ANSWER
 * IT GOT, NOT INVENT A CHEERFUL ONE.
 *
 * Round 1 made every spine-reaching command durable (right) and made
 * idempotency content-based (right). Together they produced a lie: a command
 * that FAILED was now in the log, so its honest redelivery was answered
 * `200 {ok:true}`. The verifier drove three shapes of it, and all three are
 * pinned below. `command_id` exists precisely FOR at-least-once producers, so
 * the retry path is the one that must never mislead.
 */
describe('a redelivered command repeats its real answer — refusals included', () => {
  const order = 'ord-custody-honest';
  const code = 'PICKUP-HONEST-0005';

  it('opens and arms', async () => {
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-h', packageId: 'pkg-h', correlationId: 'corr-h', supplierId: 'sup-h',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-h', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);
  });

  it('A WRONG CODE stays refused on redelivery — a timed-out producer never concludes the pickup verified', async () => {
    const body = {
      orderId: order, command_id: 'v-wrong-h', riderId: 'rider-h',
      presentedPickupCode: 'NOT-THE-CODE', checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-h', at: T,
    };
    const first = await call('POST', '/ops/verification', opsAuth, body);
    expect(first.status).toBe(409);
    expect(first.json).toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused' });

    // THE PIN: the same command again — same status, same reason, and it says
    // plainly that it is a repeat. Before the fix this was 200 {ok:true}.
    const again = await call('POST', '/ops/verification', opsAuth, body);
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ kind: 'invalid', reason: 'pickup_code_refused', duplicate: true });
    expect((await call('GET', `/ops/ledger?orderId=${order}`, opsAuth)).json['entries']).toEqual([]);
  });

  it('A REFUSED RE-ARM stays refused — the caller is never told a spent code is armed', async () => {
    // Spend the code first.
    expect((await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-ok-h', riderId: 'rider-h', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-h', at: T,
    })).status).toBe(200);

    const rearm = {
      orderId: order, command_id: 'rearm-h', kind: 'pickup_verification_code', secret: 'A-BRAND-NEW-CODE',
    };
    const first = await call('POST', '/ops/secrets/arm', opsAuth, rearm);
    expect(first.status).toBe(409);
    expect(first.json).toMatchObject({ reason: 'secret_already_used' });

    const again = await call('POST', '/ops/secrets/arm', opsAuth, rearm);
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ reason: 'secret_already_used', duplicate: true });

    // …and the code that 200 would have implied was armed still does not work.
    const use = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-newcode-h', riderId: 'rider-h', presentedPickupCode: 'A-BRAND-NEW-CODE',
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-h', at: T,
    });
    expect(use.status).toBe(409);
  });

  it('ACCEPTED and REFUSED are still TELLABLE APART on redelivery — a refusal a retry cannot read back is not first-class', async () => {
    const accepted = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-ok-h', riderId: 'rider-h', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-h', at: T,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json).toMatchObject({ duplicate: true, kind: 'accepted', ledgerSeq: 0, chainValid: true });

    // A refusal on its own order, then its redelivery.
    const other = 'ord-custody-honest-refused';
    const otherCode = 'PICKUP-HONEST-0006';
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: other, taskId: 'task-h2', packageId: 'pkg-h2', correlationId: 'corr-h2', supplierId: 'sup-h2',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: other, command_id: 'arm-h2', kind: 'pickup_verification_code', secret: otherCode,
    })).status).toBe(200);
    const refusedBody = {
      orderId: other, command_id: 'v-refused-h2', riderId: 'rider-h2', presentedPickupCode: otherCode,
      checkResults: { ...ALL_PASS, emballage_intact: false }, dwellSec: 200, evidenceBundleId: 'ev-h2', at: T,
    };
    expect((await call('POST', '/ops/verification', opsAuth, refusedBody)).json).toMatchObject({ kind: 'refused' });
    const refusedAgain = await call('POST', '/ops/verification', opsAuth, refusedBody);
    expect(refusedAgain.status).toBe(200);
    // ⚠ ROUND 3: this used to replay `repeated: "verified"` for a REFUSED
    // pickup — a load-bearing word under SE-I05. The answer is now the
    // original one, verbatim.
    expect(refusedAgain.json).toMatchObject({ duplicate: true, kind: 'refused' });
    expect(JSON.stringify(refusedAgain.json)).not.toContain('verified');
    // The two 200s do NOT say the same thing — which is the whole point.
    expect(refusedAgain.json['kind']).not.toBe(accepted.json['kind']);
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 2 (MAJOR) — the name guard was scoped to the one
 * route round 1's reproduction happened to use. `/secrets/arm` and
 * `/verification` ignore `body.orderId` and act on this object's own chain, so
 * a query/body disagreement armed a live secret on the WRONG order and
 * answered `200 armed`.
 */
/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 3 (MINOR) — the replay used to SUMMARISE the
 * answer instead of repeating it, and the summary was wrong in three ways: a
 * REFUSED pickup replayed as `repeated: "verified"` (a load-bearing word under
 * SE-I05), the accepted path silently dropped `chainValid`, and only the
 * refusal path carried a `duplicate` marker — so a consumer written as
 * `if (res.duplicate)` read an accepted duplicate as a first-time answer.
 */
describe('a duplicate is the ORIGINAL answer, verbatim, plus one honest marker', () => {
  const order = 'ord-verbatim';
  const code = 'PICKUP-VERBATIM-0009';

  it('an accepted verification replays byte-for-byte, with duplicate: true added and nothing removed', async () => {
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-v', packageId: 'pkg-v', correlationId: 'corr-v', supplierId: 'sup-v',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-v', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);

    const body = {
      orderId: order, command_id: 'v-v', riderId: 'rider-v', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-v', at: T,
    };
    const first = await call('POST', '/ops/verification', opsAuth, body);
    const again = await call('POST', '/ops/verification', opsAuth, body);

    expect(again.status).toBe(first.status);
    // Identical, field for field — the ONLY difference is the marker.
    expect(again.json).toEqual({ ...first.json, duplicate: true });
    // And the marker is on the SUCCESS path too, so one reader handles both.
    expect(again.json['duplicate']).toBe(true);
    expect(again.json['chainValid']).toBe(true);
  });

  it('a duplicate ARM says so when a later arm has since replaced the code', async () => {
    // First arm, then a second arm of the same kind replaces it (pre-existing
    // registry behaviour, disclosed in JOURNAL.md).
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-first', kind: 'buyer_drop_code', secret: 'DROP-AAA',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-second', kind: 'buyer_drop_code', secret: 'DROP-BBB',
    })).status).toBe(200);

    // Redelivering the FIRST arm is still answered faithfully — it did happen —
    // but the caller is told it no longer describes a working code, instead of
    // finding out from a rider standing at a door.
    const replayFirst = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-first', kind: 'buyer_drop_code', secret: 'DROP-AAA',
    });
    expect(replayFirst.status).toBe(200);
    expect(replayFirst.json).toMatchObject({ ok: true, status: 'armed', duplicate: true, superseded: true });

    // Re-arming the SAME value replaces nothing, so it raises no false alarm.
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-same-value', kind: 'buyer_drop_code', secret: 'DROP-BBB',
    })).status).toBe(200);
    const replaySecondAgain = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-second', kind: 'buyer_drop_code', secret: 'DROP-BBB',
    });
    expect(replaySecondAgain.json['superseded']).toBeUndefined();

    // The LATEST arm replays without the flag — it is still the live one.
    const replaySecond = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-second', kind: 'buyer_drop_code', secret: 'DROP-BBB',
    });
    expect(replaySecond.json).toMatchObject({ ok: true, status: 'armed', duplicate: true });
    expect(replaySecond.json['superseded']).toBeUndefined();
  });
});

describe('every route refuses a body that names another order', () => {
  it('an arm routed to A with a body naming B is refused, and neither order is touched', async () => {
    const a = 'ord-name-a';
    const b = 'ord-name-b';
    for (const id of [a, b]) {
      expect((await call('POST', '/ops/order/open', opsAuth, {
        orderId: id, taskId: `task-${id}`, packageId: `pkg-${id}`, correlationId: `corr-${id}`, supplierId: 'sup-n',
      })).status).toBe(200);
    }

    const crossed = await call('POST', `/ops/secrets/arm?orderId=${a}`, opsAuth, {
      orderId: b, command_id: 'arm-crossed', kind: 'pickup_verification_code', secret: 'CROSSED-CODE',
    });
    expect(crossed.status).toBe(400);
    expect(crossed.json).toMatchObject({ reason: 'order_id_does_not_name_this_object' });

    // The secret landed on NEITHER order — it is unknown to both.
    for (const id of [a, b]) {
      const use = await call('POST', '/ops/verification', opsAuth, {
        orderId: id, command_id: `v-${id}`, riderId: 'rider-n', presentedPickupCode: 'CROSSED-CODE',
        checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-n', at: T,
      });
      expect(use.status).toBe(409);
      expect(use.json).toMatchObject({ reason: 'pickup_code_refused', detail: 'secret_unknown' });
    }
  });

  it('a verification routed to A with a body naming B is refused too', async () => {
    const crossed = await call('POST', '/ops/verification?orderId=ord-name-a', opsAuth, {
      orderId: 'ord-name-b', command_id: 'v-crossed', riderId: 'rider-n',
      presentedPickupCode: 'X', checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-n', at: T,
    });
    expect(crossed.status).toBe(400);
    expect(crossed.json).toMatchObject({ reason: 'order_id_does_not_name_this_object' });
  });
});

describe('the instant and the check list are validated, not merely parsed', () => {
  it('an instant that is not strict ISO-8601 UTC is refused — a custody fact is no place for a loose parse', async () => {
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'v-badtime', riderId: 'rider-1',
      presentedPickupCode: PICKUP_CODE, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: 'Aug 7 2026',
    });
    expect(res.status).toBe(400);
  });

  it('a date the calendar does not have is refused — Date.parse rolls Feb 30 to Mar 2, and that must not reach the chain', async () => {
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: ORDER, command_id: 'v-feb30', riderId: 'rider-1',
      presentedPickupCode: PICKUP_CODE, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-1', at: '2026-02-30T09:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });

  it('a well-formed instant WITHOUT milliseconds is still accepted — the check is strict, not brittle', async () => {
    const order = 'ord-noms';
    const code = 'PICKUP-NOMS-0010';
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-n', packageId: 'pkg-n', correlationId: 'corr-n', supplierId: 'sup-n2',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-n', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-n', riderId: 'rider-n', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-n', at: '2026-08-07T09:00:00Z',
    });
    expect(res.status).toBe(200);
  });

  it('a check named __proto__ is REFUSED as out-of-policy, not silently swallowed (SE-I12)', async () => {
    const order = 'ord-proto';
    const code = 'PICKUP-PROTO-0007';
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-p', packageId: 'pkg-p', correlationId: 'corr-p', supplierId: 'sup-p',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-p', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);

    // NB: `{ __proto__: true }` in a literal sets the PROTOTYPE and creates no
    // own key, so it would never reach the wire. Define it as a real own
    // enumerable property, which is what `JSON.parse` produces on the server.
    const checks: Record<string, boolean> = { ...ALL_PASS };
    Object.defineProperty(checks, '__proto__', { value: true, enumerable: true, configurable: true, writable: true });
    expect(JSON.stringify(checks)).toContain('__proto__');

    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-proto', riderId: 'rider-p', presentedPickupCode: code,
      checkResults: checks, dwellSec: 150, evidenceBundleId: 'ev-p', at: T,
    });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ kind: 'invalid', reason: 'check_not_in_policy', detail: '__proto__' });
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 4 (BLOCKER) — A COMMAND REACHED THE SPINE AND WAS
 * NEVER LOGGED. Fields were checked for « non-empty string » and nothing else,
 * so a 3 MiB `riderId` built a command row past the Durable Object's 2 MiB
 * PER-VALUE limit. `verifyPickup` consumes the single-use code BEFORE judging
 * anything, so by the time `commit`'s put threw, the code was spent — and the
 * 500 discarded that with the in-memory state. The verifier then presented the
 * SAME code again and it was ACCEPTED: DoD 6 (« the four-secrets law holds
 * across restarts ») was false, and an accepted verification the spine had
 * actually performed evaporated.
 */
describe('an identifier has a length, and nothing reaches the spine that cannot be committed', () => {
  const order = 'ord-bounded';
  const code = 'PICKUP-BOUNDED-0011';

  it('opens and arms', async () => {
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-b', packageId: 'pkg-b', correlationId: 'corr-b', supplierId: 'sup-b',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-b', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);
  });

  it('an oversized riderId is REFUSED at the door — 400, not a 500 that silently un-burns the code', async () => {
    const huge = 'r'.repeat(3 * 1024 * 1024);
    const res = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-huge', riderId: huge, presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-b', at: T,
    });
    expect(res.status).toBe(400);

    // THE PIN: the code was never presented to the spine, so it is untouched —
    // and it still works exactly once, the way the four-secrets law requires.
    const ok = await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-after-huge', riderId: 'rider-b', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-b', at: T,
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ kind: 'accepted' });
  });

  it('every identifier is bounded, and an over-long one is refused before any state moves', async () => {
    const long = 'x'.repeat(300);
    const huge = 'y'.repeat(5000);
    // command_id, evidenceBundleId, and the ids on /order/open
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: long, kind: 'custody_seal', secret: 'S',
    })).status).toBe(400);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-huge-secret', kind: 'custody_seal', secret: huge,
    })).status).toBe(400);
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: 'ord-long-ids', taskId: long, packageId: 'p', correlationId: 'c', supplierId: 's',
    })).status).toBe(400);
    // a check NAME is an identifier too, and the list is bounded
    const many: Record<string, boolean> = {};
    for (let i = 0; i < 100; i += 1) many[`check_${i}`] = true;
    expect((await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-many', riderId: 'r', presentedPickupCode: code,
      checkResults: many, dwellSec: 1, evidenceBundleId: 'e', at: T,
    })).status).toBe(400);
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 4 (MINOR) — « SPENT » IS DEADER THAN
 * « SUPERSEDED ». The staleness marker only noticed a LATER ARM, so a
 * redelivered arm of a code that had already been USED still replayed a bare
 * « armed » — the exact false comfort the marker exists to prevent, in the
 * commoner case.
 */
describe('a duplicate arm says when the code has been spent, not only when it was replaced', () => {
  const order = 'ord-spent';
  const code = 'PICKUP-SPENT-0012';

  it('marks a consumed pickup code as spent on redelivery', async () => {
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-s', packageId: 'pkg-s', correlationId: 'corr-s', supplierId: 'sup-s2',
    })).status).toBe(200);
    const arm = { orderId: order, command_id: 'arm-s', kind: 'pickup_verification_code', secret: code };
    expect((await call('POST', '/ops/secrets/arm', opsAuth, arm)).status).toBe(200);

    // Before it is used, a redelivery is simply a faithful duplicate.
    const beforeUse = await call('POST', '/ops/secrets/arm', opsAuth, arm);
    expect(beforeUse.json).toMatchObject({ ok: true, status: 'armed', duplicate: true });
    expect(beforeUse.json['spent']).toBeUndefined();

    expect((await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-s', riderId: 'rider-s', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-s', at: T,
    })).status).toBe(200);

    // After it is used, the same redelivery says so.
    const afterUse = await call('POST', '/ops/secrets/arm', opsAuth, arm);
    expect(afterUse.status).toBe(200);
    expect(afterUse.json).toMatchObject({ ok: true, status: 'armed', duplicate: true, spent: true });
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 5 (MINOR) — the attestation this slice ships must
 * be READABLE. Round 3 chained the command log specifically to protect WHO
 * verified, and under the founder's ruling `riderId` is the only attestation
 * this slice ships — but no route returned it. Protected and unreadable is not
 * shipped.
 */
describe('the founder-attested rider identity can be read back', () => {
  const order = 'ord-attest';
  const code = 'PICKUP-ATTEST-0013';

  it('records and returns the rider, the evidence bundle and the dwell — labelled for what it is', async () => {
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-at', packageId: 'pkg-at', correlationId: 'corr-at', supplierId: 'sup-at',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-at', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);
    expect((await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-at', riderId: 'RIDER-XYZ-ATTESTED', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 137, evidenceBundleId: 'ev-REAL-PHOTOS-01', at: T,
    })).status).toBe(200);

    await restart(); // it comes back from the log like everything else

    const res = await call('GET', `/ops/attestations?orderId=${order}`, opsAuth);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true });
    /**
     * ⚠ THE LABEL MOVED FROM THE RESPONSE TO THE ACT (4b round-1 blocker A2).
     * This used to assert a blanket `attribution: 'founder_attested'` on the
     * response, which was true only while the ops key was the only door. The
     * rider door made it a lie for rider-authenticated rows while the field
     * kept claiming otherwise, so the blanket is gone and each act carries
     * its own. Asserted per-row here — a strictly stronger claim, since it
     * now says WHICH act was the founder's word.
     */
    expect(res.json['attribution']).toBeUndefined();
    const rows = res.json['attestations'] as Json[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      command_id: 'v-at',
      riderId: 'RIDER-XYZ-ATTESTED',
      attribution: 'founder_attested',
      evidenceBundleId: 'ev-REAL-PHOTOS-01',
      dwellSec: 137,
      outcome: 'accepted',
      recorded: true,
    });
    // And it still leaks no secret.
    expect(JSON.stringify(res.json)).not.toContain(code);
  });

  /**
   * ⚠ ROUND 6 (MAJOR) — WHICH ATTEMPT BURNED THE CODE. Three refusals that
   * differ in the only way that matters were rendered identically: a wrong
   * code burns nothing, an OUT-OF-POLICY check list BURNS the single-use code
   * (verifyPickup consumes before it judges), and a presentation after the
   * spend burns nothing. An `invalid` verification never reaches the ledger,
   * so this route is the only place that fact can be read at all.
   */
  it('tells apart the refusal that SPENT the code from the two that did not', async () => {
    const order = 'ord-attest-burn';
    const code = 'PICKUP-BURN-0014';
    expect((await call('POST', '/ops/order/open', opsAuth, {
      orderId: order, taskId: 'task-ab', packageId: 'pkg-ab', correlationId: 'corr-ab', supplierId: 'sup-ab',
    })).status).toBe(200);
    expect((await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-ab', kind: 'pickup_verification_code', secret: code,
    })).status).toBe(200);

    // 1. wrong code — burns nothing
    await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-wrong', riderId: 'R-WRONG', presentedPickupCode: 'NOPE',
      checkResults: ALL_PASS, dwellSec: 100, evidenceBundleId: 'ev', at: T,
    });
    // 2. out-of-policy — SPENDS the code
    const oop: Record<string, boolean> = { ...ALL_PASS, authenticity: true };
    await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-oop', riderId: 'R-OOP', presentedPickupCode: code,
      checkResults: oop, dwellSec: 100, evidenceBundleId: 'ev', at: T,
    });
    // 3. after the spend — burns nothing
    await call('POST', '/ops/verification', opsAuth, {
      orderId: order, command_id: 'v-late', riderId: 'R-LATE', presentedPickupCode: code,
      checkResults: ALL_PASS, dwellSec: 100, evidenceBundleId: 'ev', at: T,
    });

    const rows = (await call('GET', `/ops/attestations?orderId=${order}`, opsAuth)).json['attestations'] as Json[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ riderId: 'R-WRONG', reason: 'pickup_code_refused', detail: 'secret_mismatch' });
    // THE ONE THAT SPENT IT, and it is distinguishable from the other two.
    expect(rows[1]).toMatchObject({ riderId: 'R-OOP', reason: 'check_not_in_policy', detail: 'authenticity' });
    expect(rows[2]).toMatchObject({ riderId: 'R-LATE', reason: 'pickup_code_refused', detail: 'secret_already_used' });
    expect(rows[1]?.['reason']).not.toBe(rows[0]?.['reason']);

    // Corroborated independently: the code really is spent.
    const rearm = await call('POST', '/ops/secrets/arm', opsAuth, {
      orderId: order, command_id: 'arm-ab', kind: 'pickup_verification_code', secret: code,
    });
    expect(rearm.json).toMatchObject({ duplicate: true, spent: true });
  });
});

describe('two orders that share a secret STRING are still two separate custody files', () => {
  it('spending it on one leaves the other fully usable — across a restart', async () => {
    const shared = 'SHARED-SECRET-STRING-0008';
    for (const id of ['ord-share-a', 'ord-share-b']) {
      expect((await call('POST', '/ops/order/open', opsAuth, {
        orderId: id, taskId: `task-${id}`, packageId: `pkg-${id}`, correlationId: `corr-${id}`, supplierId: 'sup-s',
      })).status).toBe(200);
      expect((await call('POST', '/ops/secrets/arm', opsAuth, {
        orderId: id, command_id: `arm-${id}`, kind: 'pickup_verification_code', secret: shared,
      })).status).toBe(200);
    }

    // Spend it on A only.
    expect((await call('POST', '/ops/verification', opsAuth, {
      orderId: 'ord-share-a', command_id: 'v-share-a', riderId: 'rider-s', presentedPickupCode: shared,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-s', at: T,
    })).status).toBe(200);

    await restart();

    // A is spent…
    const reuseA = await call('POST', '/ops/verification', opsAuth, {
      orderId: 'ord-share-a', command_id: 'v-share-a2', riderId: 'rider-s', presentedPickupCode: shared,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-s', at: T,
    });
    expect(reuseA.status).toBe(409);
    expect(reuseA.json).toMatchObject({ detail: 'secret_already_used' });

    // …and B is untouched. A shared registry would have burned this too.
    const useB = await call('POST', '/ops/verification', opsAuth, {
      orderId: 'ord-share-b', command_id: 'v-share-b', riderId: 'rider-s', presentedPickupCode: shared,
      checkResults: ALL_PASS, dwellSec: 150, evidenceBundleId: 'ev-s', at: T,
    });
    expect(useB.status).toBe(200);
    expect(useB.json).toMatchObject({ kind: 'accepted' });
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
      checkResults: { ...ALL_PASS, emballage_intact: false }, // the package arrived damaged
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

/**
 * ═══ SE-LIVE-5a — THE DELIVERY ACTS, AND THE SIGNAL CROSSES TO SHOP+ ═══
 *
 * SE-I05: « Delivery requires assigned session + `buyerDropCode` + same
 * custody seal + evidence » · §63: « buyer enters `buyerDropCode` LAST »,
 * « evidence supports, never releases » · SE-I09: the signal carries an
 * IDENTITY (supplier_ref), never an amount.
 *
 * The receiver below is a CONTRACT-CERTIFIED stand-in for Shop+'s
 * `/fulfillment/progress` door, certified against the REAL door's proven
 * behavior (shop-plus `sandbox-payment-confirm.e2e.test.ts`, SE-LIVE-5b
 * describe): Bearer PROGRESS_WRITE_SECRET or a uniform 401; a canonical
 * `delivery.validated.v1` answers `200 {ok, status:'recorded'}`. Any drift
 * in the real door must be mirrored here BY HAND, eyes open.
 */
describe('SE-LIVE-5a — evidence → decision → drop code LAST → the signal is DELIVERED', () => {
  const D_ORDER = 'ord-custody-livraison';
  const D_CHAIN = {
    orderId: D_ORDER, taskId: 'task-liv', packageId: 'pkg-liv',
    correlationId: `corr-${D_ORDER}`, supplierId: 'supplier-liv-1',
  };
  const PICKUP2 = 'PICKUP-LIV-0001';
  const SEAL = 'SEAL-LIV-0001';
  const DROP = 'DROP-LIV-9042';
  const SHOP_SECRET = 'test-progress-write-secret-sp001';
  const bundle = {
    taskId: 'task-liv', packageId: 'pkg-liv', custodySealId: SEAL,
    artifacts: [{ ref: 'photo-liv-1', sha256: 'a'.repeat(64), mimeType: 'image/jpeg' }],
    capturedAt: T,
  };
  const received: { auth: string | null; body: Json }[] = [];

  it('walks the whole road on the REAL Worker; every refusal is BY NAME; the eligibility event reaches the certified door with the supplier on it', async () => {
    // The receiver is a SERVICE BINDING now, exactly as the deployed wrangler
    // binds Shop+'s Worker (the SUPPLY_BASE / error-1042 lesson: never a
    // public-URL Worker-to-Worker fetch). Same certified clauses as before —
    // gate first, uniform 401, canonical 200 {ok, status:'recorded'}.
    await mf.dispose();
    mf = boot(persist, { SHOP_PROGRESS_SECRET: SHOP_SECRET }, {
      SHOP_PROGRESS: async (request: Request) => {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${SHOP_SECRET}`) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as Json;
        received.push({ auth, body });
        return Response.json({ ok: true, status: 'recorded' });
      },
    });

    // ── the custody file, armed and in courier custody ─────────────────────
    expect((await call('POST', '/ops/order/open', opsAuth, D_CHAIN)).status).toBe(200);
    for (const [kind, secret, cid] of [
      ['pickup_verification_code', PICKUP2, 'cmd-liv-arm-p'],
      ['custody_seal', SEAL, 'cmd-liv-arm-s'],
      ['buyer_drop_code', DROP, 'cmd-liv-arm-d'],
    ] as const) {
      const armed = await call('POST', '/ops/secrets/arm', opsAuth, {
        orderId: D_ORDER, command_id: cid, kind, secret,
      });
      expect(armed.status, kind).toBe(200);
    }
    expect((await call('POST', '/ops/verification', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-verify', riderId: 'rider-liv',
      presentedPickupCode: PICKUP2, checkResults: ALL_PASS, dwellSec: 150,
      evidenceBundleId: 'ev-liv', at: T,
    })).status).toBe(200);
    expect((await call('POST', '/ops/custody/begin', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-begin', riderId: 'rider-liv',
      custodySealId: SEAL, sealPhotoRefs: ['seal-photo-liv-1'], at: T,
    })).status).toBe(200);

    // ── ORDER OF OPERATIONS, refused by name at every early door ───────────
    const earlyDrop = await call('POST', '/ops/delivery/drop', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-drop-early', dropCode: DROP, at: T,
    });
    expect(earlyDrop.status).toBe(409);
    expect(earlyDrop.json).toMatchObject({ reason: 'not_validated' });
    const earlyDecide = await call('POST', '/ops/delivery/decide', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-decide-early', at: T,
    });
    expect(earlyDecide.status).toBe(409);
    expect(earlyDecide.json).toMatchObject({ reason: 'validation_before_evidence' });

    // ── evidence (bound to chain + seal), once ─────────────────────────────
    const ev = await call('POST', '/ops/delivery/evidence', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-evidence', bundle, at: T,
    });
    expect(ev.status).toBe(200);
    expect(ev.json).toMatchObject({ ok: true, status: 'evidence_recorded' });
    const evAgain = await call('POST', '/ops/delivery/evidence', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-evidence-2', bundle, at: T,
    });
    expect(evAgain.status).toBe(409);
    expect(evAgain.json).toMatchObject({ reason: 'evidence_already_submitted' });

    // ── the decision is POLICY FROM EVIDENCE ───────────────────────────────
    const decide = await call('POST', '/ops/delivery/decide', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-decide', at: T,
    });
    expect(decide.status).toBe(200);
    expect(decide.json).toMatchObject({ ok: true, result: 'validated' });

    // ── the drop code, LAST — wrong refused (and not burned), right transfers
    const wrongDrop = await call('POST', '/ops/delivery/drop', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-drop-wrong', dropCode: 'NOT-THE-CODE', at: T,
    });
    expect(wrongDrop.status).toBe(409);
    expect(wrongDrop.json).toMatchObject({ reason: 'drop_code_refused' });
    const drop = await call('POST', '/ops/delivery/drop', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-drop', dropCode: DROP, at: T,
    });
    expect(drop.status).toBe(200);
    expect(drop.json).toMatchObject({ ok: true, status: 'custody_with_customer' });

    // ── exactly once: the same command replays; a NEW drop says déjà ───────
    const replay = await call('POST', '/ops/delivery/drop', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-drop', dropCode: DROP, at: T,
    });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ status: 'custody_with_customer' });
    const second = await call('POST', '/ops/delivery/drop', opsAuth, {
      orderId: D_ORDER, command_id: 'cmd-liv-drop-again', dropCode: DROP, at: T,
    });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ status: 'deja_livree' });

    // ── ASK THE LEDGER, not the response: custody is the customer's ────────
    const ledger = await call('GET', `/ops/ledger?orderId=${D_ORDER}`, opsAuth);
    const entries = ledger.json['entries'] as { kind: string; payload: Json }[];
    const transfer = entries.filter((e) => e.kind === 'custody_transition').at(-1)!;
    expect(transfer.payload['to']).toBe('customer');
    const verify = await call('GET', `/ops/ledger/verify?orderId=${D_ORDER}`, opsAuth);
    expect(verify.json).toMatchObject({ headMatches: true });

    // ── THE WIRE: the alarm delivers the ONE eligibility event ─────────────
    for (let i = 0; i < 80 && received.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(received.length, 'the eligibility signal must reach the Shop+ door').toBeGreaterThanOrEqual(1);
    const wire = received[0]!;
    expect(wire.auth).toBe(`Bearer ${SHOP_SECRET}`);
    expect(wire.body['name']).toBe('delivery.validated.v1');
    const payload = wire.body['payload'] as Json;
    expect(payload['order_id']).toBe(D_ORDER);
    expect(payload['result']).toBe('validated');
    expect(payload['settlement_eligibility']).toBe(true);
    // SE-I09 held: an IDENTITY rides the signal, never an amount…
    expect(payload['supplier_ref']).toBe('supplier-liv-1');
    expect(JSON.stringify(wire.body)).not.toMatch(/amount|fcfa|net|fee/i);
    // …and the correlation is the ORDER'S OWN, which Shop+'s vault checks.
    const envelope = wire.body['envelope'] as Json;
    expect(envelope['correlation_id']).toBe(`corr-${D_ORDER}`);
  }, 60_000);
});
