import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POLICY_CHECK_IDS } from '../src/custody-flow';

/**
 * WO-FP-SERA · the FULL-BLEED SCROLL GUARD (founder device review, 2026-07-15).
 * 🔴 R5 could not scroll — the 7-check list overflowed the fixed content region
 * (there was no app-level ScrollView; each screen was FpIn-wrapped with flex:1 in a
 * fixed layout), so « Rien ne manque » + the confirm control were unreachable and a
 * rider COULD NOT complete a verification (custody flow blocked). Fix: the whole
 * screen is a single full-bleed ScrollView (the chrome scrolls WITH the content),
 * FpIn sizes to content (no flex:1), and there is NO nested scroll container.
 *
 * RN has no layout in unit tests, so « the last check + the action are reachable »
 * is enforced STRUCTURALLY: the content lives in a ScrollView (it scrolls, so
 * nothing clips), every check + both actions render, and no flex:1 wrapper or nested
 * FlatList can collapse/trap the scroll.
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const read = (p: string): string => readFileSync(join(appDir, p), 'utf8');

describe('WO-FP-SERA — the screen is a full-bleed scroll surface (R5 can complete)', () => {
  const app = read('App.tsx');

  it('the app content lives in a single ScrollView — no nested scroll container', () => {
    expect(app).toMatch(/<ScrollView\b/);
    // exactly one scroll surface; no nested FlatList (the R2 list is a map)
    expect(app.match(/<ScrollView\b/g)).toHaveLength(1);
    expect(app).not.toMatch(/<FlatList/);
    // the scroll content clears the fixed dock/SOS with a bottom pad
    expect(app).toMatch(/scrollContent: \{[^}]*paddingBottom/);
  });

  it('FpIn sizes to content — no flex:1 wrapper collapses the scroll', () => {
    const sig = read('src/ui/signature.tsx');
    const fpin = sig.slice(sig.indexOf('export function FpIn'), sig.indexOf('export function FpPop'));
    // the wrapper must NOT hardcode flex:1 (that collapses inside a ScrollView)
    expect(fpin).not.toMatch(/\{\s*flex:\s*1\s*\}/);
    // and the scrolled containers are content-sized, not flex:1
    expect(app).toMatch(/stackGap: \{ gap:/);
    expect(app).not.toMatch(/stackGap: \{ flex: 1/);
  });

  it('R5 renders ALL checks + BOTH actions inside the scroll (nothing clipped)', () => {
    const r5 = app.slice(app.indexOf("screen === 'verify'"), app.indexOf("screen === 'refused'"));
    // The WHOLE policy set maps to a check row (not a fixed/clipped subset) —
    // that is the real property, and it survives any policy version.
    //
    // ⚠ The old proxy for « tall enough to clip » was `length >= 7`, true of
    // policy v1's nine fields. The founder's 2026-08-09 ruling made it three
    // photo-referenced questions, and the screen got TALLER, not shorter: the
    // supplier's proof photos now render above them. So the count assertion is
    // replaced by the thing it was standing in for — every id renders, and the
    // photos and both actions are inside the same scroll.
    expect(r5).toMatch(/POLICY_CHECK_IDS\.map\(\(id\) =>/);
    expect(POLICY_CHECK_IDS.length).toBeGreaterThan(0);
    // the accept + the refusal arm both render (reachable after the last check)
    expect(r5).toMatch(/label=\{t\('verify\.accept_action'\)\}/);
    expect(r5).toMatch(/label=\{t\('verify\.refuse_action'\)\}/);
    // R5 is FpIn-wrapped (content-sized) inside the scroll — no fixed-height trap
    expect(r5).toMatch(/<FpIn style=\{styles\.stackGap\}>/);
  });
});
