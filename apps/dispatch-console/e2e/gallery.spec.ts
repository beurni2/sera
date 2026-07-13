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
      // NAME THE CONSUMER (WO-6.4, CTO Q3): NOTHING byte-compares these PNGs.
      // This spec asserts a capture SUCCEEDS; build-gallery.mjs asserts the image
      // EXISTS; there is no toHaveScreenshot / snapshot baseline anywhere and no
      // PNG is tracked (they are gitignored). So byte-equality is a property
      // nothing relies on — the WO-4.1 hazard (a *tracked* PNG re-encoding and
      // dirtying the tree) is gone because the COMPARISON is gone, not because
      // the bytes are stable.
      //
      // The fixed clock + reduced motion below are here ONLY to keep the
      // gallery's VISIBLE content deterministic for the founder's eye (a lease
      // HH:MM is a function of the fixed demo time, not the capture minute) — NOT
      // to guarantee byte-equality. For the record, a two-run diff shows 7/8
      // states byte-identical and the clock-requeue state (`console-course-remise`)
      // carrying a ~7px sub-pixel AA flip a fixed clock does not remove; since no
      // gate can see those bytes, that flip is irrelevant here.
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
        } else if (action === 'board-incident') {
          await page.locator('button.board-demo-incident').click();
        } else if (action === 'desk-incident') {
          await page.locator('button.desk-demo-incident').click();
        } else {
          throw new Error(`unknown gallery action: ${action}`);
        }
      }
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: join(imgDir, `${state.id}.png`), fullPage: true });
    });
  }
}
