import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ THE POSITIVE CONTROLS FOR THE TWO RACES ═══
 *
 * SE-LIVE-4a shipped a claim that was a time-of-check/time-of-use bug, and the
 * suite that was supposed to catch it DID NOT. That second failure is the
 * reason this file exists.
 *
 * ⚠ HOW THESE TESTS DETECT, and why the first two attempts did not.
 *
 * COUNTING RACE OUTCOMES DOES NOT WORK. Attempt one asserted « exactly one 200
 * per package ». Attempt two added a warm runtime, a sweep of trials, and a
 * trick of reading every response body, and a JOURNAL entry called all three
 * necessary — « measured rather than reasoned ». **That claim was false and the
 * round-3 verifier disproved it**: against the broken worker the defect
 * reproduces with neither the warm-up nor the body reads, in about half of
 * runs, and reading bodies at most doubles a ~1–3 % per-trial hit rate. Only
 * « enough trials » was ever load-bearing. Worse, the resulting test caught the
 * defect in only 5 of 8 runs AND timed out on healthy code often enough to turn
 * the CI gate red — a pin that is wrong in both directions.
 *
 * SO THESE TESTS DO NOT COUNT OUTCOMES. They storm the doors, then ASK THE
 * OBJECTS what state they are in: every order, does it have a custody file;
 * every package, who holds its claim. Two files over one package, or a claim
 * held by an order that is not carrying that package, are FACTS ON DISK — they
 * do not depend on catching an interleaving in the act. That makes the pin
 * deterministic, and it is why the storm needs only a handful of rounds.
 *
 * POSITIVE CONTROLS, recorded in JOURNAL.md: this detector finds two-files and
 * orphaned-claim states on the workers that had those defects, and finds none
 * here.
 */

const OPS = 'test-custody-ops-secret-0004';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const BUNDLE = readFileSync('dist-worker/worker.mjs', 'utf8');

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-race-${tag}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * The shipped bundle with `PackageClaimDO.fetch` replaced by a thrower — the
 * round-3 M3 reproduction. TEST SCAFFOLDING ONLY. It stands in for the ordinary
 * production events that make a cross-object call reject: a deploy terminating
 * in-flight DO calls, a transient stub failure, an overloaded claim object.
 */
function bootWithThrowingClaims(dir: string): Miniflare {
  const wrapper = `
    import worker, { CustodyDO, PackageClaimDO } from './worker.mjs';
    export { CustodyDO };
    export class ThrowingPackageClaimDO extends PackageClaimDO {
      async fetch() { throw new Error('claim object exploded'); }
    }
    export default worker;
  `;
  return new Miniflare({
    modules: [
      { type: 'ESModule', path: '/throwing.mjs', contents: wrapper },
      { type: 'ESModule', path: '/worker.mjs', contents: BUNDLE },
    ],
    modulesRoot: '/',
    scriptPath: '/throwing.mjs',
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'ThrowingPackageClaimDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
  });
}

function boot(dir: string): Miniflare {
  return new Miniflare({
    modules: true,
    script: BUNDLE,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
  });
}

/**
 * The shipped bundle, with `PackageClaimDO` wrapped so its `fetch` waits before
 * doing anything. TEST SCAFFOLDING ONLY — the delay lives here, never in
 * `worker/`. It stands in for the cross-object hop's real latency, which is what
 * makes `CustodyDO`'s own read-hop-write window wide enough to lose a race in.
 */
function bootWithSlowClaims(dir: string, delayMs: number): Miniflare {
  const wrapper = `
    import worker, { CustodyDO, PackageClaimDO } from './worker.mjs';
    export { CustodyDO };
    export class SlowPackageClaimDO extends PackageClaimDO {
      async fetch(request) {
        await new Promise((r) => setTimeout(r, ${delayMs}));
        return super.fetch(request);
      }
    }
    export default worker;
  `;
  return new Miniflare({
    modules: [
      { type: 'ESModule', path: '/slow.mjs', contents: wrapper },
      { type: 'ESModule', path: '/worker.mjs', contents: BUNDLE },
    ],
    modulesRoot: '/',
    scriptPath: '/slow.mjs',
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'SlowPackageClaimDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
  });
}

/**
 * Who holds a package, asked of the claim object itself.
 *
 * NB: read through the RUNTIME, never off the disk. Durable Object values are
 * V8-serialised, not JSON — a first cut of this file regex-matched the stored
 * bytes for `"packageId":"…"`, found nothing, and reported « no claims » for a
 * package that was plainly claimed. A test that mis-reads storage fails
 * honest code and passes broken code.
 */
