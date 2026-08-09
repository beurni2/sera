import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterEach, describe, expect, it } from 'vitest';
import { httpRiderCodes } from '../../../apps/dispatch-console/src/rider-codes-port';
import { mintAvis } from '../../../apps/dispatch-console/src/rider-codes';

/**
 * ═══ THE FOUNDER MINTS A RIDER CODE — the console's own port, the real Worker ═══
 *
 * ⚠ REQUIRED BY THE NO-LOOP LAW (2026-08-08): « a slice that crosses a seam is
 * not done until ONE test crosses that seam end to end. » This console had
 * never made a network call; this slice gives it its first. So the port is
 * driven against the REAL logistics Worker in miniflare, not a fake fetch —
 * because the whole class of defect this ecosystem keeps paying for lives
 * exactly where an app's ports meet a real service.
 *
 * It earned that immediately. My first draft of the port read `hasCode` off
 * `GET /ops/riders`; the Worker does not send it. Code state lives under its
 * own storage prefix and is projected by a SEPARATE route. Reading the Worker
 * caught it before a line of UI existed — and this test now holds it there.
 */

const OPS = 'test-ops-rider-codes';
const INTAKE = 'test-intake-rider-codes';
const VERIFY = 'test-verify-rider-codes';

let live: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(live.map((m) => m.dispose()));
  live = [];
});

function spawn(): Miniflare {
  const persist = mkdtempSync(join(tmpdir(), 'rider-codes-'));
  const mf = new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    durableObjects: { LOGISTICS: 'LogisticsDO' },
    durableObjectsPersist: persist,
    bindings: { SERA_OPS_SECRET: OPS, SERA_INTAKE_SECRET: INTAKE, SERA_RIDER_VERIFY_SECRET: VERIFY },
  });
  live.push(mf);
  return mf;
}

/** The console's own port, pointed at the Worker exactly as the browser will. */
function desk(mf: Miniflare, key: string = OPS) {
  const fetchFn = ((url: string, init?: RequestInit) => mf.dispatchFetch(url, init as never)) as never;
  return httpRiderCodes('http://logistics', key, fetchFn);
}

