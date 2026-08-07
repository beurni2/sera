import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../src/offline/connectivity';
import { custodyBegan, httpCustodyActs, mintActId, type CustodyAnswer } from '../src/net/custody-acts';

/**
 * SE-LIVE-4c-iii · the rider's two custody acts.
 *
 * These are the acts SE-I05 gates custody on, so the tests are written against
 * the LAWS, not the happy path:
 *   · custody begins ONLY on a recorded server answer (Law 7 / SE-I06);
 *   · a custody SECRET never rests on the phone (the offline door is closed);
 *   · the identity comes from the door, so no `riderId` is ever sent;
 *   · the phone's clock never dates a custody transition.
 */

const online = () => createManualConnectivity('online');
const offline = () => createManualConnectivity('offline');
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const VERIFY = {
  commandId: mintActId(),
  orderId: 'ord-1',
  presentedPickupCode: 'PICKUP-SECRET-1',
  evidenceBundleId: 'ev-1',
  dwellSec: 150,
  checkResults: { order_ref: true, identity: true } as const,
};
const SEAL = {
  commandId: mintActId(),
  orderId: 'ord-1',
  custodySealId: 'SEAL-SECRET-1',
  sealPhotoRefs: ['photo-1.jpg'],
};

describe('custody begins only when the ledger says so', () => {
  it('a recorded seal is the only thing that begins custody', async () => {
    const port = httpCustodyActs('https://custody.dev', online(), async () =>
      json({ ok: true, status: 'custody_with_courier', riderId: 'rider-1' }),
    );
    const answer = await port.beginCustody(SEAL, 'SR-ABCD-EFGH-JKMN');
    expect(answer.kind).toBe('recorded');
    expect(custodyBegan(answer)).toBe(true);
  });

  it('NOTHING else begins custody — not offline, not a refusal, not a dead server', async () => {
    // Law 7: queued = pending, never done; never final custody offline.
    const answers: CustodyAnswer[] = [
      { kind: 'offline' },
      { kind: 'unauthorized' },
      { kind: 'unreachable' },
      { kind: 'unreachable', reason: 'custody_object_unavailable' },
      { kind: 'refused', reason: 'seal_already_used' },
      { kind: 'refused', reason: 'rider_did_not_verify_this_pickup' },
      { kind: 'refused', reason: 'package_claim_not_held' },
    ];
    for (const a of answers) {
      expect(`${a.kind}/${'reason' in a ? a.reason : ''} -> ${custodyBegan(a)}`).toBe(
        `${a.kind}/${'reason' in a ? a.reason : ''} -> false`,
      );
    }
  });

  it('a duplicate is recorded but flagged — a replay is not a second custody', async () => {
    const port = httpCustodyActs('https://custody.dev', online(), async () =>
      json({ ok: true, status: 'custody_with_courier', duplicate: true }),
    );
    const answer = await port.beginCustody(SEAL, 'CODE');
    expect(answer).toMatchObject({ kind: 'recorded', duplicate: true });
    // It still means custody is held — custody replayed its own recorded fact.
    expect(custodyBegan(answer)).toBe(true);
  });
});

describe('a custody secret never rests on this phone', () => {
  it('offline: the act is refused, and NOTHING is sent', async () => {
    let called = 0;
    const port = httpCustodyActs('https://custody.dev', offline(), async () => {
      called += 1;
      return json({ ok: true });
    });
    expect(await port.verifyPickup(VERIFY, 'CODE')).toEqual({ kind: 'offline' });
    expect(await port.beginCustody(SEAL, 'CODE')).toEqual({ kind: 'offline' });
    expect(called).toBe(0);
  });

  it('no module on this path can persist anything', () => {
    // The outbox writes its payload to the document store — right for a photo,
    // wrong for a live pickup code and seal id. This is the standing guard.
    const src = readFileSync(join(import.meta.dirname, '..', 'src/net/custody-acts.ts'), 'utf8');
    expect(src, 'imports the outbox').not.toMatch(/from\s+'.*\/outbox'/);
    expect(src, 'imports the document store').not.toMatch(/from\s+'.*documentStore'/);
    expect(src, 'imports the evidence queue').not.toMatch(/from\s+'.*\/evidence'/);
    expect(src, 'writes a file').not.toMatch(/writeAsStringAsync|FileSystem\./);
    expect(src, 'touches device storage').not.toMatch(/AsyncStorage|SecureStore/);
    expect(src, 'logs').not.toMatch(/\bconsole\.\w+\s*\(/);
  });
});

describe('the act says exactly what custody expects, and nothing more', () => {
  async function capture(run: (p: ReturnType<typeof httpCustodyActs>) => Promise<unknown>) {
    const seen: { url?: string | undefined; auth?: string | undefined; body?: Record<string, unknown> | undefined } = {};
    const port = httpCustodyActs('https://custody.dev/', online(), async (url, init) => {
      seen.url = url;
      seen.auth = new Headers(init?.headers).get('Authorization') ?? undefined;
      seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ ok: true });
    });
    await run(port);
    return seen;
  }

  it('posts the verification to the rider door with the rider code as Bearer', async () => {
    const seen = await capture((p) => p.verifyPickup(VERIFY, 'SR-ABCD-EFGH-JKMN'));
    expect(seen.url).toBe('https://custody.dev/rider/verification');
    expect(seen.auth).toBe('Bearer SR-ABCD-EFGH-JKMN');
    expect(seen.body).toMatchObject({
      orderId: 'ord-1',
      command_id: VERIFY.commandId,
      presentedPickupCode: 'PICKUP-SECRET-1',
      evidenceBundleId: 'ev-1',
      dwellSec: 150,
    });
  });

  it('posts the seal to the rider door, never the ops door', async () => {
    const seen = await capture((p) => p.beginCustody(SEAL, 'CODE'));
    expect(seen.url).toBe('https://custody.dev/rider/custody/begin');
    expect(String(seen.url)).not.toContain('/ops/');
    expect(seen.body).toMatchObject({ custodySealId: 'SEAL-SECRET-1', sealPhotoRefs: ['photo-1.jpg'] });
  });

  it('⚠ never sends a riderId — the door supplies the identity', async () => {
    // On /rider/* custody resolves the rider from logistics and IGNORES the
    // body. A riderId here would be meaningless at best, and an attempt to
    // record someone else's hand at worst (the 4b blocker A2).
    for (const seen of [
      await capture((p) => p.verifyPickup(VERIFY, 'CODE')),
      await capture((p) => p.beginCustody(SEAL, 'CODE')),
    ]) {
      expect(Object.keys(seen.body ?? {})).not.toContain('riderId');
    }
  });

  it("⚠ never sends `at` — the phone's clock cannot date a custody transition", async () => {
    // Custody stamps its own clock when the field is absent. A cheap handset's
    // clock is wrong by hours and the rider can set it. (JOURNAL « B6 ».)
    for (const seen of [
      await capture((p) => p.verifyPickup(VERIFY, 'CODE')),
      await capture((p) => p.beginCustody(SEAL, 'CODE')),
    ]) {
      expect(Object.keys(seen.body ?? {})).not.toContain('at');
    }
  });

  it('the secrets travel in the body over TLS, never in the URL', async () => {
    for (const seen of [
      await capture((p) => p.verifyPickup(VERIFY, 'CODE')),
      await capture((p) => p.beginCustody(SEAL, 'CODE')),
    ]) {
      expect(seen.url).not.toContain('PICKUP-SECRET-1');
      expect(seen.url).not.toContain('SEAL-SECRET-1');
      expect(seen.url).not.toContain('CODE');
    }
  });
});

