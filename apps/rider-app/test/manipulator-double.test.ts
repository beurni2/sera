import { beforeEach, describe, expect, it } from 'vitest';
import {
  BORNE_BPP,
  ImageManipulator,
  SaveFormat,
  armerManipulateur,
  jpegDeTaille,
  journalManipulateur,
  octetsBornes,
} from './doubles/expo-image-manipulator';

/**
 * ═══ THE MANIPULATOR DOUBLE, CERTIFIED AGAINST THE ENCODER IT STANDS FOR ═══
 *
 * A stand-in kinder than the real encoder would make the byte budget look kept
 * while a phone sends more. So every byte count measured ONCE, outside this
 * repository (libjpeg-turbo 3.2.0, IJG scale, 4:2:0, no Huffman optimisation —
 * the double's header says how), is written below, and the double must price
 * every one of those saves AT LEAST as heavy. Lower one cell of `BORNE_BPP`
 * and this file goes red.
 *
 * Rows: [width, height, [bytes at 0.6, 0.5, 0.4]] — the larger of the two
 * resizes (antialiased, Android's aliased bilinear) for each cell.
 */
const MESURE: Readonly<Record<string, readonly (readonly [number, number, readonly [number, number, number]])[]>> = {
  'typical 4000x3000': [
    [1600, 1200, [93301, 77368, 67989]], [1440, 1080, [79092, 66418, 54558]], [1280, 960, [62807, 51042, 41462]],
    [1200, 900, [54889, 45343, 36392]], [1080, 810, [44685, 38424, 30282]], [1024, 768, [38447, 31753, 24283]],
    [960, 720, [31467, 25095, 20228]], [900, 675, [25041, 20758, 17689]], [800, 600, [19087, 15242, 13435]],
    [720, 540, [13315, 12024, 11145]], [640, 480, [11204, 10139, 9293]],
  ],
  'typical 3000x4000': [
    [1200, 1600, [94077, 77928, 68100]], [1080, 1440, [79236, 66346, 54507]], [960, 1280, [63016, 51081, 41544]],
    [900, 1200, [55258, 45772, 36650]], [810, 1080, [44502, 38349, 30215]], [768, 1024, [39652, 32959, 24933]],
    [720, 960, [31357, 24957, 20228]], [675, 900, [25089, 20760, 17593]], [600, 800, [19504, 15566, 13639]],
    [540, 720, [13007, 11786, 10935]], [480, 640, [10979, 9934, 9136]],
  ],
  'busy 4000x3000': [
    [1600, 1200, [158736, 134960, 114930]], [1440, 1080, [136679, 116092, 98380]], [1280, 960, [114882, 97352, 82436]],
    [1200, 900, [102439, 86796, 73704]], [1080, 810, [86927, 74122, 62807]], [1024, 768, [78312, 66858, 56745]],
    [960, 720, [69524, 59186, 50457]], [900, 675, [61913, 52506, 44793]], [800, 600, [54700, 45395, 37715]],
    [720, 540, [41271, 35412, 30160]], [640, 480, [34110, 29432, 25577]],
  ],
  'busy 3000x4000': [
    [1200, 1600, [160114, 136379, 115984]], [1080, 1440, [138651, 117459, 99369]], [960, 1280, [115825, 98029, 82814]],
    [900, 1200, [103511, 87879, 74494]], [810, 1080, [87177, 74353, 62852]], [768, 1024, [78712, 67040, 56973]],
    [720, 960, [69754, 59465, 50585]], [675, 900, [62361, 52703, 44900]], [600, 800, [55063, 45773, 37975]],
    [540, 720, [42025, 35859, 30257]], [480, 640, [34174, 29636, 25655]],
  ],
  'hard 4000x3000': [
    [1600, 1200, [353948, 295770, 248323]], [1440, 1080, [298082, 247118, 205903]], [1280, 960, [237206, 196799, 164079]],
    [1200, 900, [208940, 172628, 143462]], [1080, 810, [172914, 142583, 117985]], [1024, 768, [155171, 127539, 105752]],
    [960, 720, [136542, 112486, 92886]], [900, 675, [122334, 100558, 83020]], [800, 600, [114435, 93235, 75491]],
    [720, 540, [79214, 64693, 53265]], [640, 480, [62791, 51232, 42227]],
  ],
  'hard 3000x4000': [
    [1200, 1600, [358056, 298873, 250687]], [1080, 1440, [301410, 250195, 208662]], [960, 1280, [240216, 198953, 165675]],
    [900, 1200, [211001, 174549, 144948]], [810, 1080, [174819, 143895, 119103]], [768, 1024, [156440, 128852, 106520]],
    [720, 960, [137893, 113399, 93805]], [675, 900, [123643, 101554, 83603]], [600, 800, [115550, 94400, 76068]],
    [540, 720, [79840, 65610, 53962]], [480, 640, [63139, 51686, 42630]],
  ],
};
const QUALITES = [0.6, 0.5, 0.4] as const;