async function holderOf(mf: Miniflare, packageId: string): Promise<string | null> {
  const ns = await mf.getDurableObjectNamespace('PACKAGE_CLAIM');
  const res = await ns.get(ns.idFromName(packageId)).fetch('https://package/claim', {
    method: 'GET',
    headers: { 'X-Package-Object': packageId },
  });
  const body = JSON.parse(await res.text()) as Record<string, unknown>;
  if (res.status === 404) {
    expect(body).toMatchObject({ reason: 'package_unclaimed' });
    return null;
  }
  expect(res.status).toBe(200);
  return (body['claim'] as Record<string, unknown>)['orderId'] as string;
}

/** Every order that actually has a custody file, and which package it carries. */
async function custodyFiles(mf: Miniflare, orders: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const o of orders) {
    const res = await mf.dispatchFetch(`http://custody/ops/ledger?orderId=${o}`, { headers: opsAuth });
    if (res.status !== 200) { await res.text(); continue; }
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    files.set(o, body['packageId'] as string);
  }
  return files;
}

/**
 * ⚠ THE PIN FOR BOTH RACES — and the third attempt at it, because the first two
 * were defective in ways that matter more than the defect itself (see the file
 * header). It storms the doors and then reads STATE, so it cannot miss.
 *
 * Two things are violations, and both are visible on disk afterwards:
 *   ① TWO CUSTODY FILES over one package — SE-I04 with two custodians the
 *      moment SE-LIVE-4b adds a transition.
 *   ② AN ORPHANED CLAIM — a package held by an order that is not carrying it.
 *      Nothing in this service releases a claim, so an honest unrelated order
 *      for that package is refused forever and Séra can never take custody of
 *      those goods.
 */
describe('storming every door leaves no package double-filed and no claim orphaned', () => {
  it('holds across rounds of simultaneous opens on shared and split packages', { timeout: 120_000 }, async () => {
    const dir = freshDir('storm');
    const mf = boot(dir);

    for (let round = 0; round < 6; round += 1) {
      const shared = `pkg-storm-${round}-shared`;
      const rivals = Array.from({ length: 8 }, (_, i) => `ord-storm-${round}-rival-${i}`);
      const splitter = `ord-storm-${round}-splitter`;
      const split = Array.from({ length: 6 }, (_, i) => `pkg-storm-${round}-split-${i}`);
      const twin = `ord-storm-${round}-twin`;
      const twinPkg = `pkg-storm-${round}-twin`;

      const open = (orderId: string, packageId: string) =>
        mf.dispatchFetch('http://custody/ops/order/open', {
          method: 'POST',
          headers: opsAuth,
          body: JSON.stringify({
            orderId, taskId: `task-${orderId}`, packageId,
            correlationId: `corr-${orderId}`, supplierId: 'sup-storm-0001',
          }),
        });

      // Everything at once: eight orders duelling for one package, one order
      // splitting itself across six, and one order re-sent four times.
      await Promise.all([
        ...rivals.map((o) => open(o, shared)),
        ...split.map((p) => open(splitter, p)),
        ...Array.from({ length: 4 }, () => open(twin, twinPkg)),
      ]).then((rs) => Promise.all(rs.map((r) => r.text())));

      const allOrders = [...rivals, splitter, twin];
      const files = await custodyFiles(mf, allOrders);

      // ① No package carries two custody files.
      const byPackage = new Map<string, string[]>();
      for (const [order, pkg] of files) byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), order]);
      const doubled = [...byPackage.entries()].filter(([, os]) => os.length > 1);
      expect({ round, doubleFiled: doubled }).toEqual({ round, doubleFiled: [] });

      // ② No claim is held by an order that is not carrying that package.
      const orphans: { packageId: string; heldBy: string }[] = [];
      for (const pkg of [shared, twinPkg, ...split]) {
        const holder = await holderOf(mf, pkg);
        if (holder === null) continue;
        if (files.get(holder) !== pkg) orphans.push({ packageId: pkg, heldBy: holder });
      }
      expect({ round, orphans }).toEqual({ round, orphans: [] });

      // …and the guard is not just refusing everything: every package that is
      // not carried by a file must still be openable by an honest order.
      for (const pkg of [shared, twinPkg, ...split]) {
        if ([...files.values()].includes(pkg)) continue;
        const honest = await open(`ord-storm-honest-${pkg}`, pkg);
        expect({ pkg, status: honest.status }).toEqual({ pkg, status: 200 });
        await honest.text();
      }
    }

    await mf.dispose();
  });
});

/**
 * ⚠ THE PIN FOR THE ROUND-2 FINDING — the SAME race one level up.
 * `/order/open` read `this.chain`, awaited a CROSS-OBJECT HOP to the claim
 * object, then wrote the chain. Concurrent opens for ONE order naming DIFFERENT
 * packages all passed `this.chain === null`, each won a different package, and
 * only one chain survived — leaving the rest of those packages claimed by an
 * order that is not carrying them. Nothing in this service releases an orphaned
 * claim, so an honest unrelated order for such a package is refused forever and
 * Séra can never take custody of those goods.
 *
 * Reachable with no attacker: a corrected retry racing the original, or an
 * at-least-once producer delivering twice.
 */
