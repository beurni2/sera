/**
 * ═══ RENDU-RÉEL — expo-image-manipulator, priced by a MEASURED encoder ═══
 *
 * `expoPhotoSource` requires this module lazily (an older binary must survive
 * launch), so it reaches a walk only through `test/setup.ts`'s loader table —
 * never through a vitest alias.
 *
 * ═══ BOUNDS (stated per the standing order — this double may NEVER exceed them) ═══
 *
 * · NO PIXELS. It never decodes, resizes or encodes an image. What it hands
 *   back is a valid baseline JPEG FRAME (SOI · DQT · SOF0 with the image's own
 *   size · DHT · SOS · filler · EOI) whose LENGTH is the bound below, so the
 *   app's real base64 decode, its real byte count and the media stand-in's
 *   real size read all run over it exactly as over a phone's save.
 * · APPEARANCE: nothing. This module makes pixels on a phone; this file makes
 *   none, and may never be used to claim what a photo looks like or whether a
 *   person can read it.
 * · UNARMED, `manipulate()` THROWS: no walk gets a photo it did not ask for.
 * · THE VERBS ARE ONLY THE ONES CERTIFIED HERE: `resize`, `renderAsync` and
 *   `release` on a context, `saveAsync` and `release` on a rendered image. Any
 *   other verb is absent, so a call to it throws the TypeError a missing
 *   method throws.
 * · RESIZE IS ANDROID'S ARITHMETIC (`ResizeTransformer.kt` l.17-23 in 57.0.16):
 *   the named side is taken as asked and the other is `(side / ratio).toInt()`
 *   — truncated, never rounded up.
 * · A RELEASED IMAGE OR CONTEXT IS DEAD, as a native SharedObject is: every
 *   later call on it throws. A kinder double would hide a use-after-release.
 *   Both are SharedObjects; on Android a context keeps its rendered result,
 *   and one opened on an image keeps that image too (`ImageManipulatorContext.kt`
 *   l.42-91, `ImageManipulatorModule.kt` l.56-58), so each is journalled.
 * · ONE RENDER CAN BE ARMED TO FAIL (`renduRefuse: n`, counted from 1): the
 *   n-th `renderAsync` rejects, as a native render rethrows its task's error
 *   (`ImageManipulatorContext.kt` l.34-39, l.64-66). Unarmed, no render fails.
 * · THE QUALITY IS ANDROID'S TOO (`ImageManipulatorModule.kt` l.116):
 *   `(compress * 100).toInt()`, and only a quality with a measured cell may be
 *   asked for — any other THROWS, so a drifted quality list cannot pass.
 *
 * ═══ THE BOUND — bits per pixel, by long edge and quality ═══
 * (length = ⌈width × height × bpp × densite / 8⌉)
 *
 *   long edge │  0.6  │  0.5  │  0.4
 *   ──────────┼───────┼───────┼───────
 *     1600    │ 1.492 │ 1.246 │ 1.045
 *     1440    │ 1.551 │ 1.288 │ 1.074
 *     1280    │ 1.564 │ 1.296 │ 1.079
 *     1200    │ 1.563 │ 1.293 │ 1.074
 *     1080    │ 1.599 │ 1.316 │ 1.090
 *     1024    │ 1.592 │ 1.311 │ 1.084
 *      960    │ 1.596 │ 1.313 │ 1.086
 *      900    │ 1.629 │ 1.338 │ 1.101
 *      800    │ 1.926 │ 1.574 │ 1.268
 *      720    │ 1.643 │ 1.350 │ 1.111
 *      640    │ 1.645 │ 1.346 │ 1.111
 *
 * WHERE IT COMES FROM, said plainly. Measured ONCE, OUTSIDE this repository,
 * with a desktop libjpeg-turbo 3.2.0 (Pillow 13.0.0; the IJG quality scale
 * Android's `Bitmap.compress` uses; 4:2:0; no Huffman optimisation) on three
 * SYNTHETIC frames of a carton with a printed label and a seal-style code tag
 * — typical, busy (a wax-print cloth behind it) and hard (a dim stall: fine
 * texture on every surface, the phone's sharpening, low-light noise that
 * survives the downscale) — from 4000×3000 and 3000×4000 masters, each
 * resized two ways (antialiased, and Android's aliased bilinear). No person,
 * no place, no photo kept. Each cell is the LARGEST bits-per-pixel seen over
 * every frame, orientation and resize, rounded UP to the next 0.001. The
 * measured bytes sit in `test/manipulator-double.test.ts`, which fails if any
 * cell here prices a save below them. For scale, the hard frame at 0.6, 0.5
 * and 0.4 weighed 353 948, 295 770 and 248 323 B in landscape (1600×1200),
 * and 358 056, 298 873 and 250 687 B in portrait (1200×1600).
 *
 * WHAT IT DOES NOT KNOW: no real phone was measured (iOS maps quality on its
 * own scale), the frames are 4:3 only, and a real photograph can be busier
 * than the hard frame. `densite` (≥ 1, never below — kinder than the measure
 * is refused) stands for a busier photograph. A long edge between two rows
 * takes the LARGER of its two neighbours (the measure is not smooth: see the
 * 800 row), so the bound never dips between measured points. A long edge
 * above 1600 or below 640 THROWS: nothing was measured there.
 */