/** The largest measured bits-per-pixel at this long edge and quality, over every frame. */
function bppMesure(long: number, q: (typeof QUALITES)[number]): number {
  const i = QUALITES.indexOf(q);
  let max = 0;
  for (const rows of Object.values(MESURE)) {
    for (const [w, h, b] of rows) if (Math.max(w, h) === long) max = Math.max(max, (b[i]! * 8) / (w * h));
  }
  if (max === 0) throw new Error(`no measure at ${long}`);
  return max;
}

/** media-service `imageDimensions` for JPEG (Boutik+ d1ecbbe, `src/media.ts` l.161-180), copied, not imported. */
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

beforeEach(() => armerManipulateur(null));

describe('the manipulator double is never kinder than the measured encoder', () => {
  it('every measured save is priced at least as heavy as it weighed', () => {
    let cells = 0;
    for (const [frame, rows] of Object.entries(MESURE)) {
      for (const [w, h, bytes] of rows) {
        QUALITES.forEach((q, i) => {
          expect(octetsBornes(w, h, q), `${frame} ${w}×${h} at ${q}: measured ${bytes[i]} B`).toBeGreaterThanOrEqual(bytes[i]!);
          cells += 1;
        });
      }
    }
    // 3 frames × 2 orientations × 11 edges × 3 qualities — a table that lost a row is not certified.
    expect(cells).toBe(198);
    expect(Object.keys(BORNE_BPP).map(Number).sort((a, b) => b - a)).toEqual([1600, 1440, 1280, 1200, 1080, 1024, 960, 900, 800, 720, 640]);
  });

  it('a long edge between two measured rows is priced at least as heavy as BOTH neighbours', () => {
    const rows = Object.keys(BORNE_BPP).map(Number).sort((a, b) => b - a);
    for (let k = 0; k + 1 < rows.length; k += 1) {
      const haut = rows[k]!;
      const bas = rows[k + 1]!;
      for (const long of [bas + 1, Math.floor((haut + bas) / 2), haut - 1]) {
        const court = Math.floor((long * 3) / 4);
        for (const q of QUALITES) {
          const bpp = (octetsBornes(long, court, q) * 8) / (long * court);
          expect(bpp, `${long} px at ${q}, between ${bas} and ${haut}`).toBeGreaterThanOrEqual(Math.max(bppMesure(haut, q), bppMesure(bas, q)));
        }
      }
    }
  });

  it('nothing it was not measured for: other qualities, edges outside 640..1600, a photo kinder than the measure', () => {
    for (const q of [0.7, 0.55, 0.45, 0.3, 1]) expect(() => octetsBornes(1600, 1200, q), `quality ${q}`).toThrow(/uncertified/);
    expect(() => octetsBornes(1601, 1200, 0.6)).toThrow(/only 640\.\.1600/);
    expect(() => octetsBornes(639, 479, 0.6)).toThrow(/only 640\.\.1600/);
    expect(() => octetsBornes(1600, 1200, 0.6, 0.99)).toThrow(/kinder/);
    expect(() => armerManipulateur({ source: { width: 4000, height: 3000 }, densite: 0.5 })).toThrow(/kinder/);
    // densite scales the bound up, never down.
    expect(octetsBornes(1600, 1200, 0.6, 2)).toBeGreaterThanOrEqual(2 * octetsBornes(1600, 1200, 0.6) - 1);
  });

  it('a save is a JPEG frame of EXACTLY the bound, whose size the media service reads as the image’s own', async () => {
    armerManipulateur({ source: { width: 4000, height: 3000 } });
    const rendu = await ImageManipulator.manipulate('file:///shot.jpg').resize({ width: 1600 }).renderAsync();
    const saved = await rendu.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
    const bytes = new Uint8Array(Buffer.from(saved.base64!, 'base64'));
    expect(bytes.byteLength).toBe(octetsBornes(1600, 1200, 0.6));
    expect([bytes[0], bytes[1], bytes[2]], 'the media service sniffs FF D8 FF').toEqual([0xff, 0xd8, 0xff]);
    expect(sofDe(bytes)).toEqual({ width: 1600, height: 1200 });
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
    expect(bytes.subarray(200, bytes.length - 2).includes(0xff), 'no marker hides in the filler').toBe(false);
    expect({ width: saved.width, height: saved.height }).toEqual({ width: 1600, height: 1200 });
    expect(() => jpegDeTaille(1600, 1200, 100)).toThrow(/cannot hold/);
  });

  it('resizes with Android’s arithmetic — the other side TRUNCATED — and from the image it rendered', async () => {
    const cas: [number, number, { width?: number; height?: number }, number, number][] = [
      [4000, 3000, { width: 1600 }, 1600, 1200],
      [3000, 4000, { height: 1600 }, 1200, 1600],
      [4000, 2250, { width: 1600 }, 1600, 900],
      [4000, 1800, { width: 1600 }, 1600, 720],
      [4160, 3120, { width: 1600 }, 1600, 1200],
      // 1600 × 3002/4000 = 1200.8: Android keeps 1200, a rounding double would say 1201.
      [3002, 4000, { height: 1600 }, 1200, 1600],
    ];
    for (const [w, h, size, ew, eh] of cas) {
      armerManipulateur({ source: { width: w, height: h } });
      const r = await ImageManipulator.manipulate('file:///shot.jpg').resize(size).renderAsync();
      expect({ width: r.width, height: r.height }, `${w}×${h} → ${JSON.stringify(size)}`).toEqual({ width: ew, height: eh });
    }
    armerManipulateur({ source: { width: 4000, height: 3000 } });
    const premier = await ImageManipulator.manipulate('file:///shot.jpg').resize({ width: 1600 }).renderAsync();
    const second = await ImageManipulator.manipulate(premier).resize({ width: 1440 }).renderAsync();
    expect({ width: second.width, height: second.height }).toEqual({ width: 1440, height: 1080 });
    expect(journalManipulateur().map((e) => e[0])).toEqual(['manipulate', 'resize', 'render', 'manipulate', 'resize', 'render']);
  });

  it('is harsh where the phone is harsh: unarmed it refuses, a released image is dead, only JPEG is priced', async () => {
    expect(() => ImageManipulator.manipulate('file:///shot.jpg')).toThrow(/must arm this double/);
    armerManipulateur({ source: { width: 4000, height: 3000 } });
    const r = await ImageManipulator.manipulate('file:///shot.jpg').renderAsync();
    await expect(r.saveAsync({ compress: 0.6, format: SaveFormat.PNG })).rejects.toThrow(/JPEG only/);
    const rendu = await ImageManipulator.manipulate('file:///shot.jpg').resize({ width: 1600 }).renderAsync();
    rendu.release();
    await expect(rendu.saveAsync({ compress: 0.6, format: SaveFormat.JPEG })).rejects.toThrow(/released/);
    expect(() => ImageManipulator.manipulate(rendu)).toThrow(/released/);
    // Only the verbs certified here exist.
    expect((ImageManipulator.manipulate('file:///shot.jpg') as Record<string, unknown>)['rotate']).toBeUndefined();
  });
});
