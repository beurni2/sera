import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';
import { custodyWithCustomer, httpCustodyActs } from '../../../apps/rider-app/src/net/custody-acts';
import { httpEvidenceCapture, type PhotoSource } from '../../../apps/rider-app/src/net/evidence-capture';
import { custodyBegan, deliveryChainOf, evidenceHeld, verificationAccepted } from '../../../apps/rider-app/src/net/custody-acts';
import { resizeForEvidence } from '../../../apps/rider-app/src/net/photo-bounds';
import { POLICY_CHECK_IDS } from '../../../apps/rider-app/src/custody-flow';
import { ACTIVE_PICKUP_VERIFICATION_POLICY } from '../src/pickup-verification-policy';

/**
 * ═══ THE RIDER'S WHOLE PATH, WALKED ONCE, THROUGH THE APP'S OWN PORTS ═══
 *
 * ⚠ WHY THIS FILE EXISTS. Three verifier rounds each found a blocker, and all
 * three lived in the SAME seam, which nothing in this repo crossed:
 *
 *   · the rider app's tests drive its ports with an INJECTED FAKE FETCH — they
 *     never touch a Worker;
 *   · the Worker e2e tests call the Workers with RAW `fetch` — they never touch
 *     the app's ports;
 *   · and `App.tsx` was only ever checked by SOURCE SCAN.
 *
 * So « the port works » and « the Worker works » were both proven, and « the
 * rider can take custody » was proven by nobody. Round two: the ports were
 * called by nothing, and 260 tests passed over a dead button. Round three: the
 * photo port was wired and every upload was REFUSED, because the app sent
 * camera-native resolution to a bucket that caps at 2048 — and 274 tests passed
 * over that too.
 *
 * This test walks the real thing: the app's OWN `httpCustodyActs` and
 * `httpEvidenceCapture`, against the REAL custody Worker in miniflare, with a
 * bucket stub that enforces the media-service's ACTUAL bounds. Both round-two
 * and round-three blockers fail here. That is the point — the loop was catching
 * what an integration test should have caught first.
 *
 * ═══ THE BUCKET STUB IS CONTRACT-CERTIFIED (Execution Contract §3) ═══
 *
 * media-service lives in the boutik-plus repo and is not a dependency here, so
 * it cannot be imported. The stub therefore MIRRORS its validation exactly —
 * magic-byte sniff, SOF0 dimension parse, the 2048 ceiling, the 200 floor, the
 * 5 MB cap — with the constants named and pinned. « A mock that hides real
 * timing or failure behaviour is a bug you own »: this one is written to be
 * HARSHER than the app expects, not kinder, and the round-three bug reproduces
 * against it.
 */

const OPS = 'test-custody-ops-rider-path';
const VERIFY_KEY = 'test-rider-verify-rider-path';
const RIDER_CODE = 'SR-PATH-0001-0002';
const RIDER = 'rider-path-0001';
const ORDER = 'ord-path-0001';
const PKG = 'pkg-path-0001';
/** The rider app, from here — the screen whose sentences this file asserts. */
const RIDER_APP = join(import.meta.dirname, '..', '..', '..', 'apps', 'rider-app');
const SEAL = 'SEAL-PATH-0001';

/** media-service `IMAGE_STANDARD_MAX_DIM` / `IMAGE_MIN_DIM` / `IMAGE_MAX_BYTES`. */
const BUCKET_MAX_DIM = 2048;
const BUCKET_MIN_DIM = 200;
const BUCKET_MAX_BYTES = 5 * 1024 * 1024;

/** A byte-valid JPEG whose SOF0 declares the given size — enough for the
 *  sniff + dimension parse the real service performs, which is all it reads. */
function jpegOf(width: number, height: number): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return Uint8Array.from([...head, ...sof, 0xff, 0xd9]);
}

function dimensionsOf(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  return null;
}