export const SaveFormat = {
  JPEG: 'jpeg',
  PNG: 'png',
  WEBP: 'webp',
} as const;

export const BORNE_BPP: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1600: { 0.6: 1.492, 0.5: 1.246, 0.4: 1.045 },
  1440: { 0.6: 1.551, 0.5: 1.288, 0.4: 1.074 },
  1280: { 0.6: 1.564, 0.5: 1.296, 0.4: 1.079 },
  1200: { 0.6: 1.563, 0.5: 1.293, 0.4: 1.074 },
  1080: { 0.6: 1.599, 0.5: 1.316, 0.4: 1.09 },
  1024: { 0.6: 1.592, 0.5: 1.311, 0.4: 1.084 },
  960: { 0.6: 1.596, 0.5: 1.313, 0.4: 1.086 },
  900: { 0.6: 1.629, 0.5: 1.338, 0.4: 1.101 },
  800: { 0.6: 1.926, 0.5: 1.574, 0.4: 1.268 },
  720: { 0.6: 1.643, 0.5: 1.35, 0.4: 1.111 },
  640: { 0.6: 1.645, 0.5: 1.346, 0.4: 1.111 },
};

const RANGS = Object.keys(BORNE_BPP).map(Number).sort((a, b) => b - a);

function bppAt(row: number, compress: number): number {
  const bpp = BORNE_BPP[row]![compress];
  if (bpp === undefined) throw new Error(`no measured bound at quality ${compress} — an uncertified rung`);
  return bpp;
}

/** The length a save of a `width`×`height` image at `compress` hands back. */
export function octetsBornes(width: number, height: number, compress: number, densite = 1): number {
  if (!(densite >= 1)) throw new Error(`densite ${densite} < 1 would be kinder than the measured encoder`);
  const long = Math.max(width, height);
  const haut = RANGS[0]!;
  const bas = RANGS[RANGS.length - 1]!;
  if (long > haut || long < bas) {
    throw new Error(`no measured bound for a ${long} px long edge (${width}×${height}) — only ${bas}..${haut} px were measured`);
  }
  const dessous = RANGS.find((e) => e <= long)!;
  const dessus = [...RANGS].reverse().find((e) => e >= long)!;
  const bpp = Math.max(bppAt(dessous, compress), bppAt(dessus, compress));
  return Math.ceil((width * height * bpp * densite) / 8);
}