describe('⚠ the founder gives a rider their code — console port, real Worker', () => {
  it('walks register → list → mint → the rider can sign in with what came back', async () => {
    const mf = spawn();
    const port = desk(mf);

    // ── nobody yet: the honest empty desk, not a failure ───────────────────
    const empty = await port.list();
    expect(empty.kind, JSON.stringify(empty)).toBe('ok');
    expect(empty.kind === 'ok' ? empty.value : null).toEqual([]);

    // ── register ───────────────────────────────────────────────────────────
    const reg = await port.register({
      riderId: 'rider-issa',
      displayName: 'Issa',
      phoneAlias: 'alias-issa',
    });
    expect(reg.kind, JSON.stringify(reg)).toBe('ok');

    // ── the desk now shows him, with NO code yet ───────────────────────────
    const before = await port.list();
    expect(before.kind).toBe('ok');
    const rosterBefore = before.kind === 'ok' ? before.value : [];
    expect(rosterBefore.map((r) => r.riderId)).toEqual(['rider-issa']);
    expect(rosterBefore[0]?.hasCode, 'no code has been minted yet').toBe(false);
    // …so the mint warning is the plain one.
    expect(mintAvis(rosterBefore, 'rider-issa')).toBe('pret');

    // ── mint: the plaintext leaves exactly once, here ──────────────────────
    const minted = await port.mint('rider-issa');
    expect(minted.kind, JSON.stringify(minted)).toBe('ok');
    const code = minted.kind === 'ok' ? minted.value : '';
    // The shape the rider app's sign-in screen expects: SR- + three groups.
    expect(code).toMatch(/^SR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // ── ⚠ AND IT ACTUALLY OPENS THE RIDER'S DOOR ──────────────────────────
    // The point of the whole screen. A code the console shows but the rider
    // door refuses would be a screen that lies, and nothing else here would
    // catch it — this is the same seam the rider app's own tests cannot see.
    const verified = await mf.dispatchFetch('http://logistics/verify/rider-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VERIFY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ ok: true, riderId: 'rider-issa' });

    // ── the desk reflects it, from the OTHER route ─────────────────────────
    const after = await port.list();
    const rosterAfter = after.kind === 'ok' ? after.value : [];
    expect(rosterAfter[0]?.hasCode, 'the codes projection must show the live code').toBe(true);
    expect(rosterAfter[0]?.mintedAt).toBeTypeOf('string');
    // …and NOW the warning says a new mint would replace it.
    expect(mintAvis(rosterAfter, 'rider-issa')).toBe('remplace');
  }, 30_000);

  it('⚠ a revoked code stops opening the door, and the desk says so', async () => {
    const mf = spawn();
    const port = desk(mf);
    await port.register({ riderId: 'rider-awa', displayName: 'Awa', phoneAlias: 'alias-awa' });
    const minted = await port.mint('rider-awa');
    const code = minted.kind === 'ok' ? minted.value : '';

    expect((await port.revoke('rider-awa')).kind).toBe('ok');

    const verified = await mf.dispatchFetch('http://logistics/verify/rider-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VERIFY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(verified.status, 'a revoked code must die at the door').toBe(401);

    const after = await port.list();
    expect(after.kind === 'ok' ? after.value[0]?.hasCode : true).toBe(false);
  }, 30_000);

  it('⚠ minting again kills the old code — which is why the desk warns first', async () => {
    const mf = spawn();
    const port = desk(mf);
    await port.register({ riderId: 'rider-issa', displayName: 'Issa', phoneAlias: 'alias-issa' });
    const first = await port.mint('rider-issa');
    const second = await port.mint('rider-issa');
    const oldCode = first.kind === 'ok' ? first.value : '';
    const newCode = second.kind === 'ok' ? second.value : '';
    expect(oldCode).not.toBe(newCode);

    const oldTry = await mf.dispatchFetch('http://logistics/verify/rider-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VERIFY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: oldCode }),
    });
    // A rider mid-course would be locked out of their own custody acts. The
    // « Attention » on the mint form is this fact, said before the tap.
    expect(oldTry.status).toBe(401);
  }, 30_000);

  it('a typo’d rider is refused BY NAME, never minted a phantom door', async () => {
    const mf = spawn();
    const answer = await desk(mf).mint('rider-does-not-exist');
    expect(answer.kind).toBe('refused');
    expect(answer.kind === 'refused' ? answer.reason : '').toBe('unknown_rider');
  }, 30_000);

  it('registering the same rider twice is refused, not silently re-registered', async () => {
    // Re-registering would wipe the privacy acknowledgement.
    const mf = spawn();
    const port = desk(mf);
    const rider = { riderId: 'rider-issa', displayName: 'Issa', phoneAlias: 'alias-issa' };
    expect((await port.register(rider)).kind).toBe('ok');
    const again = await port.register(rider);
    expect(again.kind).toBe('refused');
    expect(again.kind === 'refused' ? again.reason : '').toBe('already_registered');
  }, 30_000);

  it('⚠ CODE-REVU (founder ruling 2026-08-09): the founder rereads the code he already gave — same bytes, door untouched, list says revelable only', async () => {
    // The consuming screen lives in the Boutik+ console (Coursiers tab); this
    // pins the Worker contract that screen's port relies on.
    const mf = spawn();
    const port = desk(mf);
    await port.register({ riderId: 'rider-revu', displayName: 'Revu', phoneAlias: 'alias-revu' });
    const minted = await port.mint('rider-revu');
    const code = minted.kind === 'ok' ? minted.value : '';

    const revu = await mf.dispatchFetch('http://logistics/ops/rider-code/reveal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId: 'rider-revu' }),
    });
    expect(revu.status).toBe(200);
    expect(await revu.json()).toMatchObject({ ok: true, code });

    // The reread is a POINTER READ, never a rotation: the same bytes still
    // open the rider's door afterwards.
    const verified = await mf.dispatchFetch('http://logistics/verify/rider-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VERIFY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(verified.status).toBe(200);

    // The inventory says « Voir le code » can answer — a FLAG, never the bytes.
    const liste = await mf.dispatchFetch('http://logistics/ops/rider-codes', {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    const listeText = await liste.text();
    const rows = (JSON.parse(listeText) as { codes: Record<string, unknown>[] }).codes;
    expect(rows.find((r) => r['riderId'] === 'rider-revu')).toMatchObject({ revelable: true });
    expect(listeText.includes(code)).toBe(false);
  }, 30_000);

  it('⚠ CODE-REVU refusals: founder key only, no_code for a stranger and after revoke', async () => {
    const mf = spawn();
    const port = desk(mf);
    const relire = async (riderId: string, key: string = OPS) => {
      const res = await mf.dispatchFetch('http://logistics/ops/rider-code/reveal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId }),
      });
      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    };

    await port.register({ riderId: 'rider-revu2', displayName: 'Revu2', phoneAlias: 'alias-revu2' });
    await port.mint('rider-revu2');
    expect((await relire('rider-revu2', 'not-the-ops-key')).status).toBe(401);

    const inconnu = await relire('rider-nowhere');
    expect(inconnu.status).toBe(404);
    expect(inconnu.json['reason']).toBe('no_code');

    await port.revoke('rider-revu2');
    const apres = await relire('rider-revu2');
    expect(apres.status, 'revoke kills the pointer — the reread dies with the door').toBe(404);
    expect(apres.json['reason']).toBe('no_code');
  }, 30_000);

  it('⚠ a wrong ops key is BAD_KEY, never an empty roster', async () => {
    // An empty desk under a wrong key would read as « no riders yet » and send
    // the founder registering duplicates of people who already exist.
    const mf = spawn();
    const port = desk(mf);
    await port.register({ riderId: 'rider-issa', displayName: 'Issa', phoneAlias: 'alias-issa' });

    const stranger = desk(mf, 'not-the-ops-key');
    expect((await stranger.list()).kind).toBe('bad_key');
    expect((await stranger.mint('rider-issa')).kind).toBe('bad_key');
    expect((await stranger.revoke('rider-issa')).kind).toBe('bad_key');
  }, 30_000);
});