/** The bucket, with media-service's real refusals. Returns the same shapes. */
let uploadCount = 0;
const BUCKET_WRITE_KEY = 'test-write-key';
const bucketFetch = async (_url: string, init?: RequestInit): Promise<Response> => {
  uploadCount += 1;
  /**
   * ⚠ THE WRITE GATE, WHICH THIS STUB OMITTED (blocker A2, round four). The
   * real service runs `rejectUnauthorizedWrite` BEFORE it touches storage, and
   * it is fail-closed: an unset secret 401s every upload. Deleting the
   * `X-Write-Key` header from the app was invisible to all 284 tests and the
   * whole gate board — and a 401 maps to « La photo n'est pas partie.
   * Réessayez. », send disabled, no seal, no custody. Round three's failure
   * mode on a different axis. A mock that skips the first thing the service
   * does is §9.8, whatever its header claims.
   */
  const key = new Headers(init?.headers as HeadersInit | undefined).get('X-Write-Key');
  if (key !== BUCKET_WRITE_KEY) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = init?.body as unknown as Uint8Array;
  if (!(body instanceof Uint8Array) || body.length === 0) {
    return Response.json({ reason: 'empty' }, { status: 400 });
  }
  if (body.length > BUCKET_MAX_BYTES) return Response.json({ reason: 'too_large' }, { status: 400 });
  const jpeg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (!jpeg) return Response.json({ reason: 'unsupported_type' }, { status: 400 });
  const dims = dimensionsOf(body);
  if (dims === null) return Response.json({ reason: 'bad_dimensions' }, { status: 400 });
  // ⚠ THE REFUSAL THAT BROKE ROUND THREE. Every phone in this market shoots
  // wider than 2048, and the app was uploading camera-native resolution.
  if (dims.width > BUCKET_MAX_DIM || dims.height > BUCKET_MAX_DIM) {
    return Response.json({ reason: 'bad_dimensions' }, { status: 400 });
  }
  if (dims.width < BUCKET_MIN_DIM || dims.height < BUCKET_MIN_DIM) {
    return Response.json({ reason: 'bad_dimensions' }, { status: 400 });
  }
  return Response.json(
    { ref: `media/tok-${uploadCount}`, contentType: 'image/jpeg', width: dims.width, height: dims.height, byteLength: body.length },
    { status: 201 },
  );
};

/**
 * The camera, standing in for `expoPhotoSource`. It returns what a REAL handset
 * returns — a full-resolution sensor image — and then applies the same resize
 * decision the device binding applies. If that decision is wrong or missing,
 * the bucket refuses, exactly as it does on a phone.
 */
function cameraOf(width: number, height: number, applyResize: boolean): PhotoSource {
  return {
    async capture(): Promise<Uint8Array | null> {
      if (!applyResize) return jpegOf(width, height);
      const resize = resizeForEvidence(width, height);
      if (resize === null) return jpegOf(width, height);
      const scale = resize.width !== undefined ? resize.width / width : (resize.height as number) / height;
      return jpegOf(Math.round(width * scale), Math.round(height * scale));
    },
  };
}

const online = { current: () => 'online' as const };

const PICKUP_CODE = 'PICKUP-PATH-0001';

/**
 * ⚠ THE CHECKLIST IS TAKEN FROM BOTH SIDES AND COMPARED, NOT TYPED OUT HERE.
 * My first draft of this file invented nine plausible check names and the
 * Worker answered `check_not_in_policy` — which is precisely the class of
 * cross-boundary drift this file exists to catch. The app renders its checklist
 * from `POLICY_CHECK_IDS`; the SERVICE judges against the ACTIVE policy's
 * checks (v2 since the founder's 2026-08-09 ruling — three photo-referenced
 * questions). If those two lists ever diverge, every verification a rider
 * sends is refused, and nothing else in the repo compares them.
 */
const ALL_PASS = Object.fromEntries(POLICY_CHECK_IDS.map((id) => [id, true]));

const dir = mkdtempSync(join(tmpdir(), 'sera-rider-path-'));
let mf: Miniflare | undefined;

afterAll(async () => {
  await mf?.dispose();
  rmSync(dir, { recursive: true, force: true });
});

/** Custody, with logistics stubbed at the SAME seam the real binding uses: it
 *  answers « is this code this rider's, right now », over the verify key. */
function boot(): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: 'dist-worker/worker.mjs',
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: dir,
    serviceBindings: {
      LOGISTICS: async (request: Request): Promise<Response> => {
        if ((request.headers.get('Authorization') ?? '') !== `Bearer ${VERIFY_KEY}`) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        return String(body?.['code'] ?? '') === RIDER_CODE
          ? Response.json({ ok: true, riderId: RIDER })
          : Response.json({ error: 'unauthorized' }, { status: 401 });
      },
    },
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS, SERA_RIDER_VERIFY_SECRET: VERIFY_KEY },
  });
}

