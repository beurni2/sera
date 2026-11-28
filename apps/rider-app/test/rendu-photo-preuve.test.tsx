import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route, type Screen, type Wire } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';
import { freshCourse, logistiqueCourse } from './doubles/logistique-course';
import { armerManipulateur, journalManipulateur, octetsBornes, sauvegardesManipulateur } from './doubles/expo-image-manipulator';
import { armerAppareil, lancementsAppareil } from './doubles/expo-image-picker';

/**
 * ═══ RENDU-RÉEL — the rider's proof photo, taken on the real screen ═══
 *
 * The only photo a rider takes is at the stall, when a check is answered
 * « Non » (founder ruling 2026-08-09: offered, never demanded). Until this
 * file no walk had ever pressed « Prendre la photo »; the walks only proved it
 * was ABSENT where nothing was wrong.
 *
 * What is held here, on the real screen and the app's real ports:
 *  · the photo that leaves fits PERF-BUDGETS « 3 photos ≤ 300 KB each » —
 *    307 200 B, written as the canon's number, never read from the app;
 *  · the bytes that leave are the very save the phone made, not a re-encode;
 *  · at the legibility floor the photo leaves anyway — a byte budget never
 *    blocks the rider;
 *  · while the photo is being made and sent the screen says so, and a second
 *    tap cannot start a second camera; after a good shot the send is
 *    reachable, after a failed one the camera comes back with the reason.
 *
 * Only native boundaries are doubled (the camera sheet, the manipulator, each
 * with its bounds at its top) and only `fetch` is faked. The media service is
 * not in this repository; its stand-in below refuses exactly what it refuses.
 */

const BUDGET = 307_200;
const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-photo-1';
const MEDIA_KEY = 'cle-ecriture-rendu';

/**
 * ═══ THE MEDIA SERVICE'S STAND-IN — never kinder than the service ═══
 *
 * Certified to Boutik+ `services/media-service` at d1ecbbe: the write gate
 * answers 401 for a wrong key; `ProductMediaService.upload` (`src/media.ts`
 * l.596-608) refuses, IN THIS ORDER, an empty body, a body over 5 MiB
 * (l.43), bytes that are not JPEG or PNG by their magic, a JPEG whose frame
 * size cannot be read (`imageDimensions`, l.161-180, copied below), and a
 * side over 2048 or under 200 (l.41-42) — each as `400 { error: 'rejected',
 * reason }`; a stored photo answers `201 { ref, contentType, width, height,
 * byteLength, thumbToken }` (`worker/index.ts` l.472-477). It can be HELD, so
 * a walk can look at the screen while the upload is in flight, and can drop
 * the connection, as a stall's network does.
 */
interface Media {
  readonly bodies: Uint8Array[];
  readonly refs: string[];
  gate: Promise<void> | null;
  open: () => void;
  coupe: boolean;
}

function sofDe(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  return null;
}

