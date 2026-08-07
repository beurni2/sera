import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ SE-LIVE-4b — CUSTODY ACTUALLY MOVES, AND ONLY WHEN IT MAY ═══
 *
 * SE-I05 (Sera-Build-Spec.md:37): « Custody begins only after rider pickup
 * verification (objective conformity) AND custody-seal registration. »
 * SE4.3 (Sera-Building-Plan.md:61): « Rider applies/witnesses custody seal →
 * registers custodySealId + photos → custody begins. »
 * SE-I04 (Sera-Build-Spec.md:36): « Every package has exactly one current
 * custodian; task status alone MUST NOT be custody truth. »
 *
 * ⚠ AND THE LAW THIS SLICE EXISTS TO ADD — « no claim, no custody ». SE-LIVE-4a
 * made the package claim a precondition of OPENING a file; it could not make it
 * a precondition of TRANSITIONING custody, because nothing transitioned custody
 * yet. That left a real window, disclosed in JOURNAL.md: a file opened before
 * 4a holds no claim until someone re-opens it, and meanwhile a NEW order can
 * win its package — two files over one package. Harmless only while neither can
 * take custody. This suite is what makes that permanent instead of lucky.
 */

const OPS = 'test-custody-ops-secret-4b';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const SCRIPT = 'dist-worker/worker.mjs';

const ORDER = 'ord-4b-0001';
const PKG = 'pkg-4b-0001';
const SUPPLIER = 'sup-4b-0001';
const RIDER = 'rider-4b-0001';
const PICKUP_CODE = 'PICKUP-4B-0001';
const SEAL_CODE = 'SEAL-4B-0001';
const T = '2026-08-07T09:00:00.000Z';

/** The policy's nine checks, all passing — the accepted pickup path. */
const ALL_PASS = {
  order_ref: true, identity: true, variant: true, colour: true, size_label: true,
  qty: true, damage: true, pieces: true, manufacturer_seal: true,
};

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-4b-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function boot(dir: string): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
  });
}

type Json = Record<string, unknown>;

/** Drained on arrival — the round-4 lesson: a Response that outlives its call
 *  site gets read twice under load and fails honest code. */
async function hit(mf: Miniflare, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method, headers: opsAuth,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = { __raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

/** Open → arm the pickup code → arm the seal. The state every test starts from. */
async function armedOrder(mf: Miniflare, orderId = ORDER, packageId = PKG): Promise<void> {
  expect((await hit(mf, 'POST', '/ops/order/open', {
    orderId, taskId: `task-${orderId}`, packageId,
    correlationId: `corr-${orderId}`, supplierId: SUPPLIER,
  })).status).toBe(200);
  for (const [kind, secret] of [
    ['pickup_verification_code', PICKUP_CODE],
    ['custody_seal', SEAL_CODE],
  ] as const) {
    expect((await hit(mf, 'POST', '/ops/secrets/arm', {
      orderId, command_id: `arm-${kind}-${orderId}`, kind, secret,
    })).status).toBe(200);
  }
}

const verifyPickup = (mf: Miniflare, orderId = ORDER) =>
  hit(mf, 'POST', '/ops/verification', {
    orderId, command_id: `verify-${orderId}`, riderId: RIDER,
    presentedPickupCode: PICKUP_CODE, evidenceBundleId: `ev-${orderId}`,
    dwellSec: 150, checkResults: ALL_PASS, at: T,
  });

const beginCustody = (mf: Miniflare, orderId = ORDER, overrides: Json = {}) =>
  hit(mf, 'POST', '/ops/custody/begin', {
    orderId, command_id: `begin-${orderId}`, riderId: RIDER,
    custodySealId: SEAL_CODE, sealPhotoRefs: [`seal-photo-${orderId}.jpg`], at: T,
    ...overrides,
  });

function deleteRows(dir: string, match: (key: string) => boolean): number {
  let removed = 0;
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let isDir = false;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir) { walk(p); continue; }
      if (!p.endsWith('.sqlite') || p.includes('metadata')) continue;
      const db = new DatabaseSync(p);
      try {
        for (const row of db.prepare('select key from _cf_KV').all() as unknown as { key: Uint8Array }[]) {
          if (!match(Buffer.from(row.key).toString('latin1'))) continue;
          db.prepare('delete from _cf_KV where key = ?').run(row.key);
          removed += 1;
        }
      } finally { db.close(); }
    }
  };
  walk(dir);
  return removed;
}

