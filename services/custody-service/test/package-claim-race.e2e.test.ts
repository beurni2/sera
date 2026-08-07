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
 * ⚠ WHAT MAKES A RACE VISIBLE HERE, measured rather than reasoned. Three
 * things, and without all three the broken code passes:
 *
 *   ① A WARM, BUSY RUNTIME. On a cold isolate the requests serialise.
 *   ② ENOUGH TRIALS. The interleaving is probabilistic, not deterministic.
 *   ③ THE RESPONSE BODIES MUST BE READ. Leaving eight responses unconsumed
 *      changes how the requests overlap. This one cost the most to find: the
 *      round-1 worker passes a sweep that checks only status codes, and fails
 *      the same sweep the moment the bodies are read.
 *
 * A first attempt used a STREAMED request body instead, reasoning that a slow
 * parse would force the yield. It does not — `dispatchFetch` and the DO stub
 * both buffer the body before the object sees it — and that version passed on
 * the broken code. It was deleted rather than kept: a race test that has never
 * failed is not evidence, and keeping one labelled as a pin is the same lie it
 * is supposed to catch.
 *
 * The cross-object hop (the second test) needs no such care — it is slowed
 * deliberately by test scaffolding to production size.
 *
 * POSITIVE CONTROL for both, recorded in JOURNAL.md: each FAILS on the code it
 * names and passes on this one.
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

/**
 * ⚠ THE PIN FOR THE ROUND-1 BLOCKER, built the way it should have been built
 * the first time. The claim object used to read its stored row, then await the
 * body parse, then decide on the pre-await value; concurrent claims all saw an
 * empty row and all wrote.
 *
 * It needs a warm runtime, a sweep of trials, and the response bodies read —
 * see the file header. Verified against the round-1 worker: this test FAILS on
 * it (trial 5, two winners over one package) and passes here.
 *
 * `scripts/probe-claim-race.mjs` is the same race as a standalone script, kept
 * because it prints what each winner can then DO with the shared package.
 */
describe('the package claim is decided once, however many orders arrive together', () => {
  it('no package is ever opened by two orders across a sweep of eight-way races', async () => {
    const dir = freshDir('sweep');
    const mf = boot(dir);

    // ① Warm the runtime with unrelated traffic so it is not cold-serialising.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mf.dispatchFetch('http://custody/ops/order/open', {
          method: 'POST',
          headers: opsAuth,
          body: JSON.stringify({
            orderId: `ord-warm-${i}`, taskId: 't', packageId: `pkg-warm-${i}`,
            correlationId: 'c', supplierId: 'sup-sweep-0001',
          }),
        }),
      ),
    );

    // ② Sweep. Every trial is eight DIFFERENT orders over ONE package.
    for (let t = 0; t < 25; t += 1) {
      const PKG = `pkg-sweep-${t}`;
      const orders = Array.from({ length: 8 }, (_, i) => `ord-sweep-${t}-${i}`);
      const results = await Promise.all(
        orders.map((o) =>
          mf.dispatchFetch('http://custody/ops/order/open', {
            method: 'POST',
            headers: opsAuth,
            body: JSON.stringify({
              orderId: o, taskId: `task-${o}`, packageId: PKG,
              correlationId: `corr-${o}`, supplierId: 'sup-sweep-0001',
            }),
          }),
        ),
      );

      // The bodies are READ, not just the statuses. Leaving eight responses
      // unconsumed changes how the requests overlap, and a sweep that skips
      // the read stops reproducing the defect it exists for — measured on the
      // round-1 worker: bodies read → 8 winners; bodies ignored → 1.
      const opened = (await Promise.all(results.map((r) => r.text())))
        .map((t) => JSON.parse(t) as Record<string, unknown>)
        .filter((b) => b['ok'] === true);
      // THE INVARIANT: one package, one custody file — in every trial.
      expect({ trial: t, package: PKG, opened: opened.length }).toEqual({ trial: t, package: PKG, opened: 1 });

      // …and the claim row names exactly one order, the one that has the file.
      const holder = await holderOf(mf, PKG);
      expect(orders).toContain(holder);
      const withFile: string[] = [];
      for (const o of orders) {
        const led = await mf.dispatchFetch(`http://custody/ops/ledger?orderId=${o}`, { headers: opsAuth });
        if (led.status === 200) withFile.push(o);
      }
      expect(withFile).toEqual([holder]);
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
