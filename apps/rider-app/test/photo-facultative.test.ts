import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PHOTO-FACULTATIVE (founder ruling 2026-08-09) — « camera capture is
 * optional, and it's used only in case if product on pick up is different
 * from the photos. »
 *
 * Source-scanned because the defect it replaces was INVISIBLE at runtime:
 * `if (verifyBundleId === null) return;` made « Envoyer » a dead button for
 * any rider whose package matched — the tap did nothing and said nothing.
 * A behavioural test cannot see a button that silently does not act; the
 * absence of that early return is the property, so the absence is what is
 * pinned.
 */
describe('PHOTO-FACULTATIVE — a conforming pickup sends WITHOUT a photo', () => {
  const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');

  it('the dead-button guard is GONE — no early return on a missing bundle', () => {
    expect(app).not.toContain('if (verifyBundleId === null) return;');
  });

  it('a verification with no photo still names a stable bundle, derived from its own command', () => {
    expect(app).toContain('evidenceBundleId: verifyBundleId ?? SANS_PHOTO');
    // and the attempt key covers the SAME expression, so a retry can never
    // send different content under one command_id (409 command_id_reused).
    expect(app).toContain('${verifyBundleId ?? SANS_PHOTO}');
    // …and it can never be mistaken for a real bundle ref (blocker A7's lesson).
    expect(app, 'a ref shaped like real evidence').not.toMatch(/`ev-\$\{/);
  });

  it('the camera is offered ONLY when a check is answered « Non »', () => {
    expect(app).toContain('const ecartConstate = POLICY_CHECK_IDS.some((id) => checks[id] === false);');
    // VRAI-ROUTE (founder ruling 2026-08-10) moved the fold out of
    // FasoActCode — the typed pickup-code field is gone — but the camera card
    // is still mounted only on a reported difference…
    expect(app).toContain('{ecartConstate ? (');
    // …and it is still announced as facultative, never demanded.
    expect(app).toContain("<FasoBody>{t('verify.photo_facultative')}</FasoBody>");
    // The send never waits on the photo: the gate reads the checklist and the
    // flight, and nothing else.
    expect(app).toContain("disabled={!allAnswered || verifyPhase.kind === 'working' || capturing}");
  });

  it('⚠ THE SEAL PHOTO IS RETIRED — the founder ruled it out, twice', () => {
    /**
     * « terminate that sealing code and the sealing photo proof requirement »
     * (2026-08-10), and, restated: « photo capture is optional and only
     * required when one the 3 answers is non ». The seal now registers itself
     * from a machine-carried id with an EMPTY photo list — honest, never a
     * fabricated ref (A7's actual lesson), and never a camera at pickup for a
     * package that matched.
     */
    expect(app, 'no seal camera').not.toContain('setSealPhotoRefs');
    expect(app, 'no photo gate on the seal').not.toContain('if (sealPhotoRefs.length === 0) return;');
    expect(app, 'an empty list, not an invented ref').toContain('sealPhotoRefs: [],');
    expect(app, 'and no seal screen for the rider to work').not.toContain("t('seal.id_title')");
  });

  it('⚠ …and the ONE camera at pickup is still the difference camera', () => {
    // The whole of his rule in one assertion: the pickup camera exists only
    // inside the `ecartConstate` arm — i.e. only once an answer was « Non ».
    const ecart = app.slice(app.indexOf('{ecartConstate ? ('), app.indexOf('{ecartConstate ? (') + 1400);
    expect(ecart).toContain('takePhoto((art) => setVerifyBundleId(art.ref))');
    expect(ecart).toContain("t('verify.photo_facultative')");
  });
});
