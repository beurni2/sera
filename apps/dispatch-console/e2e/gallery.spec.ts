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
      await page.goto('/');
      for (const action of state.actions) {
        if (action === 'assign') {
          await page.locator('select').selectOption('rider-issa');
          await page.locator('button.assign').click();
        } else if (action === 'door-demo') {
          await page.locator('button.door-demo').click();
        } else {
          throw new Error(`unknown gallery action: ${action}`);
        }
      }
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: join(imgDir, `${state.id}.png`), fullPage: true });
    });
  }
}
