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
    expect(app).toContain('{...(ecartConstate');
    // …and it is never labelled as required.
    expect(app).toContain("neededLabel: t('verify.photo_facultative')");
  });

  it('⚠ the SEAL photo stays MANDATORY — custody never begins without a picture', () => {
    // The founder kept this one on the record; it is the load-bearing half.
    expect(app).toContain('if (sealPhotoRefs.length === 0) return;');
  });
});
