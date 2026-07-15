import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WO-FP-SERA · the LONG-STATUS-NEVER-CLIPPED fixture (founder tap, 2026-07-15).
 * CTO law: a status chip NEVER clips and is NEVER ellipsized — truncating an
 * honest status weakens it (the safety-copy law). The app's real statuses are
 * full sentences (« Temps passé. Course rendue à la liste. », « 2e passage — le
 * client était absent. »), far longer than the planche's short caps chips. The
 * in-grammar adaptation (planche R12 `l.desc` treatment): a status that exceeds
 * the eyebrow row drops to a full-width, sentence-case line that WRAPS; the card
 * grows; nothing overlaps the neighbor (the DF-1 minHeight lesson).
 *
 * RN has no layout in unit tests, so « full text visible / card bounds respected »
 * is enforced STRUCTURALLY: the properties that make clipping impossible — the
 * status text carries no numberOfLines/ellipsizeMode (so it wraps, never
 * truncates), the full pill is alignSelf:'stretch' (full width), and the card has
 * NO fixed height (grows with content).
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const read = (p: string): string => readFileSync(join(appDir, p), 'utf8');

interface CatEntry { key: string; fr: string }
const catalog: CatEntry[] = JSON.parse(read('i18n/catalog.json'));
const byKey = new Map(catalog.map((e) => [e.key, e.fr]));

/** Every string that can render AS a CourseCard status (statusKeyFor / lineage). */
const STATUS_KEYS = [
  'courses.statut_proposee', 'courses.statut_a_ramasser', 'courses.statut_en_route',
  'courses.statut_rendue', 'courses.statut_expiree', 'courses.statut_retour_en_cours',
  'courses.statut_retour_fait', 'courses.lineage_2e',
  'assignment.ack_pending', 'assignment.decline_pending',
];

describe('WO-FP-SERA — a long honest status never clips (safety-copy law)', () => {
  it('the longest real status is a full sentence — the case the guard must protect', () => {
    const strings = STATUS_KEYS.map((k) => byKey.get(k)).filter((s): s is string => s !== undefined);
    expect(strings.length).toBe(STATUS_KEYS.length); // every status string exists
    const longest = strings.reduce((a, b) => (b.length > a.length ? b : a));
    // it is a genuine sentence (not a short caps word) — otherwise the guard is vacuous
    expect(longest.length).toBeGreaterThan(24);
  });

  it('the full-status treatment cannot truncate: no numberOfLines / no ellipsizeMode on the status text', () => {
    const kit = read('src/ui/faso-kit.tsx');
    // the Pill component (short + full) — its Text must never cap lines or ellipsize
    const pillStart = kit.indexOf('function Pill(');
    const pillEnd = kit.indexOf('function LineagePill(');
    const pillSrc = kit.slice(pillStart, pillEnd);
    expect(pillSrc).not.toContain('numberOfLines');
    expect(pillSrc).not.toContain('ellipsizeMode');
    // the full pill is full-width (stretch) and wraps at body size (planche l.desc)
    expect(kit).toMatch(/pillFull:\s*\{[^}]*alignSelf:\s*'stretch'/s);
    expect(kit).toMatch(/pillTextFull:\s*\{[^}]*fontSize:\s*12[^}]*lineHeight/s);
    expect(kit).toMatch(/lineagePillTextFull:\s*\{[^}]*color:\s*C\.accentDeepAlt/s);
  });

  it('the card grows with content — no fixed height (the DF-1 no-overlap lesson)', () => {
    const kit = read('src/ui/faso-kit.tsx');
    const cardStart = kit.indexOf('courseCard:');
    const cardSrc = kit.slice(cardStart, kit.indexOf('\n', cardStart + 200));
    expect(cardSrc).not.toMatch(/height:\s*\d/); // no fixed height on the card
    // the status line is a column (stretch children fill the width), below the eyebrow
    expect(kit).toMatch(/statusLine:\s*\{\s*marginTop:\s*8/);
  });

  it('App routes the long (non-proposed) statuses through the full-width line, not the inline pill', () => {
    const app = read('App.tsx');
    // the sentence statuses are NOT forced into the short inline caps pill
    const kit = read('src/ui/faso-kit.tsx');
    expect(kit).toMatch(/showStatusLine = !inlinePill \|\| lineage !== undefined/);
    expect(kit).toMatch(/\{!inlinePill && <Pill tone=\{status\.tone\} label=\{status\.label\} full \/>\}/);
    expect(kit).toMatch(/lineage !== undefined && <LineagePill label=\{lineage\} full \/>/);
    // the inline (eyebrow) pill is reserved for the short proposed « PROPOSÉE »
    expect(kit).toMatch(/const inlinePill = variant === 'proposed'/);
    expect(app).toContain('<FasoCourseCard');
  });
});
