import { expect, test } from '@playwright/test';
import { seraTheme as theme } from '@platform/ui-tokens';

// DoD: "rider shell + console shell boot with ui-tokens theme sera".
// This drives the real built console in a real Chromium.

function hexToRgb(hex: string): string {
  const n = hex.replace('#', '');
  return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
}

test('the console shell boots on the sera theme with catalog strings', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Séra — Console');

  const brand = page.locator('h1');
  await expect(brand).toHaveText('Séra');
  await expect(brand).toHaveCSS('color', hexToRgb(theme.colors.primary));

  await expect(page.locator('body')).toHaveCSS('background-color', hexToRgb(theme.colors.surface));
  // WO-2.2: two sections — the ready queue and the follow-up (dwell D20 +
  // outcome timeline on the canonical families).
  await expect(page.locator('h2')).toHaveCount(2);
  await expect(page.locator('h2').first()).toHaveText('Prêt à assigner');
  await expect(page.locator('h2').nth(1)).toHaveText('Suivi des colis');
  await expect(page.getByText('Temps de contrôle au ramassage : 165 s — Dans la cible')).toBeVisible();
  await expect(page.getByText('12:18 · Retour au vendeur · Argent pas prêt')).toBeVisible();
  // D7 staffed-hours default — copy only.
  await expect(page.locator('.hours-note')).toHaveText('Service en journée.');
});

test('WO-1.2 manual assignment: landmark-first task card → « Donner la course » → honest waiting state', async ({ page }) => {
  await page.goto('/');

  // SE0.3: landmark-first display order — landmark, then directions, then zone.
  const lines = page.locator('.location-line');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveText('Face à la pharmacie du marché');
  await expect(lines.nth(1)).toHaveText('Deuxième porte bleue après le kiosque');
  await expect(lines.nth(2)).toHaveText('Gounghin');

  // §2.3 step 10: the dispatcher assigns ONE task to ONE rider, manually.
  await page.locator('select').selectOption('rider-issa');
  await page.locator('button.assign').click();

  // The task leaves the queue; the console shows the honest waiting state —
  // acknowledged is a RIDER action, never implied by assignment itself.
  await expect(page.locator('#queue-body .status-line')).toHaveText("En attente de l'accord du livreur.");
  await expect(page.locator('.task-card')).toHaveCount(0);
});
