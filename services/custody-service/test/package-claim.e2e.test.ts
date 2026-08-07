import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ SE-LIVE-4a — ONE CUSTODY FILE PER PACKAGE ═══
 *
 * THE DEFECT THIS SUITE PINS SHUT was found by the SE-LIVE-3 verifier and
 * deferred by the founder to this slice, on the record, with a condition:
 * SE-LIVE-4 « may not begin its custody-transition work until this is settled ».
 *
 * Canon keys the custody record by PACKAGE:
 *
 *   Sera-Build-Spec.md:79
 *     `CustodyRecord{ packageId, currentCustodian, transitions[], exception? }
 *      // exactly one current custodian`
 *   Sera-Build-Spec.md:36 (SE-I04)
 *     « Every package has **exactly one current custodian**; task status alone
 *       MUST NOT be custody truth. »
 *
 * `CustodyDO` is keyed by ORDER. So two orders naming one `packageId` opened
 * two custody files over one physical package — two ledgers, two
 * `custodianByPackage` maps, neither able to see the other. Harmless in
 * SE-LIVE-3 (no route there transitions custody, so `currentCustodian` was
 * always undefined); an SE-I04 violation with two live custodians the moment a
 * transition exists.
 *
 * The claim closes it BY ADDRESS, and these tests assert exactly that — not
 * that a refusal message appears, but that the LOSER GETS NO CUSTODY FILE AT
 * ALL: it cannot arm a secret, cannot verify, cannot be read, and holds nothing
 * on disk. A refusal that left a half-open file behind would satisfy a
 * message-shaped test and fail the invariant.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-custody-ops-secret-0003';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-claim-${tag}-`));
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

async function call(mf: Miniflare, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers: opsAuth,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const chainFor = (orderId: string, packageId: string): Json => ({
  orderId,
  taskId: `task-${orderId}`,
  packageId,
  correlationId: `corr-${orderId}`,
  supplierId: 'sup-claim-0001',
});

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else found.push(p);
    }
  };
  walk(dir);
  return found;
}

/** Every LIVE key across every object's `_cf_KV` table. Read through SQLite,
 *  not by scanning bytes: a deleted row's bytes linger in freed pages, so a
 *  byte scan would report a key that no longer exists and the test would be
 *  asserting the file system rather than the storage. */
function storedKeys(dir: string): string[] {
  const keys: string[] = [];
  for (const file of filesUnder(dir)) {
    if (!file.endsWith('.sqlite') || file.includes('metadata')) continue;
    const db = new DatabaseSync(file);
    try {
      for (const row of db.prepare('select key from _cf_KV').all() as unknown as { key: Uint8Array }[]) {
        keys.push(Buffer.from(row.key).toString('latin1'));
      }
    } finally {
      db.close();
    }
  }
  return keys;
}

/** Delete stored rows by key — the same `_cf_KV` route the storage suite uses.
 *  Going through SQLite rather than editing bytes matters: a raw edit lands in
 *  the write-ahead log and SQLite discards the whole WAL. */
function deleteRows(dir: string, match: (key: string) => boolean): number {
  let removed = 0;
  for (const file of filesUnder(dir)) {
    if (!file.endsWith('.sqlite') || file.includes('metadata')) continue;
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key from _cf_KV').all() as unknown as { key: Uint8Array }[];
      for (const row of rows) {
        const key = Buffer.from(row.key).toString('latin1');
        if (!match(key)) continue;
        db.prepare('delete from _cf_KV where key = ?').run(row.key);
        removed += 1;
      }
    } finally {
      db.close();
    }
  }
  return removed;
}