describe('custody begins only after verification AND seal (SE-I05)', () => {
  it('moves the package to the courier, and says so in the ledger', async () => {
    const dir = freshDir('happy');
    const mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);

    const began = await beginCustody(mf);
    expect(began.status).toBe(200);
    expect(began.json).toMatchObject({ ok: true, status: 'custody_with_courier', riderId: RIDER });

    const led = await hit(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect(led.status).toBe(200);
    // ONE current custodian, and it is the rider (SE-I04).
    expect(led.json).toMatchObject({ packageId: PKG, currentCustodian: `courier:${RIDER}` });
    await mf.dispose();
  });

  it('refuses the seal before the pickup is verified — the spine decides the order, not the door', async () => {
    const dir = freshDir('order');
    const mf = boot(dir);
    await armedOrder(mf);

    // No verification yet.
    const early = await beginCustody(mf);
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({ ok: false, reason: 'verification_not_accepted' });

    /**
     * ⚠ WHAT « NOTHING MOVED » ACTUALLY MEANS HERE, and my first draft of this
     * test asserted the wrong thing. It expected NO custodian at all. The
     * ledger in fact records `seller:{supplierId}` — because the refused
     * command still established the seller's custody, so that the transition's
     * `from` is corroborated rather than asserted.
     *
     * That entry is TRUE: the supplier really does hold the package until the
     * rider takes it, and SE-I04 is satisfied by it (exactly one custodian).
     * The invariant this test defends is not « the ledger is empty » — it is
     * CUSTODY NEVER REACHED THE COURIER. Asserting my assumption instead of the
     * invariant would have been a test that fails honest code.
     */
    const led = await hit(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect(led.json).toMatchObject({ currentCustodian: `seller:${SUPPLIER}` });
    expect(String(led.json['currentCustodian'])).not.toContain('courier');
    await mf.dispose();
  });

  it('refuses a seal that was never armed, and a seal cannot be spent twice', async () => {
    const dir = freshDir('seal');
    const mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);

    const wrong = await beginCustody(mf, ORDER, { command_id: 'begin-wrong-seal', custodySealId: 'SEAL-NOT-THIS-ONE' });
    expect(wrong.status).toBe(409);
    expect(wrong.json).toMatchObject({ ok: false, reason: 'seal_missing_or_mismatched' });

    expect((await beginCustody(mf)).status).toBe(200);
    // The seal is single-use: a second, DIFFERENT command presenting it again
    // must not move custody a second time.
    const again = await beginCustody(mf, ORDER, { command_id: 'begin-second-time' });
    expect(again.status).toBe(409);
    expect(again.json['reason']).toMatch(/seal_already_used|custodian_conflict/);
    await mf.dispose();
  });

  it('a seal with no photo is refused — the seal moment is the proof moment', async () => {
    const dir = freshDir('nophoto');
    const mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);
    const bare = await beginCustody(mf, ORDER, { sealPhotoRefs: [] });
    expect(bare.status).toBe(400);
    expect(bare.json).toMatchObject({ reason: 'seal_photo_refs_out_of_bounds' });
    await mf.dispose();
  });

  it('the custodian survives a real process death — custody is not a memory', async () => {
    const dir = freshDir('restart');
    let mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);
    expect((await beginCustody(mf)).status).toBe(200);
    await mf.dispose();

    mf = boot(dir);
    const led = await hit(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect(led.json).toMatchObject({ currentCustodian: `courier:${RIDER}` });
    // …and the file still vouches for its own history after the replay.
    expect((await hit(mf, 'GET', `/ops/ledger/verify?orderId=${ORDER}`)).json)
      .toMatchObject({ ok: true, headMatches: true });
    await mf.dispose();
  });

  it('a redelivered begin replays its recorded answer instead of moving custody twice', async () => {
    const dir = freshDir('redeliver');
    const mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);
    expect((await beginCustody(mf)).status).toBe(200);

    // Same command_id, same content — an at-least-once producer's second try.
    const dup = await beginCustody(mf);
    expect(dup.status).toBe(200);
    expect(dup.json).toMatchObject({ ok: true, status: 'custody_with_courier', duplicate: true });
    await mf.dispose();
  });
});

