import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytesFromBase64 } from '../src/net/evidence-capture';
import { createManualConnectivity } from '../src/offline/connectivity';
import { custodyBegan, httpCustodyActs, mintActId, verificationAccepted, type CustodyAnswer } from '../src/net/custody-acts';

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

describe('⚠ a RECORDED refusal is not a pass (verifier blocker A4)', () => {
  /**
   * Custody records a refused pickup as a first-class custody fact — « no
   * generic failed terminal » — so `custody-do.ts:1219` answers a REFUSED
   * verification with **200 {ok:true, kind:'refused'}**: the same status and
   * the same `ok:true` as an accepted one. Reading only `ok` began custody
   * over goods the rider had just refused.
   */
  const answerFor = async (body: unknown) =>
    httpCustodyActs('https://c.dev', online(), async () => json(body, 200)).verifyPickup(VERIFY, 'CODE');

  it('an accepted verification is accepted', async () => {
    const a = await answerFor({ ok: true, kind: 'accepted', ledgerSeq: 2, chainValid: true });
    expect(a.kind).toBe('recorded');
    expect(verificationAccepted(a)).toBe(true);
  });

  it('⚠ a REFUSED verification is recorded but NOT accepted, and NEVER custody', async () => {
    const a = await answerFor({ ok: true, kind: 'refused', ledgerSeq: 3, chainValid: true });
    // It IS a recorded custody fact — the refusal ladder is first-class.
    expect(a.kind).toBe('recorded');
    // …but the goods were refused: conformity failed, the fault signal is
    // emitted, and custody must not begin (SE-I05; Law 3).
    expect(verificationAccepted(a)).toBe(false);
    expect(custodyBegan(a)).toBe(false);
  });

  it('only a sealed custody transition begins custody, and it says so by name', async () => {
    const sealed = httpCustodyActs('https://c.dev', online(), async () =>
      json({ ok: true, status: 'custody_with_courier', riderId: 'r1' }),
    );
    expect(custodyBegan(await sealed.beginCustody(SEAL, 'CODE'))).toBe(true);
    // A 200 that records something else — anything at all — is not custody.
    for (const body of [{ ok: true }, { ok: true, kind: 'accepted' }, { ok: true, status: 'armed' }]) {
      const other = httpCustodyActs('https://c.dev', online(), async () => json(body, 200));
      expect(`${JSON.stringify(body)} -> ${custodyBegan(await other.beginCustody(SEAL, 'CODE'))}`)
        .toBe(`${JSON.stringify(body)} -> false`);
    }
  });
});

describe('a stalled socket cannot hang the door (verifier blocker A5)', () => {
  it('a request that never resolves is abandoned as unreachable', async () => {
    // React Native fetch has no default timeout; the screen locks the field
    // AND the button while working, so without a deadline the rider's only
    // exit was force-quitting. 50 ms deadline here — the real one is 15 s.
    const port = httpCustodyActs('https://c.dev', online(), (_u, init) =>
      new Promise<Response>((_resolve, reject) => {
        // Never resolves on its own — only the abort signal ends it.
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
      50,
    );
    const answer = await port.beginCustody(SEAL, 'CODE');
    expect(answer).toEqual({ kind: 'unreachable', reason: 'transport' });
  });

  it('passes an abort signal on every request', async () => {
    let sawSignal = false;
    const port = httpCustodyActs('https://c.dev', online(), async (_u, init) => {
      sawSignal = init?.signal !== undefined;
      return json({ ok: true, status: 'custody_with_courier' });
    });
    await port.beginCustody(SEAL, 'CODE');
    expect(sawSignal).toBe(true);
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

describe('⚠ base64 → bytes, because the bucket sniffs MAGIC BYTES (A1)', () => {
  // The camera hands back base64 and the media-service identifies the format
  // from the first bytes. A decoder that is wrong at the head turns every
  // upload into `unsupported_type` on the device only — invisible in CI, fatal
  // at the stall. So it is decoded here, in the file with no native import,
  // and checked against real magic numbers.
  const b64 = (bytes: number[]): string => Buffer.from(Uint8Array.from(bytes)).toString('base64');

  it('reproduces the bytes exactly, at every padding length', () => {
    for (const bytes of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [0, 255, 128, 64, 32]]) {
      expect([...(bytesFromBase64(b64(bytes)) ?? [])], `${bytes.length} bytes`).toEqual(bytes);
    }
  });

  it('gets a JPEG and a PNG header byte-exact', () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect([...(bytesFromBase64(b64(jpeg)) ?? [])]).toEqual(jpeg);
    expect([...(bytesFromBase64(b64(png)) ?? [])]).toEqual(png);
  });

  it('refuses anything malformed rather than uploading rubbish as proof', () => {
    // A photo we cannot decode is no photo — which stops the act, exactly as
    // « no photo, no seal » requires. It must never return partial bytes.
    for (const bad of ['', 'a', 'ab@=', '====', 'AAAA!', 'A']) {
      expect(bytesFromBase64(bad), bad).toBeNull();
    }
  });

  it('tolerates the line breaks some encoders insert', () => {
    const bytes = [1, 2, 3, 4, 5, 6];
    expect([...(bytesFromBase64(b64(bytes).replace(/(.{4})/g, '$1\n')) ?? [])]).toEqual(bytes);
  });
});