describe('a package belongs to exactly one custody file (SE-I04, Build Spec:79)', () => {
  it('refuses the second order over the same package — and leaves it NO custody file at all', async () => {
    const dir = freshDir('two-orders');
    const mf = boot(dir);
    const PKG = 'pkg-contested-0001';

    const first = await call(mf, 'POST', '/ops/order/open', chainFor('ord-claim-A', PKG));
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, status: 'open' });

    const second = await call(mf, 'POST', '/ops/order/open', chainFor('ord-claim-B', PKG));
    expect(second.status).toBe(409);
    expect(second.json).toMatchObject({ ok: false, reason: 'package_claimed_by_other_order' });
    // The refusal NAMES the holder. An operator staring at a rejected order
    // needs to know which file already carries the package, not just that one
    // does — this is the moment he must not be left guessing.
    expect(second.json['claim']).toMatchObject({ packageId: PKG, orderId: 'ord-claim-A' });

    // ── THE INVARIANT, not the message: B has no custody file. ──────────────
    for (const [method, path, body] of [
      ['GET', '/ops/ledger?orderId=ord-claim-B', undefined],
      ['GET', '/ops/attestations?orderId=ord-claim-B', undefined],
      ['GET', '/ops/events?orderId=ord-claim-B', undefined],
      ['POST', '/ops/secrets/arm', { orderId: 'ord-claim-B', command_id: 'arm-b', kind: 'custody_seal', secret: 'SEAL-B-0001' }],
    ] as const) {
      const res = await call(mf, method, path, body);
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ reason: 'order_not_open' });
    }

    // …and A is untouched by the contest — it still acts normally.
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: 'ord-claim-A', command_id: 'arm-a', kind: 'custody_seal', secret: 'SEAL-A-0001',
    })).status).toBe(200);
    expect((await call(mf, 'GET', '/ops/ledger/verify?orderId=ord-claim-A')).json)
      .toMatchObject({ ok: true, headMatches: true });

    await mf.dispose();
  });

  it('the loser was not half-opened: it can still open its OWN package afterwards', async () => {
    const dir = freshDir('no-half-open');
    const mf = boot(dir);

    expect((await call(mf, 'POST', '/ops/order/open', chainFor('ord-half-A', 'pkg-half-0001'))).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/order/open', chainFor('ord-half-B', 'pkg-half-0001'))).status).toBe(409);

    /**
     * THE POINT. The claim is won BEFORE the chain row is written, so a lost
     * contest writes nothing — no chain, no head, no state. If the chain had
     * landed first and the claim been checked after, B would now be refused
     * with `chain_already_open_with_other_ids`: its honest package permanently
     * unopenable because of an order it never completed.
     */
    const own = await call(mf, 'POST', '/ops/order/open', chainFor('ord-half-B', 'pkg-half-0002'));
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ ok: true, status: 'open' });
    expect((own.json['chain'] as Json)['package_id']).toBe('pkg-half-0002');

    await mf.dispose();
  });

  it('a DIFFERENT package opens normally — the guard is not just refusing everything', async () => {
    const dir = freshDir('anchor');
    const mf = boot(dir);
    for (const n of [1, 2, 3]) {
      const res = await call(mf, 'POST', '/ops/order/open', chainFor(`ord-anchor-${n}`, `pkg-anchor-000${n}`));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: true, status: 'open' });
    }
    await mf.dispose();
  });

  it('the same order re-opening its own package is absorbed, not refused as a rival', async () => {
    const dir = freshDir('reopen');
    const mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', chainFor('ord-reopen', 'pkg-reopen-0001'))).status).toBe(200);
    // A retry — the honest client behaviour on a timeout — must not read as a
    // second order over a claimed package.
    const again = await call(mf, 'POST', '/ops/order/open', chainFor('ord-reopen', 'pkg-reopen-0001'));
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ ok: true, status: 'already_open' });
    await mf.dispose();
  });

  it('the claim survives a real process death — the contest is not decided in memory', async () => {
    const dir = freshDir('restart');
    let mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', chainFor('ord-restart-A', 'pkg-restart-0001'))).status).toBe(200);

    // The runtime dies. Every in-memory map goes with it.
    await mf.dispose();
    mf = boot(dir);

    const rival = await call(mf, 'POST', '/ops/order/open', chainFor('ord-restart-B', 'pkg-restart-0001'));
    expect(rival.status).toBe(409);
    expect(rival.json).toMatchObject({ ok: false, reason: 'package_claimed_by_other_order' });
    expect(rival.json['claim']).toMatchObject({ orderId: 'ord-restart-A' });
    // And the winner's own file came back intact across the same death.
    expect((await call(mf, 'GET', '/ops/ledger/verify?orderId=ord-restart-A')).json)
      .toMatchObject({ ok: true, headMatches: true });
    await mf.dispose();
  });
});

