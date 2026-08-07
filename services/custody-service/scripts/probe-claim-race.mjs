/**
 * ═══ THE CLAIM-RACE PROBE — the evidence the test suite cannot produce ═══
 *
 * Run:  node scripts/probe-claim-race.mjs      (from services/custody-service,
 *                                               after `pnpm bundle:worker`)
 *
 * WHY THIS EXISTS. SE-LIVE-4a's first cut let EIGHT different orders open
 * custody files over ONE package: `PackageClaimDO` read its stored row,
 * awaited, and decided on the pre-await value. This probe is what found it.
 * The same race is pinned as a test in `test/package-claim-race.e2e.test.ts`;
 * this script is kept alongside it because it goes further — it shows what each
 * winner can then DO with the shared package (arm a custody seal), which is the
 * part that makes the defect matter rather than merely exist.
 *
 * THREE THINGS THE RACE NEEDS, all measured: a warm runtime, a sweep of trials,
 * and THE RESPONSE BODIES READ. The third is the one that hides: an earlier cut
 * of this probe checked only status codes and reported « no multi-winner » on
 * the very worker that produced eight of them.
 *
 * RECORDED RESULTS (JOURNAL.md carries the same numbers):
 *   before the fix: 8 of 8 orders opened a custody file over one package,
 *                   every one able to arm a custody seal
 *   after the fix:  4 runs x 40 trials x 8-way — zero multi-winners
 *
 * To re-check the "before", bundle an older worker and run this again:
 *   git checkout <sha> -- worker/ && pnpm bundle:worker && node scripts/probe-claim-race.mjs
 */

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

const OPS = 'probe-custody-ops-secret';
const auth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };
const TRIALS = Number(process.env.TRIALS ?? 40);
const WIDTH = Number(process.env.WIDTH ?? 8);

const dir = mkdtempSync(join(tmpdir(), 'claim-race-probe-'));
const mf = new Miniflare({
  modules: true,
  script: readFileSync('dist-worker/worker.mjs', 'utf8'),
  compatibilityDate: '2025-07-05',
  compatibilityFlags: ['nodejs_compat'],
  durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
  durableObjectsPersist: dir,
  bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
});

// NB: the body is READ, not just the status. Leaving eight response bodies
// unconsumed changes how the requests overlap — the first cut of this probe
// skipped the read and stopped reproducing the very defect it was written for.
const open = async (orderId, packageId) => {
  const res = await mf.dispatchFetch('http://custody/ops/order/open', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ orderId, taskId: `task-${orderId}`, packageId, correlationId: `corr-${orderId}`, supplierId: 'sup-probe' }),
  });
  return { status: res.status, text: await res.text() };
};

// The race needs a warm, busy isolate — on a cold one the requests serialise
// and the window never opens. This warm-up is load-bearing.
await Promise.all(Array.from({ length: 20 }, (_, i) => open(`ord-warm-${i}`, `pkg-warm-${i}`)));

let hit = null;
for (let t = 0; t < TRIALS && hit === null; t += 1) {
  const pkg = `pkg-probe-${t}`;
  const orders = Array.from({ length: WIDTH }, (_, i) => `ord-probe-${t}-${i}`);
  const res = await Promise.all(orders.map((o) => open(o, pkg)));
  const winners = orders.filter((_, i) => res[i].status === 200);
  if (winners.length > 1) hit = { t, pkg, orders, winners };
}

if (hit === null) {
  console.log(`OK — no multi-winner in ${TRIALS} trials of ${WIDTH}-way races.`);
} else {
  console.log(`\n*** TRIAL ${hit.t}: ${hit.winners.length} of ${WIDTH} DIFFERENT orders opened a custody file over ${hit.pkg} ***`);
  for (const o of hit.winners) console.log('    winner:', o);
  console.log('\n--- what each winner can now DO with the shared package ---');
  for (const o of hit.orders) {
    const led = await mf.dispatchFetch(`http://custody/ops/ledger?orderId=${o}`, { headers: auth });
    if (led.status !== 200) continue;
    const ledger = await led.json();
    const armed = await mf.dispatchFetch('http://custody/ops/secrets/arm', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ orderId: o, command_id: `arm-${o}`, kind: 'custody_seal', secret: `SEAL-${o}` }),
    });
    console.log(`  ${o}: ledger packageId=${ledger.packageId} custodian=${ledger.currentCustodian} | arm custody_seal -> ${armed.status}`);
  }
  const ns = await mf.getDurableObjectNamespace('PACKAGE_CLAIM');
  const held = await ns.get(ns.idFromName(hit.pkg)).fetch('https://package/claim', {
    method: 'GET',
    headers: { 'X-Package-Object': hit.pkg },
  });
  console.log('  claim row says:', (await held.text()).slice(0, 200));
}

await mf.dispose();
rmSync(dir, { recursive: true, force: true });
process.exit(hit === null ? 0 : 1);