function refusee(reason: string): Response {
  return new Response(JSON.stringify({ error: 'rejected', reason }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

function brancherMedia(): Media {
  const m: Media = { bodies: [], refs: [], gate: null, open: () => undefined, coupe: false };
  const inner = globalThis.fetch as (input: string, init?: RequestInit) => Promise<Response>;
  (globalThis as { fetch: unknown }).fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.host !== 'media.test' || url.pathname !== '/media' || init?.method !== 'POST') return inner(input, init);
    const raw = init.body as unknown;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(0);
    m.bodies.push(bytes);
    if (m.gate !== null) await m.gate;
    if (m.coupe) throw new TypeError('Network request failed');
    if ((init.headers as Record<string, string> | undefined)?.['X-Write-Key'] !== MEDIA_KEY) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
    if (bytes.length === 0) return refusee('empty');
    if (bytes.length > 5 * 1024 * 1024) return refusee('too_large');
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!jpeg) return refusee('unsupported_type');
    const dims = sofDe(bytes);
    if (dims === null) return refusee('bad_dimensions');
    if (dims.width > 2048 || dims.height > 2048 || dims.width < 200 || dims.height < 200) return refusee('bad_dimensions');
    const ref = `media/0b6f2c1e-3d4a-4b5c-8d9e-${String(m.refs.length).padStart(12, '0')}`;
    m.refs.push(ref);
    return new Response(
      JSON.stringify({ ref, contentType: 'image/jpeg', width: dims.width, height: dims.height, byteLength: bytes.length, thumbToken: `tt-${m.refs.length}` }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  };
  return m;
}

/** Hold the next upload until `open()` — the screen is looked at meanwhile. */
function tenir(m: Media): void {
  m.gate = new Promise<void>((resolve) => {
    m.open = () => {
      m.gate = null;
      resolve();
    };
  });
}

/**
 * Custody's answer to the pickup check — certified to custody-spine
 * `verifyPickup` as `rendu-colis` holds it: a « Non » anywhere is a recorded
 * refusal (`kind: 'refused'`), all « Oui » is `accepted`.
 */
const custody: Route = (path, body) => {
  if (path !== '/rider/verification') return null;
  const checks = body?.['checkResults'] as Record<string, unknown> | undefined;
  const refused = checks === undefined || Object.values(checks).some((v) => v !== true);
  return { status: 200, json: { ok: true, kind: refused ? 'refused' : 'accepted', ledgerSeq: 1, chainValid: true } };
};

/**
 * The photo chain runs on real promises — the upload's SHA-256 is Node's own
 * WebCrypto, which completes outside the microtask queue — so this walk keeps
 * real timers and waits, bounded, for what the rider would wait for.
 */
async function jusqua(s: Screen, ok: () => boolean, quoi: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (ok()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`never reached: ${quoi}. On screen: ${JSON.stringify(s.texts())}`);
}

/** Signed in, course accepted, the three checks answered — the first « Non »: the camera is offered. */
async function aLEcart(): Promise<{ s: Screen; w: Wire; m: Media }> {
  const state = freshCourse();
  // The supplier has confirmed the pickup: the send can leave the stall.
  state.ramassageConfirmeAt = '2026-11-28T08:00:00.000Z';
  state.codeVerification = 'K7M-9PQ';
  state.codeScelle = 'SC-4K7M-9PQR';
  const w = wire([logistiqueCourse(state, ORDER), custody]);
  const m = brancherMedia();
  const s = await mountRider();
  await s.type(CODE);
  await s.press('Entrer');
  await s.press('Accepter la course');
  await s.press('Oui', 2);
  await s.press('Oui', 1);
  await s.press('Non', 0);
  expect(s.shows('Photographiez la différence.'), JSON.stringify(s.texts())).toBe(true);
  expect(s.canPress('Prendre la photo')).toBe(true);
  return { s, w, m };
}

const saves = (): (readonly [number, number, number, number])[] =>
  journalManipulateur().filter((e) => e[0] === 'save').map((e) => [e[1], e[2], e[3], e[4]] as const);
const imagesLachees = (): string[] => journalManipulateur().filter((e) => e[0] === 'release').map((e) => `${e[1]}×${e[2]}`);
const contextesLaches = (): number[] => journalManipulateur().flatMap((e) => (e[0] === 'release-context' ? [e[1]] : []));
const ouverts = (): unknown[] => journalManipulateur().filter((e) => e[0] === 'manipulate').map((e) => e[1]);
/** The uri the camera double hands for a walk's first shot. */
const PREMIERE_PRISE = 'file:///data/user/0/cache/ImagePicker/shot-1.jpg';

let ecran: Screen | null = null;

beforeEach(() => {
  vi.resetModules();
  __resetFiles();
  __modeChargement(null);
  wiredEnv();
  process.env['EXPO_PUBLIC_SERA_MEDIA_WRITE_KEY'] = MEDIA_KEY;
});
afterEach(() => {
  ecran?.unmount();
  ecran = null;
  armerManipulateur(null);
  armerAppareil(null);
  delete process.env['EXPO_PUBLIC_SERA_MEDIA_WRITE_KEY'];
});

describe('PHOTOS LÉGÈRES — the proof photo that leaves the stall fits its budget', () => {
  it('a photo as heavy as the dim-stall frame leaves under 307 200 B: saved again at 0.5, and THOSE bytes are what the media service stores', async () => {
    armerAppareil({ width: 4000, height: 3000 });
    armerManipulateur({ source: { width: 4000, height: 3000 } });
    const { s, m } = await aLEcart();
    ecran = s;
    await s.press('Prendre la photo');
    await jusqua(s, () => s.shows('Photo enregistrée.'), '« Photo enregistrée. »');

    expect(m.bodies, 'one upload').toHaveLength(1);
    const body = m.bodies[0]!;
    expect(body.byteLength, `the photo that left weighs ${body.byteLength} B`).toBeLessThanOrEqual(BUDGET);
    expect(saves(), 'every quality at 1600 first: 0.6 is too heavy, 0.5 fits').toEqual([
      [1600, 1200, 0.6, octetsBornes(1600, 1200, 0.6)],
      [1600, 1200, 0.5, octetsBornes(1600, 1200, 0.5)],
    ]);
    const derniere = sauvegardesManipulateur()[sauvegardesManipulateur().length - 1]!;
    expect(Buffer.from(body).equals(Buffer.from(derniere)), 'the bytes that leave are the save the phone made').toBe(true);
    expect(sofDe(body)).toEqual({ width: 1600, height: 1200 });
    // Asked of the camera: no EXIF (it carries GPS), no base64 of the full-size original.
    expect(lancementsAppareil()[0]).toMatchObject({ exif: false });
    expect(lancementsAppareil()[0]?.['base64']).not.toBe(true);
  }, 20_000);

  it('AT THE FLOOR IT LEAVES ANYWAY: a photo too busy for every rung goes at 1280 px and 0.4, and the rider can carry on', async () => {
    armerAppareil({ width: 4000, height: 3000 });
    armerManipulateur({ source: { width: 4000, height: 3000 }, densite: 2 });
    const { s, m } = await aLEcart();
    ecran = s;
    await s.press('Prendre la photo');
    await jusqua(s, () => s.shows('Photo enregistrée.'), '« Photo enregistrée. »');

    const body = m.bodies[0]!;
    expect(sofDe(body), 'never smaller than the legibility floor').toEqual({ width: 1280, height: 960 });
    expect(body.byteLength, 'the floor’s last save, over budget — never blocked').toBe(octetsBornes(1280, 960, 0.4, 2));
    expect(body.byteLength).toBeGreaterThan(BUDGET);
    expect(saves().map(([w, h, q]) => `${w}×${h}@${q}`)).toEqual([
      '1600×1200@0.6', '1600×1200@0.5', '1600×1200@0.4',
      '1440×1080@0.6', '1440×1080@0.5', '1440×1080@0.4',
      '1280×960@0.6', '1280×960@0.5', '1280×960@0.4',
    ]);
    expect(imagesLachees(), 'every image the ladder rendered is released, once each').toEqual(['1600×1200', '1440×1080', '1280×960']);
    expect(ouverts(), 'the camera’s original is opened once; each step opens the image already rendered').toEqual([PREMIERE_PRISE, 'image', 'image']);
    expect(contextesLaches(), 'every context it opened is released, once each').toEqual([0, 1, 2]);
    expect(s.canPress('Envoyer la vérification')).toBe(true);
  }, 20_000);

  it('A STEP THAT CANNOT BE MADE ends the ladder as the floor does: the last readable save leaves, is stored, and the act carries it', async () => {
    armerAppareil({ width: 4000, height: 3000 });
    // Too busy for every rung, and the second step's render (1440 → 1280) fails on the phone.
    armerManipulateur({ source: { width: 4000, height: 3000 }, densite: 2, renduRefuse: 3 });
    const { s, w, m } = await aLEcart();
    ecran = s;
    await s.press('Prendre la photo');
    await jusqua(s, () => s.shows('Photo enregistrée.'), '« Photo enregistrée. »');

    expect(saves().map(([sw, sh, q]) => `${sw}×${sh}@${q}`), 'nothing is tried after the failed step').toEqual([
      '1600×1200@0.6', '1600×1200@0.5', '1600×1200@0.4',
      '1440×1080@0.6', '1440×1080@0.5', '1440×1080@0.4',
    ]);
    expect(m.bodies, 'one upload').toHaveLength(1);
    const body = m.bodies[0]!;
    expect(Buffer.from(body).equals(Buffer.from(sauvegardesManipulateur()[5]!)), 'the last readable save is what leaves').toBe(true);
    expect(sofDe(body)).toEqual({ width: 1440, height: 1080 });
    expect(m.refs, 'the media service stored it').toHaveLength(1);
    expect(imagesLachees(), 'every image rendered is released, once each').toEqual(['1600×1200', '1440×1080']);
    expect(contextesLaches(), 'every context opened is released, the failed one too').toEqual([0, 1, 2]);

    await s.press('Envoyer la vérification');
    const verif = w.calls.filter((c) => c.path === '/rider/verification');
    expect(verif.length, 'the next step was reached').toBeGreaterThan(0);
    expect(verif[0]!.body?.['evidenceBundleId'], 'the act carries the photo the media service stored').toBe(m.refs[0]);
  }, 20_000);

  it('a photo that fits today leaves byte-identical to today: ONE save, at 0.6', async () => {
    armerAppareil({ width: 1024, height: 768 });
    armerManipulateur({ source: { width: 1024, height: 768 } });
    const { s, m } = await aLEcart();
    ecran = s;
    await s.press('Prendre la photo');
    await jusqua(s, () => s.shows('Photo enregistrée.'), '« Photo enregistrée. »');
    expect(saves()).toEqual([[1024, 768, 0.6, octetsBornes(1024, 768, 0.6)]]);
    expect(Buffer.from(m.bodies[0]!).equals(Buffer.from(sauvegardesManipulateur()[0]!))).toBe(true);
  }, 20_000);
});

describe('PHOTOS LÉGÈRES — while the photo is made and sent, the screen says so', () => {
  it('during the wait the camera cannot be opened twice and « Un instant… » shows; after a good shot « Photo enregistrée. », the send is reachable and carries the photo', async () => {
    armerAppareil({ width: 4000, height: 3000 });
    armerManipulateur({ source: { width: 4000, height: 3000 } });
    const { s, w, m } = await aLEcart();
    ecran = s;
    tenir(m);
    await s.press('Prendre la photo');
    await jusqua(s, () => m.bodies.length === 1, 'the upload in flight');

    expect(s.shows('Un instant…'), `the wait is said. On screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Prendre la photo'), 'a second tap would open a second camera').toBe(false);
    expect(s.canPress('Reprendre la photo')).toBe(false);
    expect(s.canPress('Envoyer la vérification'), 'the send waits for the camera, as before').toBe(false);

    m.open();
    await jusqua(s, () => s.shows('Photo enregistrée.'), '« Photo enregistrée. »');
    expect(s.shows('Un instant…')).toBe(false);
    expect(s.canPress('Reprendre la photo'), 'the camera comes back, as a retake').toBe(true);
    expect(lancementsAppareil(), 'one shot, one camera').toHaveLength(1);

    await s.press('Envoyer la vérification');
    const verif = w.calls.filter((c) => c.path === '/rider/verification');
    expect(verif.length, 'the next step was reached').toBeGreaterThan(0);
    expect(verif[0]!.body?.['evidenceBundleId'], 'the act carries the photo the media service stored').toBe(m.refs[0]);
  }, 20_000);

  it('after a failed shot the camera comes back with the reason, and the next shot goes', async () => {
    armerAppareil({ width: 4000, height: 3000 });
    armerManipulateur({ source: { width: 4000, height: 3000 } });
    const { s, m } = await aLEcart();
    ecran = s;
    tenir(m);
    m.coupe = true;
    await s.press('Prendre la photo');
    await jusqua(s, () => m.bodies.length === 1, 'the upload in flight');
    expect(s.shows('Un instant…'), `the wait is said. On screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(s.canPress('Prendre la photo')).toBe(false);

    m.open();
    await jusqua(s, () => s.shows("La photo n'est pas partie. Réessayez."), 'the failure sentence');
    expect(s.shows('Un instant…')).toBe(false);
    expect(s.canPress('Prendre la photo'), 'the camera is back').toBe(true);

    m.coupe = false;
    await s.press('Prendre la photo');
    await jusqua(s, () => s.shows('Photo enregistrée.'), '« Photo enregistrée. » on the second shot');
    expect(s.canPress('Envoyer la vérification')).toBe(true);
    expect(lancementsAppareil()).toHaveLength(2);
  }, 20_000);
});