describe('a custody file opened before this slice existed claims its package on the next open', () => {
  it('re-opening an unclaimed file wins the claim, and the rival is refused from then on', async () => {
    const dir = freshDir('self-heal');
    let mf = boot(dir);
    const PKG = 'pkg-legacy-0001';

    expect((await call(mf, 'POST', '/ops/order/open', chainFor('ord-legacy-A', PKG))).status).toBe(200);
    await mf.dispose();

    /**
     * SIMULATE A PRE-SE-LIVE-4a FILE: an open custody file with NO claim
     * anywhere — neither the marker on the order object nor the row in the
     * package object. This is exactly the state of anything opened on the live
     * Worker between the SE-LIVE-3 deploy and this slice.
     */
    const removed = deleteRows(dir, (k) => k.startsWith('custody:package-claim'));
    expect(removed).toBe(2); // the order's marker AND the package's claim row
    const keys = storedKeys(dir);
    expect(keys.filter((k) => k.startsWith('custody:package-claim'))).toEqual([]);
    // The chain itself is untouched — this is a legacy file, not a broken one.
    expect(keys).toContain('custody:chain:v1');

    mf = boot(dir);
    // The honest re-open. `already_open` as before — and the claim is taken.
    const reopen = await call(mf, 'POST', '/ops/order/open', chainFor('ord-legacy-A', PKG));
    expect(reopen.status).toBe(200);
    expect(reopen.json).toMatchObject({ ok: true, status: 'already_open' });

    /**
     * THE DISCRIMINATING ASSERTION. Nothing above proves the self-heal ran —
     * `already_open` is what an un-healed file answers too. This does: with the
     * claim gone the package was FREE, so if the re-open had not taken it, the
     * rival below would succeed. It must not.
     */
    const rival = await call(mf, 'POST', '/ops/order/open', chainFor('ord-legacy-B', PKG));
    expect(rival.status).toBe(409);
    expect(rival.json).toMatchObject({ ok: false, reason: 'package_claimed_by_other_order' });
    expect(rival.json['claim']).toMatchObject({ orderId: 'ord-legacy-A' });

    // And healing did not disturb what the file vouches for.
    expect((await call(mf, 'GET', '/ops/ledger/verify?orderId=ord-legacy-A')).json)
      .toMatchObject({ ok: true, headMatches: true });
    await mf.dispose();
  });
});

/**
 * The claim object is reached only from inside `CustodyDO` today — no Worker
 * route addresses it. These tests go STRAIGHT TO THE NAMESPACE, which is what
 * a second caller of it looks like, because SE-LIVE-4 adds the rider's own
 * door and « a gate added later is a gate that already let something through ».
 */
describe('the claim object refuses to answer about a package it has not been told it is', () => {
  it('a caller that omits X-Package-Object is refused, and a body naming another package is refused', async () => {
    const dir = freshDir('anchor-claim');
    const mf = boot(dir);
    const ns = await mf.getDurableObjectNamespace('PACKAGE_CLAIM');
    const stub = ns.get(ns.idFromName('pkg-direct-0001'));

    const noHeader = await stub.fetch('https://package/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'pkg-direct-0001', orderId: 'ord-direct', at: '2026-08-07T09:00:00.000Z' }),
    });
    expect(noHeader.status).toBe(400);
    expect(JSON.parse(await noHeader.text())).toMatchObject({ ok: false, reason: 'package_object_not_named' });

    const wrongBody = await stub.fetch('https://package/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Package-Object': 'pkg-direct-0001' },
      body: JSON.stringify({ packageId: 'pkg-SOMEWHERE-ELSE', orderId: 'ord-direct', at: '2026-08-07T09:00:00.000Z' }),
    });
    expect(wrongBody.status).toBe(400);
    expect(JSON.parse(await wrongBody.text())).toMatchObject({ reason: 'package_id_does_not_name_this_object' });

    // Neither attempt wrote anything: the package is still free.
    const read = await stub.fetch('https://package/claim', {
      method: 'GET',
      headers: { 'X-Package-Object': 'pkg-direct-0001' },
    });
    expect(read.status).toBe(404);
    expect(JSON.parse(await read.text())).toMatchObject({ reason: 'package_unclaimed' });

    await mf.dispose();
  });

  it('a stored claim and the object holding it must agree on which package it is', async () => {
    const dir = freshDir('misfiled-claim');
    const mf = boot(dir);
    const PKG = 'pkg-misfiled-0001';
    expect((await call(mf, 'POST', '/ops/order/open', chainFor('ord-misfiled', PKG))).status).toBe(200);

    const ns = await mf.getDurableObjectNamespace('PACKAGE_CLAIM');
    const stub = ns.get(ns.idFromName(PKG));

    // Told its own name, it answers honestly.
    const honest = await stub.fetch('https://package/claim', { method: 'GET', headers: { 'X-Package-Object': PKG } });
    expect(honest.status).toBe(200);
    expect(JSON.parse(await honest.text())).toMatchObject({ ok: true, claim: { packageId: PKG, orderId: 'ord-misfiled' } });

    /**
     * Told a DIFFERENT name, the row and the address disagree — which is what a
     * moved claim row looks like from the inside. It refuses rather than
     * answering about a package it is not, because an answer here decides
     * whether a second custody file may open over someone's goods.
     */
    const misfiled = await stub.fetch('https://package/claim', {
      method: 'GET',
      headers: { 'X-Package-Object': 'pkg-some-other-000' },
    });
    expect(misfiled.status).toBe(409);
    const text = await misfiled.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, reason: 'claim_does_not_name_this_object' });
    // It refuses without disclosing the record it is refusing about.
    expect(text).not.toContain('ord-misfiled');

    await mf.dispose();
  });
});