describe('a refusal, a dead server and a dead code are three different answers', () => {
  const answerFor = async (body: unknown, status: number): Promise<CustodyAnswer> =>
    httpCustodyActs('https://c.dev', online(), async () => json(body, status)).beginCustody(SEAL, 'CODE');

  it("custody's own refusals come back by name, so the screen can speak plainly", async () => {
    for (const reason of [
      'seal_already_used',
      'rider_did_not_verify_this_pickup',
      'package_claim_not_held',
      'pickup_code_refused',
    ]) {
      expect(await answerFor({ ok: false, reason }, 409)).toEqual({ kind: 'refused', reason });
    }
  });

  it('a 401 is the code, not the package', async () => {
    expect(await answerFor({ error: 'unauthorized' }, 401)).toEqual({ kind: 'unauthorized' });
  });

  it('the door being unable to reach the object is NOT a custody refusal', async () => {
    // 503 custody_object_unavailable / rider_directory_unavailable. Retrying
    // the SAME command_id is safe and correct; calling it a refusal would send
    // a rider away from a package they should be sealing.
    expect(await answerFor({ ok: false, reason: 'custody_object_unavailable' }, 503)).toEqual({
      kind: 'unreachable',
      reason: 'custody_object_unavailable',
    });
    expect(await answerFor({ ok: false, reason: 'rider_directory_unavailable' }, 503)).toEqual({
      kind: 'unreachable',
      reason: 'rider_directory_unavailable',
    });
  });

  it('a transport failure is unreachable, never a refusal', async () => {
    const port = httpCustodyActs('https://c.dev', online(), async () => {
      throw new Error('socket died');
    });
    expect(await port.beginCustody(SEAL, 'CODE')).toEqual({ kind: 'unreachable', reason: 'transport' });
  });

  it('a 200 we cannot read is not a recorded act', async () => {
    const port = httpCustodyActs('https://c.dev', online(), async () => new Response('<html>', { status: 200 }));
    const answer = await port.beginCustody(SEAL, 'CODE');
    expect(answer).toEqual({ kind: 'unreachable', reason: 'unreadable_answer' });
    expect(custodyBegan(answer)).toBe(false);
  });

  it('a 200 whose body is not ok:true is a refusal, not a success', async () => {
    const answer = await answerFor({ ok: false, reason: 'no_evidence_refs' }, 200);
    expect(answer).toEqual({ kind: 'refused', reason: 'no_evidence_refs' });
    expect(custodyBegan(answer)).toBe(false);
  });
});

describe('one act, one identity', () => {
  it('mints distinct ids, and the SAME id is reused across a retry', async () => {
    expect(mintActId()).not.toBe(mintActId());
    const act = { ...SEAL, commandId: mintActId() };
    const sent: string[] = [];
    const port = httpCustodyActs('https://c.dev', online(), async (_u, init) => {
      sent.push(String((JSON.parse(String(init?.body)) as Record<string, unknown>)['command_id']));
      return json({ ok: false, reason: 'x' }, 503);
    });
    await port.beginCustody(act, 'CODE');
    await port.beginCustody(act, 'CODE'); // the retry after a 503
    // Custody dedupes on command_id and replays its recorded answer, so a
    // retry can never produce a second custody transition.
    expect(sent).toEqual([act.commandId, act.commandId]);
  });
});
