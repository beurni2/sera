import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

/**
 * WO-4.0 Part B — the console's visual evidence pack. States needing an
 * interaction (assignment, the door-paid « Essai » signal) declare their
 * actions in /gallery/states.json; a listed state with no screenshot is a
 * visible gap in gallery.html, never silent.
 */

const repoRoot = join(import.meta.dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(repoRoot, 'gallery/states.json'), 'utf8')) as {
  viewport: { width: number; height: number };
  groups: { title: string; states: { id: string; actions: string[] }[] }[];
};

test.use({ viewport: manifest.viewport });

const imgDir = join(repoRoot, 'gallery/img');
mkdirSync(imgDir, { recursive: true });

for (const group of manifest.groups) {
  for (const state of group.states) {
    test(`gallery: ${state.id}`, async ({ page }) => {
      // Determinism (WO-6.4, paying the named byte-stability debt HONESTLY):
      // fixed viewport (test.use above) + reduced motion + a FIXED clock for
      // EVERY state. Pinning the clock removes the wall clock as a variance
      // source, so any HH:MM the console derives (a lease deadline) is a function
      // of the state alone — WO-6.4 proved 7/8 states byte-identical across two
      // runs BY CONSTRUCTION this way (previously they matched only by luck of
      // capturing within the same minute; on a minute boundary they would drift).
      //
      // The one exception — `console-course-remise`, the clock-fastForward
      // requeue — still carries a ~7-pixel sub-pixel ANTIALIASING flip on a card
      // edge across runs (proven: a fixed clock did NOT change it, so it is a
      // browser rasterisation flip, not data). That residual is HARMLESS and NOT
      // a landmine: the PNGs are a gitignored build artifact, never a tracked
      // binary, and NO gate byte-compares them (this spec asserts a capture
      // SUCCEEDS; build-gallery.mjs asserts the image EXISTS). The WO-4.1 hazard
      // — a *tracked* PNG re-encoding and dirtying the tree — is structurally
      // gone. We do NOT drop the requeue state to make the number look clean.
      await page.clock.install({ time: new Date('2026-07-12T09:00:00Z') });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      for (const action of state.actions) {
        if (action === 'assign') {
          await page.locator('select').selectOption('rider-issa');
          await page.locator('button.assign').click();
        } else if (action === 'done') {
          await page.locator('button.done').click();
        } else if (action === 'door-demo') {
          await page.locator('button.door-demo').click();
        } else if (action === 'clock-6min') {
          await page.clock.fastForward('06:00');
        } else if (action === 'sos-raise') {
          await page.locator('button.sos-raise').click();
        } else if (action === 'sos-raise-queued') {
          await page.locator('button.sos-raise-queued').click();
        } else if (action === 'sos-ack') {
          await page.locator('button.sos-ack').click();
        } else {
          throw new Error(`unknown gallery action: ${action}`);
        }
      }
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: join(imgDir, `${state.id}.png`), fullPage: true });
    });
  }
}