/**
 * ⚠ THE FIRST LINE OF THIS SLICE — « NO CLAIM, NO CUSTODY ».
 *
 * The legacy window, reproduced exactly as JOURNAL.md discloses it: a file
 * opened before SE-LIVE-4a holds no claim, and while it sits un-re-opened a NEW
 * order wins its package. Both files exist. Before this slice both could arm a
 * custody seal and, once a transition existed, both could take custody — two
 * custodians for one package, which is SE-I04 broken.
 *
 * After this slice the unclaimed file cannot transition custody at all, and the
 * window stops depending on who re-opens first.
 */
describe('no claim, no custody — the legacy window closed permanently', () => {
  it('an unclaimed file refuses to take custody, and the order that holds the claim can', async () => {
    const dir = freshDir('legacy');
    let mf = boot(dir);

    // A file from before the claim existed: opened, armed, verified…
    await armedOrder(mf, 'ord-legacy-A', 'pkg-legacy-4b');
    expect((await verifyPickup(mf, 'ord-legacy-A')).status).toBe(200);
    await mf.dispose();

    // …and then stripped of every trace of its claim, which is exactly the
    // state of anything opened between the SE-LIVE-3 deploy and SE-LIVE-4a.
    expect(deleteRows(dir, (k) => k.startsWith('custody:package-claim'))).toBe(2);

    mf = boot(dir);
    // THE DISCRIMINATING ASSERTION. It is verified, its seal is armed, it is
    // one call away from custody — and it is refused, because it cannot show
    // the package is exclusively its own.
    const refused = await beginCustody(mf, 'ord-legacy-A');
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ ok: false, reason: 'package_claim_not_held' });

    // Nothing moved.
    const led = await hit(mf, 'GET', '/ops/ledger?orderId=ord-legacy-A');
    expect(led.json['currentCustodian'] ?? null).toBeNull();

    // The honest recovery still works: re-open takes the claim, and custody
    // then proceeds normally. The guard refuses; it does not brick.
    expect((await hit(mf, 'POST', '/ops/order/open', {
      orderId: 'ord-legacy-A', taskId: 'task-ord-legacy-A', packageId: 'pkg-legacy-4b',
      correlationId: 'corr-ord-legacy-A', supplierId: SUPPLIER,
    })).status).toBe(200);
    const healed = await beginCustody(mf, 'ord-legacy-A', { command_id: 'begin-after-heal' });
    expect(healed.status).toBe(200);
    expect(healed.json).toMatchObject({ ok: true, status: 'custody_with_courier' });
    await mf.dispose();
  });

  it('the rival that won the free package may take custody; the older file may not', async () => {
    const dir = freshDir('legacy-rival');
    let mf = boot(dir);
    await armedOrder(mf, 'ord-legacy-B', 'pkg-legacy-rival');
    expect((await verifyPickup(mf, 'ord-legacy-B')).status).toBe(200);
    await mf.dispose();

    // The legacy file loses its claim…
    expect(deleteRows(dir, (k) => k.startsWith('custody:package-claim'))).toBe(2);
    mf = boot(dir);

    // …and a NEW order takes the now-free package. Two files, one package —
    // the disclosed window, live.
    await armedOrder(mf, 'ord-newcomer', 'pkg-legacy-rival');
    expect((await verifyPickup(mf, 'ord-newcomer')).status).toBe(200);

    // The newcomer holds the claim, so IT may take custody…
    expect((await beginCustody(mf, 'ord-newcomer')).status).toBe(200);
    // …and the older file, which does not, may not. One package, one custodian,
    // even while two custody files exist over it.
    const stale = await beginCustody(mf, 'ord-legacy-B');
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ ok: false, reason: 'package_claim_not_held' });
    await mf.dispose();
  });
});

/**
 * ⚠ THE TWO ATTRIBUTION DEFECTS THE 4b-i VERIFIER FOUND. Neither could move a
 * package — custody CONTROL survived every attack. Both corrupt what the record
 * SAYS about who holds it, and both become control defects at SE-LIVE-4b-ii,
 * when the rider's own credential opens this route and `riderId` stops being
 * the founder's typo and starts being attacker-supplied. Closed now.
 */
