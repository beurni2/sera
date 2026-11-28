import { describe, expect, it } from 'vitest';
import {
  BUCKET_MIN_DIM,
  EVIDENCE_BUDGET_BYTES,
  EVIDENCE_EDGE_STEPS,
  EVIDENCE_LEGIBLE_FLOOR,
  EVIDENCE_MAX_EDGE,
  EVIDENCE_QUALITY_STEPS,
  nextEvidenceEdge,
  saveWithinEvidenceBudget,
  type Resize,
} from '../src/net/photo-bounds';

/**
 * ═══ THE PROOF PHOTO FITS ITS BUDGET — the ladder, as a pure decision ═══
 *
 * PERF-BUDGETS « Evidence-upload time »: « 3 photos ≤ 300 KB each », on the
 * reference 3G network. The rider app saved once at 0.6 and sent whatever
 * came out; a dim stall or a patterned cloth made that heavier than the
 * budget. The ladder steps the quality down, then the long edge, and never
 * below the edge that keeps a printed code legible — and at that floor the
 * photo LEAVES anyway: a byte budget never blocks a rider's act.
 *
 * The saves here are lengths only (what the ladder reads); what an encoder
 * makes of a photograph is the manipulator double's, certified in
 * `test/manipulator-double.test.ts`, and walked in `rendu-photo-preuve`.
 */

type Img = { readonly width: number; readonly height: number; readonly n: number };
type Appel = readonly ['save', number, number, number] | readonly ['resize', Resize, number];

/** A ladder run over a price list: `price(long, compress)` is a save's length. */
async function gravir(start: { width: number; height: number }, price: (long: number, compress: number) => number | null) {
  const appels: Appel[] = [];
  const faites: Uint8Array[] = [];
  let n = 0;
  const first: Img = { ...start, n };
  const out = await saveWithinEvidenceBudget<Img>(
    first,
    async (image, compress) => {
      appels.push(['save', image.width, image.height, compress]);
      const len = price(Math.max(image.width, image.height), compress);
      if (len === null) return null;
      const bytes = new Uint8Array(len);
      faites.push(bytes);
      return bytes;
    },
    async (image, step) => {
      appels.push(['resize', step, image.n]);
      // Android's arithmetic: the named side as asked, the other truncated.
      const ratio = image.width / image.height;
      n += 1;
      return step.width !== undefined
        ? { width: step.width, height: Math.trunc(step.width / ratio), n }
        : { width: Math.trunc(step.height! * ratio), height: step.height!, n };
    },
  );
  return { out, appels, faites };
}

const TROP = EVIDENCE_BUDGET_BYTES + 1;

describe('the ladder’s numbers are the ruled ones, each for a stated reason', () => {
  it('budget 300 KB = 307 200 B · qualities 0.6 → 0.4 · edges 1600 → 1440 → 1280 · floor 1280', () => {
    expect(EVIDENCE_BUDGET_BYTES).toBe(307_200);
    expect(EVIDENCE_BUDGET_BYTES).toBe(300 * 1024);
    expect([...EVIDENCE_QUALITY_STEPS]).toEqual([0.6, 0.5, 0.4]);
    expect(EVIDENCE_MAX_EDGE).toBe(1600);
    expect([...EVIDENCE_EDGE_STEPS]).toEqual([1440, 1280]);
    expect(EVIDENCE_LEGIBLE_FLOOR).toBe(1280);
    expect(EVIDENCE_EDGE_STEPS[EVIDENCE_EDGE_STEPS.length - 1], 'the last step IS the floor').toBe(EVIDENCE_LEGIBLE_FLOOR);
    // The media service refuses a side under 200; even a 20:9 shot at the floor keeps 576.
    expect(BUCKET_MIN_DIM).toBe(200);
    expect(Math.floor((EVIDENCE_LEGIBLE_FLOOR * 9) / 20)).toBeGreaterThanOrEqual(BUCKET_MIN_DIM);
  });
});

describe('nextEvidenceEdge — one step down, never under the floor, never under the media minimum', () => {
  it('steps the LONG edge, landscape or portrait', () => {
    expect(nextEvidenceEdge(1600, 1200)).toEqual({ width: 1440 });
    expect(nextEvidenceEdge(1200, 1600)).toEqual({ height: 1440 });
    expect(nextEvidenceEdge(1600, 1600)).toEqual({ width: 1440 });
    expect(nextEvidenceEdge(1440, 1080)).toEqual({ width: 1280 });
    expect(nextEvidenceEdge(1080, 1440)).toEqual({ height: 1280 });
    expect(nextEvidenceEdge(1500, 1125), 'an in-between photo steps to the next listed edge').toEqual({ width: 1440 });
  });

  it('stops at the floor, and below it never steps at all', () => {
    expect(nextEvidenceEdge(1280, 960)).toBeNull();
    expect(nextEvidenceEdge(960, 1280)).toBeNull();
    expect(nextEvidenceEdge(1024, 768)).toBeNull();
  });

  it('stops where the short side would fall under the media minimum (rounded DOWN, as the resize is)', () => {
    expect(nextEvidenceEdge(1600, 240)).toEqual({ width: 1440 }); // 216 left
    expect(nextEvidenceEdge(1440, 216)).toBeNull(); // 1280 would leave 192
  });

  it('answers nothing for a size that is not one', () => {
    expect(nextEvidenceEdge(0, 1200)).toBeNull();
    expect(nextEvidenceEdge(Number.NaN, 1200)).toBeNull();
  });
});