/** A baseline JPEG frame of exactly `total` bytes declaring `width`×`height`. */
export function jpegDeTaille(width: number, height: number, total: number): Uint8Array {
  const seg = (marker: number, body: readonly number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const tete = [
    0xff, 0xd8,
    ...seg(0xdb, [0x00, ...Array.from({ length: 64 }, (_, i) => (i % 16) + 1)]),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xc4, [0x00, ...Array.from({ length: 16 }, () => 0), 0x05]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
  ];
  const remplissage = total - tete.length - 2;
  if (remplissage < 1) throw new Error(`a ${total}-byte JPEG cannot hold its own header`);
  const out = new Uint8Array(total);
  out.set(tete, 0);
  out.fill(0x12, tete.length, total - 2); // never 0xFF: no marker hides in the filler
  out[total - 2] = 0xff;
  out[total - 1] = 0xd9;
  return out;
}

type Entree =
  | readonly ['manipulate', string, number, number]
  | readonly ['resize', { readonly width?: number | null; readonly height?: number | null }]
  | readonly ['render', number, number]
  | readonly ['save', number, number, number, number]
  | readonly ['release', number, number]
  | readonly ['release-context', number];

let arme: {
  readonly source: { readonly width: number; readonly height: number };
  readonly densite: number;
  readonly renduRefuse: number | null;
} | null = null;
let journal: Entree[] = [];
let sauvegardes: Uint8Array[] = [];
let numero = 0;
let contextes = 0;
let rendus = 0;

/**
 * Arm for one walk: `source` is the size of the picture the camera hands over
 * (what `manipulate(uri)` opens), `densite` how much busier than the hardest
 * measured frame it is, `renduRefuse` the one render (from 1) that fails.
 * `null` disarms. Every arming clears the journal.
 */
export function armerManipulateur(
  options: {
    readonly source: { readonly width: number; readonly height: number };
    readonly densite?: number;
    readonly renduRefuse?: number;
  } | null,
): void {
  const densite = options?.densite ?? 1;
  if (!(densite >= 1)) throw new Error(`densite ${densite} < 1 would be kinder than the measured encoder`);
  arme = options === null ? null : { source: options.source, densite, renduRefuse: options.renduRefuse ?? null };
  journal = [];
  sauvegardes = [];
  numero = 0;
  contextes = 0;
  rendus = 0;
}

/** The verbs the app asked for, in order, with their arguments and sizes. */
export function journalManipulateur(): readonly Entree[] {
  return journal;
}

/** Every save's bytes, in the order they were made. */
export function sauvegardesManipulateur(): readonly Uint8Array[] {
  return sauvegardes;
}

class ImageRefDouble {
  private vivante = true;
  constructor(readonly width: number, readonly height: number) {}

  vive(): void {
    if (!this.vivante) throw new Error('expo-image-manipulator double: this image was released — every native call on it throws');
  }

  async saveAsync(options: { compress?: number; format?: string; base64?: boolean } = {}): Promise<{
    uri: string;
    width: number;
    height: number;
    base64?: string;
  }> {
    this.vive();
    if (options.format !== SaveFormat.JPEG) throw new Error(`the double prices JPEG only, asked for « ${String(options.format)} »`);
    const compress = options.compress ?? 1;
    // The library hands Android `(compress * 100).toInt()`; a value that does
    // not land on a measured quality is a quality nobody measured.
    const qualite = Math.trunc(compress * 100);
    if (qualite / 100 !== compress) throw new Error(`compress ${compress} reaches the encoder as ${qualite} — not a measured quality`);
    const octets = jpegDeTaille(this.width, this.height, octetsBornes(this.width, this.height, compress, arme!.densite));
    journal.push(['save', this.width, this.height, compress, octets.byteLength]);
    sauvegardes.push(octets);
    numero += 1;
    return {
      uri: `file:///data/user/0/cache/ImageManipulator/save-${numero}.jpg`,
      width: this.width,
      height: this.height,
      ...(options.base64 === true ? { base64: Buffer.from(octets).toString('base64') } : {}),
    };
  }

  release(): void {
    this.vive();
    this.vivante = false;
    journal.push(['release', this.width, this.height]);
  }
}

function redimensionner(width: number, height: number, size: { width?: number | null; height?: number | null }): [number, number] {
  const ratio = width / height;
  let w = 0;
  let h = 0;
  if (size.width != null) {
    w = size.width;
    h = Math.trunc(size.width / ratio);
  }
  if (size.height != null) {
    h = size.height;
    w = w === 0 ? Math.trunc(size.height * ratio) : w;
  }
  // `Bitmap.createScaledBitmap` refuses a side ≤ 0.
  if (!(w > 0 && h > 0)) throw new Error(`createScaledBitmap refuses ${w}×${h}`);
  return [w, h];
}

export const ImageManipulator = {
  manipulate(source: unknown) {
    if (arme === null) {
      throw new Error(
        `expo-image-manipulator double: no image pipeline under vitest (asked for « ${String(source)} »). ` +
          'A walk that means to take a photo must arm this double explicitly.',
      );
    }
    let w: number;
    let h: number;
    if (source instanceof ImageRefDouble) {
      source.vive();
      ({ width: w, height: h } = source);
      journal.push(['manipulate', 'image', w, h]);
    } else if (typeof source === 'string') {
      ({ width: w, height: h } = arme.source);
      journal.push(['manipulate', source, w, h]);
    } else {
      throw new TypeError('manipulate() takes a uri or an image it rendered');
    }
    // Numbered in the order `manipulate` opened them, as the journal lists them.
    const k = contextes;
    contextes += 1;
    let vivant = true;
    const vif = (): void => {
      if (!vivant) throw new Error('expo-image-manipulator double: this context was released — every native call on it throws');
    };
    const contexte = {
      resize(size: { width?: number | null; height?: number | null }) {
        vif();
        journal.push(['resize', { ...size }]);
        [w, h] = redimensionner(w, h, size);
        return contexte;
      },
      async renderAsync(): Promise<ImageRefDouble> {
        vif();
        journal.push(['render', w, h]);
        rendus += 1;
        if (rendus === arme?.renduRefuse) throw new Error(`expo-image-manipulator double: render ${rendus} refused, as armed`);
        return new ImageRefDouble(w, h);
      },
      release(): void {
        vif();
        vivant = false;
        journal.push(['release-context', k]);
      },
    };
    return contexte;
  },
};