describe('an order cannot claim more packages than the one custody file it opens', () => {
  it('six simultaneous opens of one order over six packages leave exactly one claim', async () => {
    const dir = freshDir('orphan');
    // 50 ms stands in for the real hop — cross-object, and a cold object create
    // on a package's first open.
    const mf = bootWithSlowClaims(dir, 50);

    for (const round of [1, 2]) {
      const ORDER = `ord-orphan-${round}`;
      const packages = [0, 1, 2, 3, 4, 5].map((n) => `pkg-orphan-${round}-${n}`);
      const results = await Promise.all(
        packages.map((pkg) =>
          mf.dispatchFetch('http://custody/ops/order/open', {
            method: 'POST',
            headers: opsAuth,
            body: JSON.stringify({
              orderId: ORDER,
              taskId: `task-${ORDER}`,
              packageId: pkg,
              correlationId: `corr-${ORDER}`,
              supplierId: 'sup-orphan-0001',
            }),
          }),
        ),
      );
      // Exactly one open succeeds; the rest are refused — the chain under a
      // custody file is not re-writable, and the losers must not have claimed.
      expect(results.map((r) => r.status).filter((c) => c === 200)).toHaveLength(1);

      // Which package the surviving custody file actually carries.
      const led = await mf.dispatchFetch(`http://custody/ops/ledger?orderId=${ORDER}`, { headers: opsAuth });
      const carried = (JSON.parse(await led.text()) as Record<string, unknown>)['packageId'] as string;
      expect(packages).toContain(carried);

      /**
       * THE INVARIANT: one custody file, one package spoken for. Every other
       * package must be UNCLAIMED — an orphan is a package locked to an order
       * that is not carrying it, with no route here that can ever release it.
       */
      for (const pkg of packages) {
        expect(await holderOf(mf, pkg)).toBe(pkg === carried ? ORDER : null);
      }

      // And the user-facing cost, stated as a test: an honest, unrelated order
      // for any other package must still be able to open.
      for (const pkg of packages.filter((p) => p !== carried)) {
        const honest = await mf.dispatchFetch('http://custody/ops/order/open', {
          method: 'POST',
          headers: opsAuth,
          body: JSON.stringify({
            orderId: `ord-honest-${pkg}`,
            taskId: 't',
            packageId: pkg,
            correlationId: 'c',
            supplierId: 'sup-orphan-0001',
          }),
        });
        expect(honest.status).toBe(200);
      }
    }

    await mf.dispose();
  });
});

/**
 * ⚠ THE PIN FOR THE ROUND-3 M3 FINDING. Wrapping `/order/open` in
 * `blockConcurrencyWhile` bought serialisation and cost error shape: a
 * rejection inside that block aborts the object BEFORE `fetch`'s catch-all
 * runs, so a claim object that threw made the door answer a raw 500 with a
 * stack trace in it — the class `index.ts` closed at SE-LIVE-3 round 5,
 * reopened by a different mechanism.
 *
 * It failed CLOSED throughout, and that half is asserted here too: a door that
 * crashes politely is still not allowed to leave half a custody file behind.
 */
describe('a claim object that throws is answered, not crashed through', () => {
  it('refuses by name, leaks no stack trace, writes nothing, and recovers', async () => {
    const dir = freshDir('throwing');
    const mf = bootWithThrowingClaims(dir);

    const res = await mf.dispatchFetch('http://custody/ops/order/open', {
      method: 'POST',
      headers: opsAuth,
      body: JSON.stringify({
        orderId: 'ord-throw', taskId: 't', packageId: 'pkg-throw',
        correlationId: 'c', supplierId: 'sup-throw-0001',
      }),
    });
    const text = await res.text();

    // Structured, like every other refusal this door gives.
    expect(JSON.parse(text)).toMatchObject({ ok: false });
    expect(JSON.parse(text)['reason']).toMatch(/package_claim_unreachable|custody_object_unavailable/);
    // And it does not hand an operator a stack trace to read.
    expect(text).not.toContain('at async');
    expect(text).not.toContain('exploded');

    // FAILED CLOSED: no custody file exists for that order.
    const led = await mf.dispatchFetch('http://custody/ops/ledger?orderId=ord-throw', { headers: opsAuth });
    expect(JSON.parse(await led.text())).toMatchObject({ reason: 'order_not_open' });
    await mf.dispose();

    // …and the package was left free, so an honest order can still take it
    // once the claim object is healthy again.
    const healthy = boot(dir);
    const again = await healthy.dispatchFetch('http://custody/ops/order/open', {
      method: 'POST',
      headers: opsAuth,
      body: JSON.stringify({
        orderId: 'ord-after-throw', taskId: 't', packageId: 'pkg-throw',
        correlationId: 'c', supplierId: 'sup-throw-0001',
      }),
    });
    expect(again.status).toBe(200);
    await again.text();
    await healthy.dispose();
  });
});