describe('saveWithinEvidenceBudget — every quality at an edge, then the next edge, then it leaves', () => {
  it('a photo that fits today leaves on its FIRST save, at 0.6, at the size it was rendered — those very bytes', async () => {
    const { out, appels, faites } = await gravir({ width: 1600, height: 1200 }, () => 150_000);
    expect(appels).toEqual([['save', 1600, 1200, 0.6]]);
    expect(out).toBe(faites[0]);
  });

  it('the budget is inclusive to the byte: 307 200 B leaves, 307 201 B is saved again lighter', async () => {
    const pile = await gravir({ width: 1600, height: 1200 }, () => EVIDENCE_BUDGET_BYTES);
    expect(pile.appels).toHaveLength(1);
    const plus = await gravir({ width: 1600, height: 1200 }, (_l, q) => (q === 0.6 ? TROP : EVIDENCE_BUDGET_BYTES));
    expect(plus.appels).toEqual([['save', 1600, 1200, 0.6], ['save', 1600, 1200, 0.5]]);
    expect(plus.out).toBe(plus.faites[1]);
  });

  it('tries 0.6, 0.5, 0.4 at an edge before ANY resize — and resizes the image it already rendered', async () => {
    const { out, appels, faites } = await gravir({ width: 1600, height: 1200 }, (long, q) => (long === 1600 || q === 0.6 ? TROP : 250_000));
    expect(appels).toEqual([
      ['save', 1600, 1200, 0.6], ['save', 1600, 1200, 0.5], ['save', 1600, 1200, 0.4],
      ['resize', { width: 1440 }, 0],
      ['save', 1440, 1080, 0.6], ['save', 1440, 1080, 0.5],
    ]);
    expect(out, 'the save that fit is the one that leaves').toBe(faites[4]);
  });

  it('a portrait photo steps its height', async () => {
    const { appels } = await gravir({ width: 1200, height: 1600 }, (long) => (long === 1600 ? TROP : 200_000));
    expect(appels).toContainEqual(['resize', { height: 1440 }, 0]);
    expect(appels[appels.length - 1]).toEqual(['save', 1080, 1440, 0.6]);
  });

  it('AT THE FLOOR IT LEAVES ANYWAY: nine saves, two resizes, and the last save — over budget — is what goes', async () => {
    const { out, appels, faites } = await gravir({ width: 1600, height: 1200 }, () => 500_000);
    expect(appels).toEqual([
      ['save', 1600, 1200, 0.6], ['save', 1600, 1200, 0.5], ['save', 1600, 1200, 0.4],
      ['resize', { width: 1440 }, 0],
      ['save', 1440, 1080, 0.6], ['save', 1440, 1080, 0.5], ['save', 1440, 1080, 0.4],
      ['resize', { width: 1280 }, 1],
      ['save', 1280, 960, 0.6], ['save', 1280, 960, 0.5], ['save', 1280, 960, 0.4],
    ]);
    expect(out, 'never null: a byte budget does not block the act').not.toBeNull();
    expect(out).toBe(faites[8]);
    expect(out!.byteLength).toBeGreaterThan(EVIDENCE_BUDGET_BYTES);
  });

  it('a narrow shot stops where its short side would fall under 200', async () => {
    const { out, appels, faites } = await gravir({ width: 1600, height: 240 }, () => 500_000);
    expect(appels.filter((a) => a[0] === 'resize')).toEqual([['resize', { width: 1440 }, 0]]);
    expect(appels).toHaveLength(7);
    expect(out).toBe(faites[5]);
  });

  it('a photo already at or under the floor is only saved lighter, never made smaller', async () => {
    for (const [w, h] of [[1280, 960], [1024, 768]] as const) {
      const { out, appels, faites } = await gravir({ width: w, height: h }, () => 500_000);
      expect(appels, `${w}×${h}`).toEqual([['save', w, h, 0.6], ['save', w, h, 0.5], ['save', w, h, 0.4]]);
      expect(out).toBe(faites[2]);
    }
  });

  it('a save that cannot be read stops the ladder there: no photo, and nothing more is tried', async () => {
    const { out, appels } = await gravir({ width: 1600, height: 1200 }, (_l, q) => (q === 0.6 ? TROP : null));
    expect(out).toBeNull();
    expect(appels).toEqual([['save', 1600, 1200, 0.6], ['save', 1600, 1200, 0.5]]);
  });

  it('is deterministic: the same photo makes the same saves and leaves the same way', async () => {
    // 384 000 · 320 000 · 256 000 B at 1600: it leaves on the third save.
    const prix = (long: number, q: number): number => Math.round(long * 400 * q);
    const a = await gravir({ width: 1600, height: 1200 }, prix);
    const b = await gravir({ width: 1600, height: 1200 }, prix);
    expect(a.appels).toHaveLength(3);
    expect(a.appels).toEqual(b.appels);
    expect(a.out!.byteLength).toBe(b.out!.byteLength);
  });
});
