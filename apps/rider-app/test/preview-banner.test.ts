import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPreviewProfile, IS_PREVIEW, PREVIEW_PROFILE } from '../src/preview.js';

/**
 * WO-4.0 preview honesty — « Aperçu — bac à sable ». No RN renderer exists
 * in this repo (repo test idiom: pure functions + shell source discipline),
 * so the banner law is proven in two halves: the profile signal both ways,
 * and the shell provably rendering the banner GATED on that signal.
 */

const appDir = join(import.meta.dirname, '..');

describe('preview banner (WO-4.0)', () => {
  it('profile signal: preview (explicit and DEFAULT) renders; a non-preview profile does NOT', () => {
    expect(isPreviewProfile('preview')).toBe(true);
    expect(isPreviewProfile(undefined)).toBe(true); // the channel default
    expect(isPreviewProfile('production')).toBe(false); // the negative
    expect(isPreviewProfile('anything-else')).toBe(false);
    expect(PREVIEW_PROFILE).toBe('preview');
    // In THIS environment no production profile exists — the built signal is preview.
    expect(IS_PREVIEW).toBe(true);
  });

  it('the shell renders the banner GATED on IS_PREVIEW — never unconditional, never absent', () => {
    const source = readFileSync(join(appDir, 'App.tsx'), 'utf8');
    expect(source).toMatch(/\{IS_PREVIEW && \(\s*<View style=\{styles\.previewBanner\}>/);
    expect(source).toMatch(/t\('preview\.banner'\)/);
    // The signal comes from the one preview module, not a local literal.
    expect(source).toMatch(/import \{ IS_PREVIEW \} from '\.\/src\/preview'/);
  });
});