async function ops(m: Miniflare, path: string, body: unknown): Promise<number> {
  const res = await m.dispatchFetch(`http://custody${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

/** The dispatcher's own preparation: the order opened and both secrets armed. */
async function openOrder(m: Miniflare): Promise<void> {
  expect(await ops(m, '/ops/order/open', {
    orderId: ORDER, taskId: 'task-path', packageId: PKG, correlationId: 'corr-path', supplierId: 'sup-path',
  })).toBe(200);
  for (const [kind, secret] of [['pickup_verification_code', PICKUP_CODE], ['custody_seal', SEAL]] as const) {
    expect(await ops(m, '/ops/secrets/arm', { orderId: ORDER, command_id: `arm-${kind}`, kind, secret })).toBe(200);
  }
}

/** The app's ports, pointed at the real Worker through miniflare's dispatch. */
function riderPorts(m: Miniflare) {
  const fetchFn = ((url: string, init?: RequestInit) =>
    m.dispatchFetch(url, init as never)) as unknown as typeof globalThis.fetch;
  return httpCustodyActs('http://custody', online, fetchFn as never);
}

describe('⚠ THE RIDER TAKES CUSTODY — the app’s own ports, the real Worker', () => {
  it('⚠ the app’s checklist IS the service’s policy, id for id and in order', () => {
    // Drift here refuses every verification a rider sends, with
    // `check_not_in_policy` — and until this line, the app's list and the
    // service's list were two independent literals that nothing compared.
    //
    // ⚠ It compares against the ACTIVE policy, not a named version: the day
    // the founder rules a v3, this pin must fail on the app that still asks
    // v2's questions. Pinning V1 by name would have gone quietly green
    // through exactly the change that made the app's checklist wrong.
    expect([...POLICY_CHECK_IDS]).toEqual([...ACTIVE_PICKUP_VERIFICATION_POLICY.checks]);
    // …and the ruling's own shape: three questions, not nine fields.
    expect(POLICY_CHECK_IDS).toHaveLength(3);
  });

  it('walks photo → verification → seal → custody, and the LEDGER says so', async () => {
    mf = boot();
    await openOrder(mf);
    const acts = riderPorts(mf);

    // A real 8 MP rear camera — the handset class a Séra rider carries.
    const evidence = httpEvidenceCapture(
      'https://bucket.invalid', BUCKET_WRITE_KEY,
      cameraOf(3264, 2448, true), online, bucketFetch as never,
    );

    const shot = await evidence.captureAndUpload();
    expect(shot.ok, `the bucket refused the photo: ${JSON.stringify(shot)}`).toBe(true);
    const ref = shot.ok ? shot.ref : '';
    expect(ref).toMatch(/^media\//);

    const verified = await acts.verifyPickup(
      {
        commandId: 'cmd-path-verify-1', orderId: ORDER,
        presentedPickupCode: PICKUP_CODE, evidenceBundleId: ref,
        dwellSec: 150, checkResults: ALL_PASS,
      },
      RIDER_CODE,
    );
    expect(verificationAccepted(verified), `verification not accepted: ${JSON.stringify(verified)}`).toBe(true);

    const sealShot = await evidence.captureAndUpload();
    expect(sealShot.ok).toBe(true);
    const began = await acts.beginCustody(
      {
        commandId: 'cmd-path-seal-1', orderId: ORDER,
        custodySealId: SEAL, sealPhotoRefs: sealShot.ok ? [sealShot.ref] : [],
      },
      RIDER_CODE,
    );
    // SE-I05 — « Custody begins only after rider pickup verification AND
    // custody-seal registration. » The assertion this whole slice exists to
    // make true, and until this file nothing in the repo made it.
    expect(custodyBegan(began), `custody did not begin: ${JSON.stringify(began)}`).toBe(true);

    // …and the LEDGER, not the response, names this rider as custodian.
    const led = await mf.dispatchFetch(`http://custody/ops/ledger?orderId=${ORDER}`, {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    expect(String(((await led.json()) as Record<string, unknown>)['currentCustodian'] ?? ''))
      .toBe(`courier:${RIDER}`);
  }, 30_000);

  it('⚠ ROUTE-DIRECTE — custody begins with NO PHOTO, on the app’s own port, and the LEDGER says so', async () => {
    /**
     * FOUNDER RULING (2026-08-10): « terminate that sealing code and the
     * sealing photo proof requirement … photo capture is optional and only
     * required when one the 3 answers is non. »
     *
     * THIS IS THE SEAM THE RULING CROSSES. The app sends `sealPhotoRefs: []`;
     * the real Worker's door parses it; the real spine decides. Until this
     * test, « the guard was lifted » was a source edit nothing exercised —
     * and a door that rejects an empty array before the spine ever sees it
     * would have left every rider stuck at the seal with 394 tests green.
     *
     * It asks the LEDGER, not the response.
     */
    const m2 = new Miniflare({
      modules: true,
      scriptPath: 'dist-worker/worker.mjs',
      compatibilityDate: '2025-07-05',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
      durableObjectsPersist: mkdtempSync(join(tmpdir(), 'sera-route-directe-')),
      serviceBindings: {
        LOGISTICS: async (request: Request): Promise<Response> => {
          if ((request.headers.get('Authorization') ?? '') !== `Bearer ${VERIFY_KEY}`) {
            return Response.json({ error: 'unauthorized' }, { status: 401 });
          }
          const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
          return String(body?.['code'] ?? '') === RIDER_CODE
            ? Response.json({ ok: true, riderId: RIDER })
            : Response.json({ error: 'unauthorized' }, { status: 401 });
        },
      },
      bindings: { SERA_CUSTODY_OPS_SECRET: OPS, SERA_RIDER_VERIFY_SECRET: VERIFY_KEY },
    });
    const O = 'ord-route-directe';
    const P = 'pkg-route-directe';
    const CODE = 'PICKUP-ROUTE-DIRECTE';
    const opsTo = async (path: string, body: unknown): Promise<number> =>
      (await m2.dispatchFetch(`http://custody${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })).status;
    expect(await opsTo('/ops/order/open', {
      orderId: O, taskId: 'task-rd', packageId: P, correlationId: 'corr-rd', supplierId: 'sup-rd',
    })).toBe(200);
    expect(await opsTo('/ops/secrets/arm', {
      orderId: O, command_id: 'arm-rd-pickup', kind: 'pickup_verification_code', secret: CODE,
    })).toBe(200);

    const acts = httpCustodyActs('http://custody', online, ((url: string, init?: RequestInit) =>
      m2.dispatchFetch(url, init as never)) as unknown as typeof globalThis.fetch as never);

    // The checklist, all three conforming — so by his ruling NO camera was
    // ever offered, and the app has no photo to send.
    const verified = await acts.verifyPickup(
      { commandId: 'rd-verify', orderId: O, presentedPickupCode: CODE, evidenceBundleId: 'sans-photo', dwellSec: 150, checkResults: ALL_PASS },
      RIDER_CODE,
    );
    expect(verificationAccepted(verified), JSON.stringify(verified)).toBe(true);

    // ⚠ THE MACHINE-CARRIED SEAL, WITH AN EMPTY PHOTO LIST. Never pre-armed
    // here — this is the first-use binding path the rider actually walks.
    const began = await acts.beginCustody(
      { commandId: 'rd-seal', orderId: O, custodySealId: 'SC-4K7M-9PQR', sealPhotoRefs: [] },
      RIDER_CODE,
    );
    expect(custodyBegan(began), `custody refused a photo-free seal: ${JSON.stringify(began)}`).toBe(true);

    // ── ASK THE LEDGER ────────────────────────────────────────────────────
    const led = await m2.dispatchFetch(`http://custody/ops/ledger?orderId=${O}`, {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    expect(String(((await led.json()) as Record<string, unknown>)['currentCustodian'] ?? ''))
      .toBe(`courier:${RIDER}`);

    // …and SE-I05's surviving half still bites: the seal is single-use, so a
    // second course cannot ride this one.
    const again = await acts.beginCustody(
      { commandId: 'rd-seal-2', orderId: O, custodySealId: 'SC-4K7M-9PQR', sealPhotoRefs: [] },
      RIDER_CODE,
    );
    expect(custodyBegan(again), 'a spent seal must not begin custody twice').toBe(false);

    await m2.dispose();
  }, 30_000);

  it('⚠ an unauthenticated upload is refused, and then no act can go', async () => {
    // The founder rotates MEDIA_WRITE_SECRET and the repo key is not updated —
    // or is simply never set, which is fail-closed by design. Every rider on
    // the channel: camera opens, bytes upload, 401, send disabled, custody
    // never begins.
    const wrongKey = httpEvidenceCapture(
      'https://bucket.invalid', 'the-wrong-key',
      cameraOf(3264, 2448, true), online, bucketFetch as never,
    );
    const shot = await wrongKey.captureAndUpload();
    expect(shot.ok).toBe(false);
    /**
     * ⚠ FOUNDER REPORT (2026-08-10) — « the sera screen got stuck at votre
     * course asking me to take a picture ». THIS TEST DESCRIBED HIS BUG A WEEK
     * EARLY AND THEN PINNED THE WRONG ANSWER AS CORRECT.
     *
     * A 401 used to fall through to `unreachable`, which the screen renders as
     * « La photo n'est pas partie. Réessayez. » — and he did, standing at a
     * stall, for as long as he was willing to. Retrying cannot fix a key
     * mismatch: it is the same 401 every time, for ever.
     *
     * `refused_key` is its own outcome now, and it carries the one true
     * instruction: this is not your phone, call Séra.
     */
    expect(shot.ok === false ? shot.reason : '').toBe('refused_key');
  });

  it('⚠ …and the rider READS the true sentence, not « Réessayez »', () => {
    /**
     * The outcome only matters if the screen says the right thing. `App.tsx`'s
     * `captureIssueKey` is the one mapping from outcome → catalog key, and the
     * catalog is the one place the words live: both are asserted here, so a
     * new outcome with no sentence — or a sentence that tells a rider to keep
     * tapping — fails rather than shipping.
     */
    const app = readFileSync(join(RIDER_APP, 'App.tsx'), 'utf8');
    expect(app).toContain("if (issue.reason === 'refused_key') return 'photo.cle_refusee';");
    const catalog = JSON.parse(readFileSync(join(RIDER_APP, 'i18n/catalog.json'), 'utf8')) as { key: string; fr: string }[];
    const phrase = catalog.find((e) => e.key === 'photo.cle_refusee');
    expect(phrase, 'the outcome has no sentence — the rider would see a crash, not a state').toBeDefined();
    expect(phrase?.fr, 'it must send the rider to Séra').toContain('Séra');
    // The whole point: never the advice that cannot come true.
    expect(phrase?.fr.toLowerCase()).not.toContain('réessayez');
  });

  it('⚠ REPRODUCES ROUND THREE: with no device resize the bucket refuses, and the seal cannot go', async () => {
    // The shipped bug, exactly. `quality` is compression, not a resize, so the
    // app uploaded 3264×2448 and media-service answered `400 bad_dimensions`.
    // The screen said « Reprenez-la. » and retaking gave the same answer for
    // ever — the send stayed disabled and custody could never begin.
    const unresized = httpEvidenceCapture(
      'https://bucket.invalid', BUCKET_WRITE_KEY,
      cameraOf(3264, 2448, false), online, bucketFetch as never,
    );
    const shot = await unresized.captureAndUpload();
    expect(shot.ok).toBe(false);
    expect(shot.ok === false ? shot.reason : '').toBe('rejected');
    expect(shot.ok === false && shot.reason === 'rejected' ? shot.detail : '').toBe('bad_dimensions');
  });

  it('⚠ a REFUSED verification is recorded, never mistaken for an acceptance', async () => {
    // The Worker answers a refusal with `200 {ok:true, kind:'refused'}` — the
    // same shape as an acceptance. Anything reading HTTP 200 as « accepted »
    // walks a rider into custody of goods the ledger leaves with the seller.
    const m = boot();
    const ORDER2 = `${ORDER}-refused`;
    expect(await ops(m, '/ops/order/open', {
      orderId: ORDER2, taskId: 't2', packageId: `${PKG}-2`, correlationId: 'c2', supplierId: 'sup-path',
    })).toBe(200);
    expect(await ops(m, '/ops/secrets/arm', {
      orderId: ORDER2, command_id: 'arm-p2', kind: 'pickup_verification_code', secret: PICKUP_CODE,
    })).toBe(200);

    const acts = riderPorts(m);
    const answer = await acts.verifyPickup(
      {
        commandId: 'cmd-path-verify-refused', orderId: ORDER2,
        presentedPickupCode: PICKUP_CODE, evidenceBundleId: 'media/tok-refused',
        dwellSec: 150, checkResults: { ...ALL_PASS, emballage_intact: false },
      },
      RIDER_CODE,
    );
    expect(answer.kind, `expected a recorded answer, got ${JSON.stringify(answer)}`).toBe('recorded');
    expect(verificationAccepted(answer), 'a refusal must never read as accepted').toBe(false);
    await m.dispose();
  }, 30_000);
});

