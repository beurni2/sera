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
      // Determinism (WO-6.1, paying the named byte-stability debt): fixed
      // viewport (test.use above) + reduced motion, so a capture is a function
      // of the state alone. The PNGs are a build artifact (gitignored), never a
      // tracked binary in the gate tree.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Clock-driven states (the ack-deadline requeue) need the mocked clock
      // installed BEFORE the page scripts start their interval timers.
      if (state.actions.some((a) => a.startsWith('clock-'))) {
        await page.clock.install();
      }
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