describe('the custody record says who actually took the package', () => {
  // NUL/backspace/CR are built rather than typed: a literal control byte in a
  // source file is invisible in review and turns the file binary to grep.
  const BS = String.fromCharCode(8);
  const CR = String.fromCharCode(13);

  it('a riderId carrying control bytes is refused — a custodian that misrenders settles nothing', async () => {
    const dir = freshDir('rider-bytes');
    const mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);

    for (const bad of [`rider-mallory${BS}${BS}${BS}${BS}${BS}${BS}${BS}moussa`, `rider-moussa${CR}rider-mallory`]) {
      const res = await beginCustody(mf, ORDER, { command_id: `begin-${bad.length}`, riderId: bad });
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ reason: 'rider_id_not_usable' });
    }
    // A photo ref is a name in the record too, and misrenders the same way.
    const badRef = await beginCustody(mf, ORDER, {
      command_id: 'begin-bad-ref', sealPhotoRefs: [`seal${BS}${BS}${BS}${BS}other.jpg`],
    });
    expect(badRef.status).toBe(400);
    expect(badRef.json).toMatchObject({ reason: 'seal_photo_ref_not_usable' });

    // Nothing moved through any of them.
    const led = await hit(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect(String(led.json['currentCustodian'] ?? '')).not.toContain('courier');
    await mf.dispose();
  });

  it('the rider who takes custody must be the rider who verified the pickup', async () => {
    const dir = freshDir('one-hand');
    const mf = boot(dir);
    await armedOrder(mf);

    // Alice verifies the goods…
    expect((await hit(mf, 'POST', '/ops/verification', {
      orderId: ORDER, command_id: 'verify-alice', riderId: 'rider-ALICE',
      presentedPickupCode: PICKUP_CODE, evidenceBundleId: 'ev-alice',
      dwellSec: 150, checkResults: ALL_PASS, at: T,
    })).status).toBe(200);

    // …so Mallory cannot be the one who walks away with them.
    const stolen = await beginCustody(mf, ORDER, { command_id: 'begin-mallory', riderId: 'rider-MALLORY' });
    expect(stolen.status).toBe(409);
    expect(stolen.json).toMatchObject({ ok: false, reason: 'rider_did_not_verify_this_pickup', verifiedBy: 'rider-ALICE' });

    // The two readable records cannot disagree, because the second never happened.
    const led = await hit(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect(String(led.json['currentCustodian'] ?? '')).not.toContain('MALLORY');

    // …and Alice herself proceeds normally. The guard binds; it does not brick.
    const honest = await beginCustody(mf, ORDER, { command_id: 'begin-alice', riderId: 'rider-ALICE' });
    expect(honest.status).toBe(200);
    expect(led.json).toBeDefined();
    expect((await hit(mf, 'GET', `/ops/ledger?orderId=${ORDER}`)).json)
      .toMatchObject({ currentCustodian: 'courier:rider-ALICE' });
    await mf.dispose();
  });

  it('the rider who took custody is readable — protected and unreadable is not shipped', async () => {
    const dir = freshDir('readable');
    const mf = boot(dir);
    await armedOrder(mf);
    expect((await verifyPickup(mf)).status).toBe(200);
    expect((await beginCustody(mf)).status).toBe(200);

    const att = await hit(mf, 'GET', `/ops/attestations?orderId=${ORDER}`);
    expect(att.status).toBe(200);
    // Per act, not per response (4b round-1 blocker A2): the blanket label is
    // gone, and BOTH lists now say for themselves whose hand each act was.
    expect(att.json['attribution']).toBeUndefined();
    const verifications = att.json['attestations'] as Record<string, unknown>[];
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({ riderId: RIDER, attribution: 'founder_attested' });
    const taken = att.json['custodyTaken'] as Record<string, unknown>[];
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({
      riderId: RIDER, attribution: 'founder_attested', outcome: 'custody_with_courier', recorded: true,
    });
    // The seal itself is never surfaced — not the plaintext, not the digest.
    const text = JSON.stringify(att.json);
    expect(text).not.toContain(SEAL_CODE);
    expect(text).not.toContain(PICKUP_CODE);
    await mf.dispose();
  });
});