/**
 * ═══ SE-LIVE-5c — THE RIDER DELIVERS, through the app's OWN port ═══
 *
 * SE-I05: « Delivery requires assigned session + `buyerDropCode` + same
 * custody seal + evidence » · §63: the code is entered LAST, on the rider's
 * device; « evidence supports, never releases ». The DECISION is deliberately
 * NOT the rider's: the rider door answers 404 for it, proven below.
 */
describe('SE-LIVE-5c — the rider’s delivery acts, the real Worker, the ledger’s word', () => {
  const ORDER3 = `${ORDER}-livraison`;
  const DROP = 'DROP-PATH-9042';

  it('evidence → (founder decides) → drop code LAST; the ledger hands custody to the customer', async () => {
    const m = boot();
    expect(await ops(m, '/ops/order/open', {
      orderId: ORDER3, taskId: 'task-liv3', packageId: `${PKG}-liv`, correlationId: `corr-${ORDER3}`, supplierId: 'sup-path',
    })).toBe(200);
    for (const [kind, secret] of [
      ['pickup_verification_code', PICKUP_CODE],
      ['custody_seal', SEAL],
      ['buyer_drop_code', DROP],
    ] as const) {
      expect(await ops(m, '/ops/secrets/arm', { orderId: ORDER3, command_id: `arm3-${kind}`, kind, secret })).toBe(200);
    }
    const acts = riderPorts(m);
    expect(verificationAccepted(await acts.verifyPickup(
      { commandId: 'cmd-liv3-verify', orderId: ORDER3, presentedPickupCode: PICKUP_CODE,
        evidenceBundleId: 'media/tok-liv3', dwellSec: 150, checkResults: ALL_PASS },
      RIDER_CODE,
    ))).toBe(true);
    const began = await acts.beginCustody(
      { commandId: 'cmd-liv3-seal', orderId: ORDER3, custodySealId: SEAL, sealPhotoRefs: ['media/tok-liv3-seal'] },
      RIDER_CODE,
    );
    expect(custodyBegan(began)).toBe(true);
    /**
     * RIDER-DELIVERY-SCREEN — the BEGIN answer names the chain the phone now
     * holds. This is the ONLY rider-reachable place the task and package ids
     * exist, and the evidence bundle below is composed FROM IT — the exact
     * road the app's screen drives, not a literal the phone could never know.
     */
    const chain = deliveryChainOf(began);
    expect(chain).toEqual({ taskId: 'task-liv3', packageId: `${PKG}-liv` });

    // ── the rider door does NOT open the decision — 404, indistinguishable
    //    from a route that never existed (the allowlist's whole point) ──────
    const decide = await m.dispatchFetch('http://custody/rider/delivery/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RIDER_CODE}` },
      body: JSON.stringify({ orderId: ORDER3, command_id: 'cmd-liv3-rider-decide' }),
    });
    expect(decide.status, 'a carrier must never validate their own delivery').toBe(404);

    // ── the handoff evidence, through the app's own port ───────────────────
    const evidence = await acts.submitDeliveryEvidence(
      { commandId: 'cmd-liv3-evidence', orderId: ORDER3, custodySealId: SEAL,
        taskId: chain!.taskId, packageId: chain!.packageId,
        artifacts: [{ ref: 'media/tok-liv3-door', sha256: 'b'.repeat(64), mimeType: 'image/jpeg' }],
        capturedAt: '2026-08-08T18:00:00.000Z' },
      RIDER_CODE,
    );
    expect(evidence.kind, JSON.stringify(evidence)).toBe('recorded');
    expect(evidenceHeld(evidence), 'the Worker’s own word: evidence_recorded').toBe(true);

    // ── the founder's decision, via HIS door ───────────────────────────────
    expect(await ops(m, '/ops/delivery/decide', { orderId: ORDER3, command_id: 'cmd-liv3-decide' })).toBe(200);

    // ── the buyer's code, LAST, on the rider's device ──────────────────────
    const wrong = await acts.confirmDrop(
      { commandId: 'cmd-liv3-drop-wrong', orderId: ORDER3, dropCode: 'PAS-LE-CODE' },
      RIDER_CODE,
    );
    expect(wrong.kind).toBe('refused');
    expect(custodyWithCustomer(wrong)).toBe(false);
    const dropped = await acts.confirmDrop(
      { commandId: 'cmd-liv3-drop', orderId: ORDER3, dropCode: DROP },
      RIDER_CODE,
    );
    expect(custodyWithCustomer(dropped), JSON.stringify(dropped)).toBe(true);

    // ── the LEDGER, not the response ───────────────────────────────────────
    const led = await m.dispatchFetch(`http://custody/ops/ledger?orderId=${ORDER3}`, {
      headers: { Authorization: `Bearer ${OPS}` },
    });
    expect(String(((await led.json()) as Record<string, unknown>)['currentCustodian'] ?? '')).toBe('customer');
    await m.dispose();
  }, 30_000);
});
